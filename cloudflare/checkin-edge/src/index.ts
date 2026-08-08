import {
  CampusCheckin,
  type AcceptRequest,
  type AcceptResponse,
  type LegacyStatusResponse,
  type RosterRefreshClaim,
  type RosterSubject,
} from "./checkin-do";
import legacyTabletHtml from "./legacy-tablet.html";
import legacyJsQr from "./legacy-jsqr.txt";

export { CampusCheckin };

interface RosterSourceResponse {
  ok: boolean;
  campuses: Array<{ campus: string; subjects: RosterSubject[] }>;
}

interface RosterSyncResult {
  campus: string;
  count: number;
  duplicateQrKeys: number;
}

interface CheckinRequest extends AcceptRequest {
  campus: string;
}

interface ReceiptStatusRequest {
  campus: string;
  receiptId: string;
}

type AppEnv = Env & {
  ENVIRONMENT: string;
  ALLOWED_ORIGIN: string;
  TERMINAL_TOKEN?: string;
  TERMINAL_TOKEN_JINRYO?: string;
  TERMINAL_TOKEN_OTEMACHI?: string;
  INTEGRATION_TEST_TOKEN?: string;
  SYNC_TOKEN: string;
  ROSTER_SOURCE_URL: string;
  ROSTER_SOURCE_TOKEN: string;
  CHECKIN_WRITE_URL?: string;
  CHECKIN_WRITE_ENABLED?: string;
  CHECKIN_WRITE_ACTION?: string;
};

export interface TerminalTokenEnv {
  TERMINAL_TOKEN?: string;
  TERMINAL_TOKEN_JINRYO?: string;
  TERMINAL_TOKEN_OTEMACHI?: string;
  INTEGRATION_TEST_TOKEN?: string;
}

const MAX_BODY_BYTES = 2_000_000;
const MAX_PHOTO_BASE64_LENGTH = 1_600_000;
const CAMPUS_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const RECEIPT_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/;
const ROSTER_REFRESH_COOLDOWN_MS = 30_000;
const ROSTER_REFRESH_LEASE_MS = 30_000;
const LEGACY_TERMINAL_COOKIE = "__Host-step_legacy_terminal";
const LEGACY_TERMINAL_COOKIE_MAX_AGE = 31_536_000;

export interface CampusCheckinApi {
  accept(input: AcceptRequest): Promise<AcceptResponse>;
  claimRosterRefresh(now: number, cooldownMs: number, leaseMs: number): Promise<RosterRefreshClaim>;
  completeRosterRefresh(completedAt: number, succeeded: boolean): Promise<void>;
}

