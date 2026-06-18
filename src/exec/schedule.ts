// schedule 실행타입의 발화 시각 계산(순수) — 코어 app.schedule 은 "절대 시각에 한 번 발화"만 알고,
// 반복·간격의 다음 시각은 여기(Date 보유)서 정해 재무장한다(R11: 정책=스케줄링 측). 코어가 발화하면
// 다음 occurrence 를 다시 schedule.set 한다.
//
// nextOccurrence(scheduleAt, repeat, intervalSec, after) = `after` 보다 큰 가장 이른 발화 시각, 없으면
// null. interval 이 양수면 주기(초) 우선, 아니면 repeat(daily/weekly/monthly), 둘 다 아니면 단발(none).

const DAY_MS = 86_400_000;
const WEEK_MS = 604_800_000;

/** 고정 간격(ms)의 다음 발화 — after 보다 큰 가장 이른 scheduleAt + k*step(k>=0). */
function nextFixed(scheduleAt: number, stepMs: number, after: number): number {
  if (scheduleAt > after) return scheduleAt;
  const k = Math.floor((after - scheduleAt) / stepMs) + 1;
  return scheduleAt + k * stepMs;
}

/** 달력 월 단위 다음 발화 — after 보다 큰 가장 이른 scheduleAt+k개월(k>=0). 월 길이 가변이라 Date 로 누적. */
function nextMonthly(scheduleAt: number, after: number): number | null {
  if (scheduleAt > after) return scheduleAt;
  // after 가 먼 미래여도 유한 — 경과 개월 수만큼만 돈다. 안전 상한(~1200개월=100년).
  for (let k = 1; k <= 1200; k++) {
    const d = new Date(scheduleAt);
    d.setMonth(d.getMonth() + k);
    const t = d.getTime();
    if (t > after) return t;
  }
  return null;
}

export function nextOccurrence(
  scheduleAt: number,
  repeat: string | undefined,
  intervalSec: number | undefined,
  after: number,
): number | null {
  if (intervalSec && intervalSec > 0) {
    return nextFixed(scheduleAt, intervalSec * 1000, after);
  }
  switch (repeat) {
    case "daily":
      return nextFixed(scheduleAt, DAY_MS, after);
    case "weekly":
      return nextFixed(scheduleAt, WEEK_MS, after);
    case "monthly":
      return nextMonthly(scheduleAt, after);
    default:
      // none — 단발. scheduleAt 가 아직 안 지났으면 그때, 지났으면 없음(과거 단발 미발화).
      return scheduleAt > after ? scheduleAt : null;
  }
}
