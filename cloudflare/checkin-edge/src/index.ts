import { CampusCheckin, type AcceptRequest, type RosterSubject } from "./checkin-do";

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

type AppEnv = Env & {
  ENVIRONMENT: string;
  ALLOWED_ORIGIN: string;
  TERMINAL_TOKEN: string;
  SYNC_TOKEN: string;
  ROSTER_SOURCE_URL: string;
  ROSTER_SOURCE_TOKEN: string;
};

const MAX_BODY_BYTES = 2_000_000;
const CAMPUS_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const RECEIPT_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const origin = request.headers.get("Origin") ?? "";
    if (request.method === "OPTIONS") return corsPreflight(origin, env);

    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, service: "step-checkin-edge", environment: env.ENVIRONMENT }, 200, origin, env);
      }
      if (request.method === "POST" && url.pathname === "/v1/checkins") {
        if (!await authorized(request, env.TERMINAL_TOKEN)) return json({ ok: false, code: "UNAUTHORIZED" }, 401, origin, env);
        const body = await readJson<AcceptRequest & { campus: string }>(request);
        validateCheckin(body);
        const stub = env.CAMPUS_CHECKIN.getByName(body.campus);
        const result = await stub.accept({
          qrKey: body.qrKey,
          receiptId: body.receiptId,
          deviceId: body.deviceId,
          acceptedAt: Date.now(),
        });
        console.log(JSON.stringify({ event: "checkin", campus: body.campus, code: result.code, receiptId: body.receiptId }));
        return json(result, result.ok ? 200 : 404, origin, env);
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

async function syncFromGoogle(env: AppEnv): Promise<RosterSyncResult[]> {
  if (!env.ROSTER_SOURCE_URL || !env.ROSTER_SOURCE_TOKEN) throw new Error("ROSTER_SOURCE_NOT_CONFIGURED");
  const response = await fetch(env.ROSTER_SOURCE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "edgeRosterExport",
      token: env.ROSTER_SOURCE_TOKEN,
    }),
  });
  if (!response.ok) throw new Error(`ROSTER_SOURCE_HTTP_${response.status}`);
  const payload = await response.json<RosterSourceResponse>();
  if (!payload.ok || !Array.isArray(payload.campuses)) throw new Error("INVALID_ROSTER_SOURCE_RESPONSE");
  const result = await syncCampuses(env, payload.campuses);
  console.log(JSON.stringify({ event: "roster_sync", result }));
  return result;
}

async function syncCampuses(
  env: AppEnv,
  campuses: RosterSourceResponse["campuses"],
): Promise<RosterSyncResult[]> {
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

function validateCheckin(body: AcceptRequest & { campus: string }): void {
  if (!body || typeof body !== "object") throw new Error("INVALID_BODY");
  if (!CAMPUS_PATTERN.test(String(body.campus ?? ""))) throw new Error("INVALID_CAMPUS");
  if (!String(body.qrKey ?? "").trim() || String(body.qrKey).length > 500) throw new Error("INVALID_QR_KEY");
  if (!RECEIPT_PATTERN.test(String(body.receiptId ?? ""))) throw new Error("INVALID_RECEIPT_ID");
  if (!String(body.deviceId ?? "").trim() || String(body.deviceId).length > 120) throw new Error("INVALID_DEVICE_ID");
}

async function readJson<T>(request: Request): Promise<T> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
  return request.json<T>();
}

async function authorized(request: Request, expected: string | undefined): Promise<boolean> {
  if (!expected) return false;
  const supplied = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function corsPreflight(origin: string, env: AppEnv): Response {
  if (origin !== env.ALLOWED_ORIGIN) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
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
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (origin === env.ALLOWED_ORIGIN) {
    for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
  }
  return new Response(JSON.stringify(data), { status, headers });
}