export interface LegacyStatusApi {
  getLegacyStatus(receiptId: string): Promise<LegacyStatusResponse>;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const origin = request.headers.get("Origin") ?? "";
    if (request.method === "OPTIONS") return corsPreflight(origin, env);

    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, service: "step-checkin-edge", environment: env.ENVIRONMENT }, 200, origin, env);
      }
      if (request.method === "GET" && (url.pathname === "/legacy-tablet" || url.pathname === "/legacy-tablet/")) {
        const headers = new Headers({
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        });
        const sessionCookie = await legacyTerminalCookieHeader(request, env);
        if (sessionCookie) headers.set("Set-Cookie", sessionCookie);
        return new Response(legacyTabletHtml, {
          status: 200,
          headers,
        });
      }
      if (request.method === "GET" && url.pathname === "/legacy-jsqr.js") {
        return new Response(legacyJsQr, {
          status: 200,
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=604800, immutable",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/checkins") {
        const body = await readJson<CheckinRequest>(request);
        validateCheckin(body);
        const campus = resolveCheckinCampus(body.campus);
        if (!await checkinAuthorized(request, env, campus)) {
          return json({ ok: false, code: "UNAUTHORIZED" }, 401, origin, env);
        }
        const stub = env.CAMPUS_CHECKIN.getByName(campus);
        const alternate = alternateCampus(campus);
        const acceptedAt = Date.now();
        const input: AcceptRequest = {
          qrKey: body.qrKey.trim(),
          receiptId: body.receiptId,
          deviceId: body.deviceId.trim(),
          acceptedAt,
          photoBase64: body.photoBase64,
          clientTimings: body.clientTimings,
        };
        const result = await acceptWithRosterRefresh(
          stub,
          input,
          () => syncFromGoogle(env),
          () => Date.now(),
          campus,
          alternate ? env.CAMPUS_CHECKIN.getByName(alternate) : undefined,
        );
        console.log(JSON.stringify({
          event: "checkin",
          campus,
          code: result.code,
          receiptId: body.receiptId,
          legacyState: result.legacyState,
        }));
        return json(checkinClientResponse(result), result.ok ? 200 : 404, origin, env);
      }
      if (request.method === "POST" && url.pathname === "/v1/receipt-status") {
        const body = await readJson<ReceiptStatusRequest>(request);
        validateReceiptStatus(body);
        const campus = resolveCheckinCampus(body.campus);
        if (!await checkinAuthorized(request, env, campus)) {
          return json({ ok: false, code: "UNAUTHORIZED" }, 401, origin, env);
        }
        const alternate = alternateCampus(campus);
        const status = await getLegacyStatusWithCampusFallback(
          env.CAMPUS_CHECKIN.getByName(campus),
          body.receiptId,
          alternate ? env.CAMPUS_CHECKIN.getByName(alternate) : undefined,
        );
        return json(receiptStatusClientResponse(status), status.ok ? 200 : 404, origin, env);
      }
      if (request.method === "POST" && url.pathname === "/v1/admin/sync-roster") {
        if (!await authorized(request, env.SYNC_TOKEN)) return json({ ok: false, code: "UNAUTHORIZED" }, 401, origin, env);
        const body = await readJson<{ campuses: RosterSourceResponse["campuses"] }>(request);
        const result = await syncCampuses(env, body.campuses);
        return json({ ok: true, campuses: result }, 200, origin, env);
      }
      if (request.method === "POST" && url.pathname === "/v1/admin/sync-from-source") {
        if (!await authorized(request, env.SYNC_TOKEN)) return json({ ok: false, code: "UNAUTHORIZED" }, 401, origin, env);
        const result = await syncFromGoogle(env);
        return json({ ok: true, campuses: result }, 200, origin, env);
      }
      return json({ ok: false, code: "NOT_FOUND" }, 404, origin, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
      console.error(JSON.stringify({ event: "request_error", path: url.pathname, message }));
      const status = message.startsWith("INVALID_") || message === "BODY_TOO_LARGE" ? 400 : 500;
      return json({ ok: false, code: message }, status, origin, env);
    }
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(syncFromGoogle(env));
  },
} satisfies ExportedHandler<AppEnv>;

export async function acceptWithRosterRefresh(
  stub: CampusCheckinApi,
  input: AcceptRequest,
  refreshRoster: () => Promise<unknown>,
  now: () => number = () => Date.now(),
  campus = "unknown",
  alternateStub?: CampusCheckinApi,
): Promise<AcceptResponse> {
  const firstResult = await stub.accept(input);
  if (firstResult.code !== "SUBJECT_NOT_FOUND") return firstResult;

  if (alternateStub) {
    const alternateResult = await alternateStub.accept(input);
    if (alternateResult.code !== "SUBJECT_NOT_FOUND") return alternateResult;
  }

  const claim = await stub.claimRosterRefresh(now(), ROSTER_REFRESH_COOLDOWN_MS, ROSTER_REFRESH_LEASE_MS);
  let refreshSucceeded = false;
  if (claim.claimed) {
    try {
      await refreshRoster();
      refreshSucceeded = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "ROSTER_REFRESH_FAILED";
      console.error(JSON.stringify({ event: "roster_refresh_on_miss_failed", campus, code: message }));
    } finally {
      try {
        await stub.completeRosterRefresh(now(), refreshSucceeded);
      } catch (error) {
        const message = error instanceof Error ? error.message : "ROSTER_REFRESH_COMPLETION_FAILED";
        console.error(JSON.stringify({ event: "roster_refresh_completion_failed", campus, code: message }));
      }
    }
  }

  console.log(JSON.stringify({
    event: "roster_refresh_on_miss",
    campus,
    claimed: claim.claimed,
    reason: claim.reason,
    refreshSucceeded,
    retryAfterMs: claim.retryAfterMs,
  }));
  const retryResult = await stub.accept(input);
  if (retryResult.code !== "SUBJECT_NOT_FOUND" || !alternateStub) return retryResult;
  return alternateStub.accept(input);
}

