import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("CampusCheckin Durable Object", () => {
  it("shares one attendance decision across simultaneous tablets", async () => {
    const campus = env.CAMPUS_CHECKIN.getByName("concurrent-campus");
    await campus.syncRoster([{
      id: "dummy-001",
      name: "試験太郎",
      qrKey: "dummy-qr-001",
      role: "student",
      active: true,
    }], Date.now());

    const acceptedAt = Date.parse("2026-08-07T07:30:00+09:00");
    const [tabletA, tabletB] = await Promise.all([
      campus.accept({
        qrKey: "dummy-qr-001",
        receiptId: "test-receipt-tablet-a",
        deviceId: "tablet-a",
        acceptedAt,
      }),
      campus.accept({
        qrKey: "dummy-qr-001",
        receiptId: "test-receipt-tablet-b",
        deviceId: "tablet-b",
        acceptedAt: acceptedAt + 10,
      }),
    ]);

    expect(tabletA.type).toBe("入室");
    expect(tabletB.type).toBe("入室");
    expect([tabletA.duplicate, tabletB.duplicate].filter(Boolean)).toHaveLength(1);
  });

  it("returns exit after the duplicate window", async () => {
    const campus = env.CAMPUS_CHECKIN.getByName("entry-exit-campus");
    await campus.syncRoster([{
      id: "dummy-002",
      name: "試験花子",
      qrKey: "dummy-qr-002",
      role: "student",
      active: true,
    }], Date.now());

    const acceptedAt = Date.parse("2026-08-07T15:00:00+09:00");
    const entry = await campus.accept({
      qrKey: "dummy-qr-002",
      receiptId: "test-entry-receipt",
      deviceId: "tablet-a",
      acceptedAt,
    });
    const exit = await campus.accept({
      qrKey: "dummy-qr-002",
      receiptId: "test-exit-receipt",
      deviceId: "tablet-b",
      acceptedAt: acceptedAt + 60_001,
    });

    expect(entry.type).toBe("入室");
    expect(exit.type).toBe("退室");
    expect(exit.duplicate).toBe(false);
  });

  it("is idempotent for a retried receipt", async () => {
    const campus = env.CAMPUS_CHECKIN.getByName("retry-campus");
    await campus.syncRoster([{
      id: "dummy-003",
      name: "試験次郎",
      qrKey: "dummy-qr-003",
      role: "student",
      active: true,
    }], Date.now());
    const input = {
      qrKey: "dummy-qr-003",
      receiptId: "same-receipt-on-retry",
      deviceId: "tablet-a",
      acceptedAt: Date.parse("2026-08-07T16:00:00+09:00"),
    };

    const first = await campus.accept(input);
    const retry = await campus.accept(input);

    expect(first.type).toBe("入室");
    expect(retry.type).toBe("入室");
    expect(retry.code).toBe("ALREADY_ACCEPTED");
  });
});
