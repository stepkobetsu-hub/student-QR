import { DurableObject } from "cloudflare:workers";
import { decideAttendance, tokyoDateKey, type CheckinType, type SubjectRole } from "./domain";

export interface RosterSubject {
  id: string;
  name: string;
  qrKey: string;
  role: SubjectRole;
  active: boolean;
}

export interface AcceptRequest {
  qrKey: string;
  receiptId: string;
  deviceId: string;
  acceptedAt: number;
  photoBase64?: string;
  clientTimings?: Record<string, unknown>;
}

export interface AcceptResponse {
  ok: boolean;
  code: string;
  receiptId: string;
  subjectId?: string;
  name?: string;
  role?: SubjectRole;
  type?: CheckinType;
  duplicate?: boolean;
  acceptedAt?: number;
  dateKey?: string;
  legacyState?: LegacyState;
}

export interface RosterRefreshClaim {
  claimed: boolean;
  reason: "CLAIMED" | "IN_PROGRESS" | "COOLDOWN";
  retryAfterMs: number;
}

export interface CheckinEnv {
  CHECKIN_WRITE_URL?: string;
  CHECKIN_WRITE_ENABLED?: string;
  CHECKIN_WRITE_ACTION?: string;
  ROSTER_SOURCE_TOKEN?: string;
}

export type LegacyState = "NOT_REQUIRED" | "PENDING" | "COMPLETED" | "RETRYING";

export interface LegacyStatusResponse {
  ok: boolean;
  receiptId: string;
  state: LegacyState | "NOT_FOUND";
  responseJson?: string;
  attempts?: number;
  lastError?: string;
}

interface AttendanceRow {
  [key: string]: string | number;
  last_type: CheckinType;
  last_accepted_at: number;
  stamp_count: number;
}

interface ReceiptRow {
  [key: string]: string | number;
  receipt_id: string;
  subject_id: string;
  name: string;
  role: SubjectRole;
  type: CheckinType;
  duplicate: number;
  accepted_at: number;
  date_key: string;
}

interface LegacyOutboxRow {
  [key: string]: string | number;
  receipt_id: string;
  subject_id: string;
  qr_key: string;
  photo_base64: string;
  client_timings_json: string;
  attempts: number;
  next_attempt_at: number;
}

export interface LegacyWriteItem {
  action: string;
  receiptId: string;
  acceptedAt: number;
  edgeToken: string;
  qrKey: string;
  photoBase64: string;
  clientTimingsJson: string;
  attempts: number;
}

interface LegacyResultRow {
  [key: string]: string | number;
  response_json: string;
}

interface RosterRefreshRow {
  [key: string]: number;
  last_attempt_at: number;
  lease_until: number;
  last_success_at: number;
}

const LEGACY_RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 5 * 60_000, 15 * 60_000];
const APPS_SCRIPT_RECEIPT_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f-]{27,36}|qr-[a-z0-9-]{10,80})$/i;

export async function appsScriptReceiptId(receiptId: string): Promise<string> {
  const value = String(receiptId || "").trim();
  if (APPS_SCRIPT_RECEIPT_PATTERN.test(value)) return value;

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `qr-edge-${hex.slice(0, 40)}`;
}

export async function postLegacyCheckin(
  writeUrl: string,
  item: LegacyWriteItem,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const receiptId = item.action === "edgeRosterExport"
    ? item.receiptId
    : await appsScriptReceiptId(item.receiptId);
  const response = await fetcher(writeUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action: item.action,
      token: item.action === "edgeRosterExport" ? item.edgeToken : undefined,
      qrData: item.qrKey,
      photoBase64: item.photoBase64,
      receiptId,
      acceptedAt: item.acceptedAt,
      edgeToken: item.edgeToken,
      clientTimings: JSON.parse(item.clientTimingsJson) as Record<string, unknown>,
      retry: item.attempts > 0,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`CHECKIN_WRITE_HTTP_${response.status}`);
  const result = await response.json<Record<string, unknown>>();
  if (item.action === "edgeRosterExport" && result.ok === true && Array.isArray(result.campuses)) {
    return {
      ok: true,
      code: "EDGE_PROBE_ACCEPTED",
      attendanceSaved: true,
      mailStatus: "NOT_REQUIRED",
      receiptId: item.receiptId,
      acceptedAt: item.acceptedAt,
      probe: true,
    };
  }
  if (result.attendanceSaved !== true) {
    throw new Error(typeof result.code === "string" ? result.code : "CHECKIN_WRITE_REJECTED");
  }
  return result;
}

