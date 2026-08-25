export type SubjectRole = "student" | "teacher";

export type CheckinType = "入室" | "退室" | "出勤" | "退勤";

export interface PreviousAttendance {
  lastType: CheckinType;
  lastAcceptedAt: number;
  count: number;
}

export interface AttendanceDecision {
  type: CheckinType;
  duplicate: boolean;
  nextCount: number;
}

export const DUPLICATE_WINDOW_MS = 30_000;

export function decideAttendance(
  role: SubjectRole,
  nowMs: number,
  previous: PreviousAttendance | null,
  duplicateWindowMs = DUPLICATE_WINDOW_MS,
): AttendanceDecision {
  if (previous && nowMs - previous.lastAcceptedAt < duplicateWindowMs) {
    return {
      type: previous.lastType,
      duplicate: true,
      nextCount: previous.count,
    };
  }

  const nextCount = (previous?.count ?? 0) + 1;
  const entering = nextCount % 2 === 1;
  return {
    type: role === "teacher"
      ? (entering ? "出勤" : "退勤")
      : (entering ? "入室" : "退室"),
    duplicate: false,
    nextCount,
  };
}

export function tokyoDateKey(timestampMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestampMs));
}
