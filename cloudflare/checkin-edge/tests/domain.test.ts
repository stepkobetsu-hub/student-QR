import { describe, expect, it } from "vitest";
import { decideAttendance, tokyoDateKey } from "../src/domain";

describe("decideAttendance", () => {
  it("accepts the first student stamp as entry", () => {
    expect(decideAttendance("student", 1_000, null)).toEqual({
      type: "入室",
      duplicate: false,
      nextCount: 1,
    });
  });

  it("accepts the second student stamp as exit", () => {
    expect(decideAttendance("student", 70_001, {
      lastType: "入室",
      lastAcceptedAt: 1_000,
      count: 1,
    })).toEqual({ type: "退室", duplicate: false, nextCount: 2 });
  });

  it("does not flip the state inside the duplicate window", () => {
    expect(decideAttendance("student", 40_999, {
      lastType: "入室",
      lastAcceptedAt: 1_000,
      count: 1,
    })).toEqual({ type: "入室", duplicate: true, nextCount: 1 });
  });


  it("accepts a new stamp at exactly 40 seconds", () => {
    expect(decideAttendance("student", 41_000, {
      lastType: "入室",
      lastAcceptedAt: 1_000,
      count: 1,
    })).toEqual({ type: "退室", duplicate: false, nextCount: 2 });
  });

  it("uses teacher labels", () => {
    expect(decideAttendance("teacher", 1_000, null).type).toBe("出勤");
    expect(decideAttendance("teacher", 70_001, {
      lastType: "出勤",
      lastAcceptedAt: 1_000,
      count: 1,
    }).type).toBe("退勤");
  });
});

describe("tokyoDateKey", () => {
  it("changes day at midnight in Tokyo", () => {
    expect(tokyoDateKey(Date.parse("2026-08-06T14:59:59Z"))).toBe("2026-08-06");
    expect(tokyoDateKey(Date.parse("2026-08-06T15:00:00Z"))).toBe("2026-08-07");
  });
});