export class CampusCheckin extends DurableObject<CheckinEnv> {
  constructor(ctx: DurableObjectState, env: CheckinEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
          id INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS roster (
          subject_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          qr_key TEXT NOT NULL UNIQUE,
          role TEXT NOT NULL CHECK (role IN ('student', 'teacher')),
          active INTEGER NOT NULL DEFAULT 1,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS roster_qr_key_idx ON roster(qr_key);
        CREATE TABLE IF NOT EXISTS daily_state (
          date_key TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          last_type TEXT NOT NULL,
          last_accepted_at INTEGER NOT NULL,
          stamp_count INTEGER NOT NULL,
          PRIMARY KEY (date_key, subject_id)
        );
        CREATE TABLE IF NOT EXISTS receipts (
          receipt_id TEXT PRIMARY KEY,
          subject_id TEXT NOT NULL,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          type TEXT NOT NULL,
          duplicate INTEGER NOT NULL,
          device_id TEXT NOT NULL,
          accepted_at INTEGER NOT NULL,
          date_key TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS receipts_date_idx ON receipts(date_key, accepted_at);
        INSERT OR IGNORE INTO _sql_schema_migrations (id) VALUES (1);
        CREATE TABLE IF NOT EXISTS legacy_outbox (
          receipt_id TEXT PRIMARY KEY,
          subject_id TEXT NOT NULL,
          qr_key TEXT NOT NULL,
          photo_base64 TEXT NOT NULL,
          client_timings_json TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          last_error TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS legacy_outbox_due_idx
          ON legacy_outbox(next_attempt_at, created_at);
        CREATE TABLE IF NOT EXISTS legacy_results (
          receipt_id TEXT PRIMARY KEY,
          response_json TEXT NOT NULL,
          completed_at INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO _sql_schema_migrations (id) VALUES (2);
        CREATE TABLE IF NOT EXISTS roster_refresh_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          last_attempt_at INTEGER NOT NULL DEFAULT 0,
          lease_until INTEGER NOT NULL DEFAULT 0,
          last_success_at INTEGER NOT NULL DEFAULT 0
        );
        INSERT OR IGNORE INTO roster_refresh_state
          (id, last_attempt_at, lease_until, last_success_at)
        VALUES (1, 0, 0, 0);
        INSERT OR IGNORE INTO _sql_schema_migrations (id) VALUES (4);
      `);
      const outboxColumns = this.ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(legacy_outbox)").toArray();
      if (!outboxColumns.some((column) => column.name === "subject_id")) {
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec("ALTER TABLE legacy_outbox ADD COLUMN subject_id TEXT NOT NULL DEFAULT ''");
        });
      }
      this.ctx.storage.sql.exec("INSERT OR IGNORE INTO _sql_schema_migrations (id) VALUES (3)");
    });
  }

  syncRoster(subjects: RosterSubject[], syncedAt: number): { ok: true; count: number } {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM roster");
      for (const subject of subjects) {
        this.ctx.storage.sql.exec(
          `INSERT INTO roster (subject_id, name, qr_key, role, active, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(subject_id) DO UPDATE SET
             name = excluded.name,
             qr_key = excluded.qr_key,
             role = excluded.role,
             active = excluded.active,
             updated_at = excluded.updated_at`,
          subject.id,
          subject.name,
          subject.qrKey,
          subject.role,
          subject.active ? 1 : 0,
          syncedAt,
        );
      }
    });
    return { ok: true, count: subjects.length };
  }

  claimRosterRefresh(now: number, cooldownMs: number, leaseMs: number): RosterRefreshClaim {
    const safeNow = Math.max(0, Math.trunc(now));
    const safeCooldownMs = Math.min(5 * 60_000, Math.max(1_000, Math.trunc(cooldownMs)));
    const safeLeaseMs = Math.min(2 * 60_000, Math.max(1_000, Math.trunc(leaseMs)));
    const state = this.ctx.storage.sql.exec<RosterRefreshRow>(
      "SELECT last_attempt_at, lease_until, last_success_at FROM roster_refresh_state WHERE id = 1",
    ).toArray()[0] ?? { last_attempt_at: 0, lease_until: 0, last_success_at: 0 };

    if (safeNow < state.lease_until) {
      return { claimed: false, reason: "IN_PROGRESS", retryAfterMs: state.lease_until - safeNow };
    }
    const cooldownUntil = state.last_attempt_at + safeCooldownMs;
    if (safeNow < cooldownUntil) {
      return { claimed: false, reason: "COOLDOWN", retryAfterMs: cooldownUntil - safeNow };
    }

    this.ctx.storage.sql.exec(
      `UPDATE roster_refresh_state
       SET last_attempt_at = ?, lease_until = ?
       WHERE id = 1`,
      safeNow,
      safeNow + safeLeaseMs,
    );
    return { claimed: true, reason: "CLAIMED", retryAfterMs: 0 };
  }

  completeRosterRefresh(completedAt: number, succeeded: boolean): void {
    const safeCompletedAt = Math.max(0, Math.trunc(completedAt));
    this.ctx.storage.sql.exec(
      `UPDATE roster_refresh_state
       SET lease_until = 0,
           last_success_at = CASE WHEN ? = 1 THEN ? ELSE last_success_at END
       WHERE id = 1`,
      succeeded ? 1 : 0,
      safeCompletedAt,
    );
  }

  async accept(input: AcceptRequest): Promise<AcceptResponse> {
    const existing = this.ctx.storage.sql.exec<ReceiptRow>(
      "SELECT receipt_id, subject_id, name, role, type, duplicate, accepted_at, date_key FROM receipts WHERE receipt_id = ?",
      input.receiptId,
    ).toArray()[0];
    if (existing) return this.receiptResponse(existing);

    const subject = this.ctx.storage.sql.exec<{
      subject_id: string;
      name: string;
      role: SubjectRole;
    }>(
      "SELECT subject_id, name, role FROM roster WHERE qr_key = ? AND active = 1",
      input.qrKey,
    ).toArray()[0];
    if (!subject) return { ok: false, code: "SUBJECT_NOT_FOUND", receiptId: input.receiptId };

    const dateKey = tokyoDateKey(input.acceptedAt);
    const prior = this.ctx.storage.sql.exec<AttendanceRow>(
      `SELECT last_type, last_accepted_at, stamp_count
       FROM daily_state WHERE date_key = ? AND subject_id = ?`,
      dateKey,
      subject.subject_id,
    ).toArray()[0] ?? null;
    const decision = decideAttendance(subject.role, input.acceptedAt, prior ? {
      lastType: prior.last_type,
      lastAcceptedAt: prior.last_accepted_at,
      count: prior.stamp_count,
    } : null);
    const shouldQueueLegacy = !decision.duplicate && this.legacyWriteEnabled();

    this.ctx.storage.transactionSync(() => {
      if (!decision.duplicate) {
        this.ctx.storage.sql.exec(
          `INSERT INTO daily_state (date_key, subject_id, last_type, last_accepted_at, stamp_count)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(date_key, subject_id) DO UPDATE SET
             last_type = excluded.last_type,
             last_accepted_at = excluded.last_accepted_at,
             stamp_count = excluded.stamp_count`,
          dateKey,
          subject.subject_id,
          decision.type,
          input.acceptedAt,
          decision.nextCount,
        );
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO receipts
          (receipt_id, subject_id, name, role, type, duplicate, device_id, accepted_at, date_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.receiptId,
        subject.subject_id,
        subject.name,
        subject.role,
        decision.type,
        decision.duplicate ? 1 : 0,
        input.deviceId,
        input.acceptedAt,
        dateKey,
      );
      if (shouldQueueLegacy) {
        this.ctx.storage.sql.exec(
          `INSERT INTO legacy_outbox
            (receipt_id, subject_id, qr_key, photo_base64, client_timings_json, attempts, next_attempt_at, created_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
          input.receiptId,
          subject.subject_id,
          input.qrKey,
          input.photoBase64 ?? "",
          JSON.stringify(input.clientTimings ?? {}),
          Date.now(),
          Date.now(),
        );
      }
    });

    if (shouldQueueLegacy) await this.scheduleOldestOutbox();
    return {
      ok: true,
      code: decision.duplicate ? "DUPLICATE_WITHIN_WINDOW" : "ACCEPTED",
      receiptId: input.receiptId,
      subjectId: subject.subject_id,
      name: subject.name,
      role: subject.role,
      type: decision.type,
      duplicate: decision.duplicate,
      acceptedAt: input.acceptedAt,
      dateKey,
      legacyState: decision.duplicate || !shouldQueueLegacy ? "NOT_REQUIRED" : "PENDING",
    };
  }

  getLegacyStatus(receiptId: string): LegacyStatusResponse {
    const completed = this.ctx.storage.sql.exec<LegacyResultRow>(
      "SELECT response_json FROM legacy_results WHERE receipt_id = ?",
      receiptId,
    ).toArray()[0];
    if (completed) {
      return {
        ok: true,
        receiptId,
        state: "COMPLETED",
        responseJson: completed.response_json,
      };
    }
    const pending = this.ctx.storage.sql.exec<{ attempts: number; last_error: string }>(
      "SELECT attempts, last_error FROM legacy_outbox WHERE receipt_id = ?",
      receiptId,
    ).toArray()[0];
    if (pending) {
      return {
        ok: true,
        receiptId,
        state: pending.attempts > 0 ? "RETRYING" : "PENDING",
        attempts: pending.attempts,
        lastError: pending.last_error || undefined,
      };
    }
    const receipt = this.ctx.storage.sql.exec<{ duplicate: number }>(
      "SELECT duplicate FROM receipts WHERE receipt_id = ?",
      receiptId,
    ).toArray()[0];
    if (receipt) return { ok: true, receiptId, state: "NOT_REQUIRED" };
    return { ok: false, receiptId, state: "NOT_FOUND" };
  }

  async alarm(): Promise<void> {
    const item = this.oldestOutbox();
    if (!item) return;
    if (item.next_attempt_at > Date.now()) {
      await this.ctx.storage.setAlarm(item.next_attempt_at);
      return;
    }
    try {
      const writeUrl = this.env.CHECKIN_WRITE_URL;
      const writeAction = this.env.CHECKIN_WRITE_ACTION || "checkIn";
      const edgeToken = this.env.ROSTER_SOURCE_TOKEN;
      if (!writeUrl || !edgeToken) throw new Error("CHECKIN_WRITE_NOT_CONFIGURED");
      const result = await postLegacyCheckin(writeUrl, {
        action: writeAction,
        receiptId: item.receipt_id,
        acceptedAt: this.ctx.storage.sql.exec<{ accepted_at: number }>(
          "SELECT accepted_at FROM receipts WHERE receipt_id = ?",
          item.receipt_id,
        ).toArray()[0]?.accepted_at ?? Date.now(),
        edgeToken,
        qrKey: item.qr_key,
        photoBase64: item.photo_base64,
        clientTimingsJson: item.client_timings_json,
        attempts: item.attempts,
      });
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec("DELETE FROM legacy_outbox WHERE receipt_id = ?", item.receipt_id);
        this.ctx.storage.sql.exec(
          `INSERT INTO legacy_results (receipt_id, response_json, completed_at)
           VALUES (?, ?, ?)
           ON CONFLICT(receipt_id) DO UPDATE SET
             response_json = excluded.response_json,
             completed_at = excluded.completed_at`,
          item.receipt_id,
          JSON.stringify(result),
          Date.now(),
        );
      });
      console.log(JSON.stringify({ event: "legacy_checkin_committed", receiptId: item.receipt_id }));
    } catch (error) {
      const attempts = item.attempts + 1;
      const delay = LEGACY_RETRY_DELAYS_MS[Math.min(attempts - 1, LEGACY_RETRY_DELAYS_MS.length - 1)];
      const nextAttemptAt = Date.now() + delay;
      const message = error instanceof Error ? error.message : "CHECKIN_WRITE_FAILED";
      this.ctx.storage.sql.exec(
        `UPDATE legacy_outbox
         SET attempts = ?, next_attempt_at = ?, last_error = ?
         WHERE receipt_id = ?`,
        attempts,
        nextAttemptAt,
        message.slice(0, 160),
        item.receipt_id,
      );
      console.error(JSON.stringify({ event: "legacy_checkin_retry", receiptId: item.receipt_id, attempts, code: message }));
    }
    await this.scheduleOldestOutbox();
  }

  private legacyWriteEnabled(): boolean {
    return String(this.env.CHECKIN_WRITE_ENABLED) === "true" && Boolean(this.env.CHECKIN_WRITE_URL) && Boolean(this.env.ROSTER_SOURCE_TOKEN);
  }

  private oldestOutbox(): LegacyOutboxRow | undefined {
    return this.ctx.storage.sql.exec<LegacyOutboxRow>(
      `SELECT current.receipt_id, current.subject_id, current.qr_key, current.photo_base64,
              current.client_timings_json, current.attempts, current.next_attempt_at, current.created_at
       FROM legacy_outbox AS current
       WHERE NOT EXISTS (
         SELECT 1 FROM legacy_outbox AS prior
         WHERE prior.subject_id = current.subject_id
           AND (prior.created_at < current.created_at
             OR (prior.created_at = current.created_at AND prior.receipt_id < current.receipt_id))
       )
       ORDER BY current.next_attempt_at, current.created_at, current.receipt_id
       LIMIT 1`,
    ).toArray()[0];
  }

  private async scheduleOldestOutbox(): Promise<void> {
    const oldest = this.oldestOutbox();
    if (!oldest) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const currentAlarm = await this.ctx.storage.getAlarm();
    const target = Math.max(Date.now(), oldest.next_attempt_at);
    if (currentAlarm === null || target < currentAlarm) await this.ctx.storage.setAlarm(target);
  }

  private receiptResponse(row: ReceiptRow): AcceptResponse {
    const legacy = this.getLegacyStatus(row.receipt_id);
    return {
      ok: true,
      code: "ALREADY_ACCEPTED",
      receiptId: row.receipt_id,
      subjectId: row.subject_id,
      name: row.name,
      role: row.role,
      type: row.type,
      duplicate: Boolean(row.duplicate),
      acceptedAt: row.accepted_at,
      dateKey: row.date_key,
      legacyState: legacy.state === "NOT_FOUND" ? "NOT_REQUIRED" : legacy.state,
    };
  }
}
