// schedule 명령의 예약(arm)·취소 — 코어 app.schedule(절대시각 발화) + notify.show(리마인더)를 조합한다.
// 코어는 "한 번 발화"만 알므로, 반복은 발화 후 재무장(다음 occurrence 를 다시 arm)하고 리마인더는
// 예약된 notify.show 로 푼다(R11: 정책=여기). 결정적 id 라 재-arm 은 교체(중복 0), 취소는 그 id 제거.

import { nextOccurrence } from "./schedule";
import type { CommandRecord } from "../data/model";

/** app.commands.execute 표면(schedule.set/cancel·notify.show 호출용). 결과 shape 은 느슨히 받는다. */
export interface ScheduleDeps {
  execute?: (
    name: string,
    params?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
}

const PLUGIN = "soksak-plugin-runbook";
const FIRE_CMD = `plugin.${PLUGIN}.runbook.schedule.fire`;
const fireId = (commandId: string) => `runbook:${commandId}`;
const reminderId = (commandId: string, i: number) => `runbook:${commandId}:r${i}`;

export type ArmResult =
  | { ok: true; scheduled: true; nextAt: number; scheduleId: string }
  | { ok: true; scheduled: false; reason: string }
  | { ok: false; code: "NO_RUNTIME"; message: string };

/** schedule 명령을 등록 — now 이후 다음 occurrence 발화(schedule.fire) + 미래 리마인더(notify.show).
 *  단발이 지났으면 미등록(기존 정리). 결정적 id 로 교체. now 는 호출자가 주입(테스트 결정성). */
export async function armSchedule(
  deps: ScheduleDeps,
  rec: CommandRecord,
  scope: string | undefined,
  now: number,
): Promise<ArmResult> {
  const exec = deps.execute;
  if (!exec) return { ok: false, code: "NO_RUNTIME", message: "commands 표면 없음 — schedule 등록 불가" };
  const commandId = String(rec.id);
  const at = typeof rec.scheduleAt === "number" ? rec.scheduleAt : 0;
  const next = nextOccurrence(at, rec.repeatType, rec.intervalSec, now);
  if (next == null) {
    await cancelSchedule(deps, rec); // 과거 단발 — 흔적 정리.
    return { ok: true, scheduled: false, reason: "발화할 미래 시각 없음(과거 단발)" };
  }
  const set = await exec("schedule.set", {
    at: next,
    command: FIRE_CMD,
    params: { commandId, scope: scope ?? null },
    id: fireId(commandId),
  });
  const scheduleId = (set.scheduleId as string | undefined) ?? fireId(commandId);
  // 리마인더 — next - offset(초) 마다. 이미 지난 것은 스킵.
  const reminders = Array.isArray(rec.reminderSecs) ? rec.reminderSecs : [];
  for (let i = 0; i < reminders.length; i++) {
    const remAt = next - reminders[i] * 1000;
    if (remAt <= now) continue;
    await exec("schedule.set", {
      at: remAt,
      command: "notify.show",
      params: { title: `곧 실행: ${rec.label}`, body: `${reminders[i]}초 후 예약 실행` },
      id: reminderId(commandId, i),
    });
  }
  return { ok: true, scheduled: true, nextAt: next, scheduleId };
}

/** schedule 명령 등록 취소 — 발화 + 리마인더 id 들(reminderSecs 길이만큼). 멱등. */
export async function cancelSchedule(deps: ScheduleDeps, rec: CommandRecord): Promise<void> {
  const exec = deps.execute;
  if (!exec) return;
  const commandId = String(rec.id);
  await exec("schedule.cancel", { id: fireId(commandId) }).catch(() => {});
  const reminders = Array.isArray(rec.reminderSecs) ? rec.reminderSecs : [];
  for (let i = 0; i < reminders.length; i++) {
    await exec("schedule.cancel", { id: reminderId(commandId, i) }).catch(() => {});
  }
}