export async function getLegacyStatusWithCampusFallback(
  stub: LegacyStatusApi,
  receiptId: string,
  alternateStub?: LegacyStatusApi,
): Promise<LegacyStatusResponse> {
  const firstStatus = await stub.getLegacyStatus(receiptId);
  if (firstStatus.state !== "NOT_FOUND" || !alternateStub) return firstStatus;
  return alternateStub.getLegacyStatus(receiptId);
}

function alternateCampus(campus: string): "jinryo" | "otemachi" | null {
  if (campus === "jinryo") return "otemachi";
  if (campus === "otemachi") return "jinryo";
  return null;
}

async function syncFromGoogle(env: AppEnv): Promise<RosterSyncResult[]> {
  if (!env.ROSTER_SOURCE_URL || !env.ROSTER_SOURCE_TOKEN) throw new Error("ROSTER_SOURCE_NOT_CONFIGURED");
  const response = await fetch(env.ROSTER_SOURCE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "edgeRosterExport", token: env.ROSTER_SOURCE_TOKEN }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`ROSTER_SOURCE_HTTP_${response.status}`);
  const payload = await response.json<RosterSourceResponse>();
  if (!payload.ok || !Array.isArray(payload.campuses)) throw new Error("INVALID_ROSTER_SOURCE_RESPONSE");
  const result = await syncCampuses(env, payload.campuses);
  console.log(JSON.stringify({ event: "roster_sync", result }));
  return result;
}

async function syncCampuses(env: AppEnv, campuses: RosterSourceResponse["campuses"]): Promise<RosterSyncResult[]> {
  const syncedAt = Date.now();
  const output: RosterSyncResult[] = [];
  for (const item of campuses) {
    if (!CAMPUS_PATTERN.test(item.campus) || !Array.isArray(item.subjects)) throw new Error("INVALID_CAMPUS");
    const validated = item.subjects.map(validateSubject);
    const { subjects, duplicateQrKeys } = dedupeRosterSubjects(validated);
    if (duplicateQrKeys > 0) {
      console.warn(JSON.stringify({ event: "roster_duplicate_qr", campus: item.campus, duplicateQrKeys }));
    }
    const result = await env.CAMPUS_CHECKIN.getByName(item.campus).syncRoster(subjects, syncedAt);
    output.push({ campus: item.campus, count: result.count, duplicateQrKeys });
  }
  return output;
}

function dedupeRosterSubjects(subjects: RosterSubject[]): { subjects: RosterSubject[]; duplicateQrKeys: number } {
  const owners = new Map<string, RosterSubject>();
  const output: RosterSubject[] = [];
  let duplicateQrKeys = 0;
  for (const subject of subjects) {
    const existing = owners.get(subject.qrKey);
    if (existing) {
      if (existing.id !== subject.id) duplicateQrKeys += 1;
      continue;
    }
    owners.set(subject.qrKey, subject);
    output.push(subject);
  }
  return { subjects: output, duplicateQrKeys };
}

