import { describe, expect, it, vi } from "vitest";
import { acceptWithRosterRefresh, type CampusCheckinApi } from "../src/index";
import type { AcceptRequest, AcceptResponse } from "../src/checkin-do";

const input: AcceptRequest = {
  qrKey: "new-student-qr",
  receiptId: "new-student-receipt",
  deviceId: "tablet-a",
  acceptedAt: 1_786_091_200_000,
};

describe("acceptWithRosterRefresh", () => {
  it("refreshes the roster and retries the same scan once", async () => {
    let rosterAvailable = false;
    const accepted: AcceptResponse = {
      ok: true,
      code: "ACCEPTED",
      receiptId: input.receiptId,
      subjectId: "new-student-001",
      name: "新規生徒",
      role: "student",
      type: "入室",
      duplicate: false,
      acceptedAt: input.acceptedAt,
      dateKey: "2026-08-07",
      legacyState: "PENDING",
    };
    const stub: CampusCheckinApi = {
      accept: vi.fn(async () => rosterAvailable
        ? accepted
        : { ok: false, code: "SUBJECT_NOT_FOUND", receiptId: input.receiptId }),
      claimRosterRefresh: vi.fn(async () => ({ claimed: true, reason: "CLAIMED" as const, retryAfterMs: 0 })),
      completeRosterRefresh: vi.fn(async () => undefined),
    };
    const refreshRoster = vi.fn(async () => {
      rosterAvailable = true;
    });

    const result = await acceptWithRosterRefresh(stub, input, refreshRoster, () => 200_000, "otemachi");

    expect(result).toBe(accepted);
    expect(stub.accept).toHaveBeenCalledTimes(2);
    expect(stub.accept).toHaveBeenNthCalledWith(1, input);
    expect(stub.accept).toHaveBeenNthCalledWith(2, input);
    expect(refreshRoster).toHaveBeenCalledTimes(1);
    expect(stub.completeRosterRefresh).toHaveBeenCalledWith(200_000, true);
  });

  it("does not repeatedly fetch the source during the campus cooldown", async () => {
    const missing: AcceptResponse = {
      ok: false,
      code: "SUBJECT_NOT_FOUND",
      receiptId: input.receiptId,
    };
    const stub: CampusCheckinApi = {
      accept: vi.fn(async () => missing),
      claimRosterRefresh: vi.fn(async () => ({ claimed: false, reason: "COOLDOWN" as const, retryAfterMs: 10_000 })),
      completeRosterRefresh: vi.fn(async () => undefined),
    };
    const refreshRoster = vi.fn(async () => undefined);

    const result = await acceptWithRosterRefresh(stub, input, refreshRoster, () => 200_000, "jinryo");

    expect(result).toBe(missing);
    expect(stub.accept).toHaveBeenCalledTimes(2);
    expect(refreshRoster).not.toHaveBeenCalled();
    expect(stub.completeRosterRefresh).not.toHaveBeenCalled();
  });
});
