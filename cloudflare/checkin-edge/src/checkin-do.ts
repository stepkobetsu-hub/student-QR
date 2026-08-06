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

export class CampusCheckin extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
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
      `);
    });
  }

  syncRoster(subjects: RosterSubject[], syncedAt: number): { ok: true; count: number } {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("UPDATE roster SET active = 0, updated_at = ?", syncedAt);
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

  accept(input: AcceptRequest): AcceptResponse {
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
    if (!subject) {
      return { ok: false, code: "SUBJECT_NOT_FOUND", receiptId: input.receiptId };
    }

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
    });

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
    };
  }

  private receiptResponse(row: ReceiptRow): AcceptResponse {
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
    };
  }
}