function validateSubject(subject: RosterSubject): RosterSubject {
  if (!subject || typeof subject !== "object") throw new Error("INVALID_SUBJECT");
  const id = String(subject.id ?? "").trim();
  const name = String(subject.name ?? "").trim();
  const qrKey = String(subject.qrKey ?? "").trim();
  const role = subject.role;
  if (!id || id.length > 80 || !name || name.length > 100 || !qrKey || qrKey.length > 500) throw new Error("INVALID_SUBJECT");
  if (role !== "student" && role !== "teacher") throw new Error("INVALID_SUBJECT_ROLE");
  return { id, name, qrKey, role, active: subject.active !== false };
}

function validateCheckin(body: CheckinRequest): void {
  if (!body || typeof body !== "object") throw new Error("INVALID_BODY");
  if (!String(body.qrKey ?? "").trim() || String(body.qrKey).length > 500) throw new Error("INVALID_QR_KEY");
  if (!RECEIPT_PATTERN.test(String(body.receiptId ?? ""))) throw new Error("INVALID_RECEIPT_ID");
  if (!String(body.deviceId ?? "").trim() || String(body.deviceId).length > 120) throw new Error("INVALID_DEVICE_ID");
  if (body.photoBase64 !== undefined) {
    if (typeof body.photoBase64 !== "string" || body.photoBase64.length > MAX_PHOTO_BASE64_LENGTH) throw new Error("INVALID_PHOTO");
    if (body.photoBase64 && !/^data:image\/jpeg;base64,/i.test(body.photoBase64)) throw new Error("INVALID_PHOTO");
  }
  if (body.clientTimings !== undefined && (
    typeof body.clientTimings !== "object" || body.clientTimings === null || Array.isArray(body.clientTimings)
  )) throw new Error("INVALID_CLIENT_TIMINGS");
}

function validateReceiptStatus(body: ReceiptStatusRequest): void {
  if (!body || typeof body !== "object") throw new Error("INVALID_BODY");
  if (!RECEIPT_PATTERN.test(String(body.receiptId ?? ""))) throw new Error("INVALID_RECEIPT_ID");
}

export function resolveCheckinCampus(campus: unknown): "jinryo" | "integration-test" {
  return campus === "integration-test" ? "integration-test" : "jinryo";
}

export async function terminalAuthorized(
  request: Request,
  env: TerminalTokenEnv,
  campus: string,
): Promise<boolean> {
  if (campus === "integration-test") return authorized(request, env.INTEGRATION_TEST_TOKEN);
  if (campus !== "jinryo" && campus !== "otemachi") return false;
  return authorizedAny(request, [
    env.TERMINAL_TOKEN,
    env.TERMINAL_TOKEN_JINRYO,
    env.TERMINAL_TOKEN_OTEMACHI,
  ]);
}

export async function checkinAuthorized(
  request: Request,
  env: TerminalTokenEnv,
  campus: string,
): Promise<boolean> {
  if (await terminalAuthorized(request, env, campus)) return true;
  if (campus === "integration-test") return false;
  if (campus !== "jinryo" && campus !== "otemachi") return false;
  return legacyTerminalCookieAuthorized(request, env);
}

export async function legacyTerminalCookieHeader(
  request: Request,
  env: TerminalTokenEnv,
): Promise<string | null> {
  const value = await legacyTerminalCookieValue(request, env);
  if (!value) return null;
  return `${LEGACY_TERMINAL_COOKIE}=${value}; Path=/; Max-Age=${LEGACY_TERMINAL_COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Strict`;
}

async function legacyTerminalCookieAuthorized(request: Request, env: TerminalTokenEnv): Promise<boolean> {
  const supplied = cookieValue(request, LEGACY_TERMINAL_COOKIE);
  if (!supplied) return false;
  const expected = await legacyTerminalCookieValue(request, env);
  if (!expected) return false;
  return secretsEqual(supplied, expected);
}

