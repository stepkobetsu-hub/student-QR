import { describe, expect, it, vi } from "vitest";
import { postLegacyCheckin } from "../src/checkin-do";

describe("postLegacyCheckin", () => {
  it("sends the existing Apps Script action with the same receipt", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(init?.headers).toEqual({ "Content-Type": "text/plain;charset=utf-8" });
      expect(body).toEqual({
        action: "edgeCheckInProbe",
        qrData: "dummy-qr-write",
        photoBase64: "data:image/jpeg;base64,dGVzdA==",
        receiptId: "legacy-write-receipt",
        acceptedAt: 1_786_091_200_000,
        edgeToken: "test-edge-token",
        clientTimings: { scanMs: 20 },
        retry: false,
      });
      return new Response(JSON.stringify({
        ok: true,
        code: "ATTENDANCE_SAVED",
        attendanceSaved: true,
        mailStatus: "PENDING",
        totalPoints: 12,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const result = await postLegacyCheckin("https://example.test/exec", {
      action: "edgeCheckInProbe",
      receiptId: "legacy-write-receipt",
      acceptedAt: 1_786_091_200_000,
      edgeToken: "test-edge-token",
      qrKey: "dummy-qr-write",
      photoBase64: "data:image/jpeg;base64,dGVzdA==",
      clientTimingsJson: JSON.stringify({ scanMs: 20 }),
      attempts: 0,
    }, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.totalPoints).toBe(12);
  });

  it("retries when Apps Script has not saved attendance", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      code: "BUSY",
      attendanceSaved: false,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(postLegacyCheckin("https://example.test/exec", {
      action: "checkIn",
      receiptId: "legacy-retry-receipt",
      acceptedAt: 1_786_091_200_000,
      edgeToken: "test-edge-token",
      qrKey: "dummy-qr-retry",
      photoBase64: "",
      clientTimingsJson: "{}",
      attempts: 1,
    }, fetcher)).rejects.toThrow("BUSY");
  });

  it("uses the authenticated roster export as a no-write staging probe", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.action).toBe("edgeRosterExport");
      expect(body.token).toBe("test-edge-token");
      return new Response(JSON.stringify({
        ok: true,
        campuses: [
          { campus: "jinryo", subjects: [] },
          { campus: "otemachi", subjects: [] },
        ],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const result = await postLegacyCheckin("https://example.test/exec", {
      action: "edgeRosterExport",
      receiptId: "legacy-probe-receipt",
      acceptedAt: 1_786_091_200_000,
      edgeToken: "test-edge-token",
      qrKey: "dummy-qr-probe",
      photoBase64: "",
      clientTimingsJson: "{}",
      attempts: 2,
    }, fetcher);

    expect(result).toMatchObject({
      ok: true,
      code: "EDGE_PROBE_ACCEPTED",
      attendanceSaved: true,
      mailStatus: "NOT_REQUIRED",
      receiptId: "legacy-probe-receipt",
      probe: true,
    });
  });
});
