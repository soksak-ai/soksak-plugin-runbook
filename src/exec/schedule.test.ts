// nextOccurrence 단위 — 반복/간격의 다음 발화 시각(순수). daily/weekly=고정 24h/7d(예측가능·DST 무관),
// monthly=달력 한 달(Date, 로컬), interval(초)=주기·repeat 보다 우선, none=단발(과거면 null).
import { describe, expect, it } from "vitest";
import { nextOccurrence } from "./schedule";

// 로컬 기준 시각(monthly 가 로컬 달력이라 로컬로 구성 — daily/weekly/interval 은 고정 ms 라 TZ 무관).
const AT = new Date(2026, 5, 19, 10, 0, 0).getTime(); // 2026-06-19 10:00 로컬
const DAY = 86_400_000;
const WEEK = 604_800_000;

describe("nextOccurrence — 발화 시각(순수)", () => {
  it("none: 미래면 scheduleAt, 지났으면 null", () => {
    expect(nextOccurrence(AT, "none", 0, AT - 1000)).toBe(AT);
    expect(nextOccurrence(AT, "none", 0, AT + 1000)).toBeNull();
    expect(nextOccurrence(AT, undefined, undefined, AT - 1)).toBe(AT);
  });

  it("daily: after 가 scheduleAt 이상이면 +1일(24h)", () => {
    expect(nextOccurrence(AT, "daily", 0, AT - 1)).toBe(AT); // 아직 안 지남
    expect(nextOccurrence(AT, "daily", 0, AT)).toBe(AT + DAY); // after=AT → 다음날
    expect(nextOccurrence(AT, "daily", 0, AT + DAY + 100)).toBe(AT + 2 * DAY);
  });

  it("weekly: +7일", () => {
    expect(nextOccurrence(AT, "weekly", 0, AT)).toBe(AT + WEEK);
    expect(nextOccurrence(AT, "weekly", 0, AT - 1)).toBe(AT);
  });

  it("monthly: 달력 한 달(가변 길이, 로컬)", () => {
    // 2026-06-19 → 2026-07-19 (로컬).
    expect(nextOccurrence(AT, "monthly", 0, AT)).toBe(new Date(2026, 6, 19, 10, 0, 0).getTime());
    expect(nextOccurrence(AT, "monthly", 0, AT - 1)).toBe(AT);
  });

  it("interval(초): 주기이며 repeat 보다 우선", () => {
    // 1시간 주기. after=AT → AT+1h.
    expect(nextOccurrence(AT, "none", 3600, AT)).toBe(AT + 3_600_000);
    // after=AT+90분 → AT+2h(다음 주기). interval 이 있으니 daily 는 무시.
    expect(nextOccurrence(AT, "daily", 3600, AT + 5_400_000)).toBe(AT + 7_200_000);
  });
});