async function legacyTerminalCookieValue(request: Request, env: TerminalTokenEnv): Promise<string | null> {
  const secret = env.TERMINAL_TOKEN || env.TERMINAL_TOKEN_JINRYO || env.TERMINAL_TOKEN_OTEMACHI;
  if (!secret) return null;
  const userAgent = request.headers.get("User-Agent") ?? "";
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`legacy-terminal-v1\n${userAgent}`));
  return bytesToBase64Url(new Uint8Array(signature));
}

function cookieValue(request: Request, name: string): string {
  const cookies = request.headers.get("Cookie") ?? "";
  for (const part of cookies.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return "";
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function secretsEqual(leftValue: string, rightValue: string): Promise<boolean> {
  if (leftValue.length !== rightValue.length) return false;
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(leftValue)),
    crypto.subtle.digest("SHA-256", encoder.encode(rightValue)),
  ]);
  const left = new Uint8Array(leftDigest);
  const right = new Uint8Array(rightDigest);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function checkinClientResponse(result: AcceptResponse): Record<string, unknown> {
  if (!result.ok) return { ...result };
  return {
    ...result,
    attendanceSaved: true,
    isTeacher: result.role === "teacher",
    label: result.acceptedAt ? formatTokyoLabel(result.acceptedAt) : "",
    mailStatus: result.legacyState === "PENDING" || result.legacyState === "RETRYING" ? "PENDING" : "NOT_REQUIRED",
    message: result.duplicate ? "60秒以内の同じ受付です" : "受付しました",
  };
}

function receiptStatusClientResponse(status: LegacyStatusResponse): Record<string, unknown> {
  if (status.state === "COMPLETED" && status.responseJson) {
    const response = JSON.parse(status.responseJson) as Record<string, unknown>;
    return { ...response, edgeWriteState: status.state };
  }
  if (status.state === "PENDING" || status.state === "RETRYING") {
    return {
      ok: true,
      code: "EDGE_WRITE_PENDING",
      attendanceSaved: true,
      receiptId: status.receiptId,
      mailStatus: "PENDING",
      edgeWriteState: status.state,
      attempts: status.attempts ?? 0,
      retryReason: status.lastError,
    };
  }
  if (status.state === "NOT_REQUIRED") {
    return {
      ok: true,
      code: "EDGE_WRITE_NOT_REQUIRED",
      attendanceSaved: true,
      receiptId: status.receiptId,
      mailStatus: "NOT_REQUIRED",
      edgeWriteState: status.state,
    };
  }
  return {
    ok: false,
    code: "RECEIPT_NOT_FOUND",
    attendanceSaved: false,
    receiptId: status.receiptId,
    mailStatus: "NOT_STARTED",
    edgeWriteState: status.state,
  };
}

function formatTokyoLabel(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("month")}月${value("day")}日${value("hour")}時${value("minute")}分`;
}

async function readJson<T>(request: Request): Promise<T> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("INVALID_JSON");
  }
}

async function authorized(request: Request, expected: string | undefined): Promise<boolean> {
  return authorizedAny(request, [expected]);
}

async function authorizedAny(request: Request, expectedValues: Array<string | undefined>): Promise<boolean> {
  const expectedTokens = [...new Set(expectedValues.filter((value): value is string => typeof value === "string" && value.length > 0))];
  if (expectedTokens.length === 0) return false;
  const supplied = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const encoder = new TextEncoder();
  const suppliedDigest = await crypto.subtle.digest("SHA-256", encoder.encode(supplied));
  const expectedDigests = await Promise.all(expectedTokens.map((token) => (
    crypto.subtle.digest("SHA-256", encoder.encode(token))
  )));
  const left = new Uint8Array(suppliedDigest);
  return expectedDigests.some((digest) => {
    const right = new Uint8Array(digest);
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
    return difference === 0;
  });
}

function corsPreflight(origin: string, env: AppEnv): Response {
  if (origin !== env.ALLOWED_ORIGIN) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data: unknown, status: number, origin: string, env: AppEnv): Response {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  if (origin === env.ALLOWED_ORIGIN) {
    for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
  }
  return new Response(JSON.stringify(data), { status, headers });
}
