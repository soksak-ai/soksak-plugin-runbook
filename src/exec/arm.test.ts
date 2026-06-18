// armSchedule/cancelSchedule 단위 — schedule 명령을 코어 schedule.set(발화) + notify.show(리마인더)로
// 등록·취소한다. fake execute 로 호출을 포착(외부 코어 없이 계약 검증). now 주입으로 결정적.
import { describe, expect, it } from "vitest";
import { armSchedule, cancelSchedule } from "./arm";
import type { CommandRecord } from "../data/model";

type Call = { name: string; params?: Record<string, unknown> };
function fakeExec(captured: Call[]) {
  return async (name: string, params?: Record<string, unknown>) => {
    captured.push({ name, params });
    return name === "schedule.set" ? { scheduleId: (params?.id as string) ?? "auto" } : {};
  };
}

function schedRec(over: Partial<CommandRecord>): CommandRecord {
  return {
    id: "c1",
    label: "백업",
    groupId: "g",
    order: 0,
    command: "make backup",
    executionType: "schedule",
    deleted: false,
    favorite: false,
    ...over,
  };
}

const NOW = new Date(2026, 5, 19, 9, 0, 0).getTime();
const AT = new Date(2026, 5, 19, 10, 0, 0).getTime(); // NOW + 1h

const sets = (c: Call[]) => c.filter((x) => x.name === "schedule.set");
const cancels = (c: Call[]) => c.filter((x) => x.name === "schedule.cancel");

describe("armSchedule — 등록", () => {
  it("daily + 리마인더 → fire(다음 occurrence) + notify.show 들", async () => {
    const cap: Call[] = [];
    const r = await armSchedule(
      { execute: fakeExec(cap) },
      schedRec({ scheduleAt: AT, repeatType: "daily", reminderSecs: [300, 1800] }),
      "s1",
      NOW,
    );
    expect(r.ok && r.scheduled).toBe(true);
    if (r.ok && r.scheduled) expect(r.nextAt).toBe(AT); // 아직 안 지남 → scheduleAt
    const ss = sets(cap);
    expect(ss.length).toBe(3); // fire + 2 리마인더
    const fire = ss.find((x) => x.params?.id === "runbook:c1");
    expect(fire?.params?.at).toBe(AT);
    expect(fire?.params?.command).toBe("plugin.soksak-plugin-runbook.runbook.schedule.fire");
    expect((fire?.params?.params as { commandId: string }).commandId).toBe("c1");
    expect(ss.find((x) => x.params?.id === "runbook:c1:r0")?.params?.at).toBe(AT - 300_000);
    expect(ss.find((x) => x.params?.id === "runbook:c1:r1")?.params?.at).toBe(AT - 1_800_000);
    expect(ss.find((x) => x.params?.id === "runbook:c1:r0")?.params?.command).toBe("notify.show");
  });

  it("과거 단발(none) → 미등록(scheduled:false) + 기존 정리(cancel)", async () => {
    const cap: Call[] = [];
    const r = await armSchedule(
      { execute: fakeExec(cap) },
      schedRec({ scheduleAt: NOW - 10_000, repeatType: "none" }),
      "s1",
      NOW,
    );
    expect(r.ok && !r.scheduled).toBe(true);
    expect(sets(cap).length).toBe(0); // 발화 등록 0
    expect(cancels(cap).length).toBeGreaterThanOrEqual(1); // 정리 cancel
  });

  it("이미 지난 리마인더는 스킵(미래 것만 등록)", async () => {
    const cap: Call[] = [];
    // r0=300s 전(AT-5분, NOW 이후 → 등록), r1=7200s 전(AT-2h = NOW-1h, 과거 → 스킵).
    await armSchedule(
      { execute: fakeExec(cap) },
      schedRec({ scheduleAt: AT, repeatType: "none", reminderSecs: [300, 7200] }),
      "s1",
      NOW,
    );
    const ss = sets(cap);
    expect(ss.some((x) => x.params?.id === "runbook:c1:r0")).toBe(true);
    expect(ss.some((x) => x.params?.id === "runbook:c1:r1")).toBe(false); // 과거 리마인더 스킵
  });

  it("execute 표면 없음 → NO_RUNTIME", async () => {
    const r = await armSchedule({}, schedRec({ scheduleAt: AT }), "s1", NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NO_RUNTIME");
  });
});

describe("cancelSchedule — 취소", () => {
  it("발화 + 리마인더 id 들 모두 cancel", async () => {
    const cap: Call[] = [];
    await cancelSchedule(
      { execute: fakeExec(cap) },
      schedRec({ reminderSecs: [300, 1800] }),
    );
    const c = cancels(cap);
    expect(c.length).toBe(3); // fire + r0 + r1
    expect(c.some((x) => x.params?.id === "runbook:c1")).toBe(true);
    expect(c.some((x) => x.params?.id === "runbook:c1:r0")).toBe(true);
    expect(c.some((x) => x.params?.id === "runbook:c1:r1")).toBe(true);
  });
});
