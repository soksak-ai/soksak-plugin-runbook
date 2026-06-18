#!/usr/bin/env node
// soksak-plugin-runbook schedule(cron) 실행타입 E2E — 실제 타이머 발화 + 재무장(R11).
//
// 소켓으로 실제 앱을 구동한다. schedule 명령은 command.run 으로 즉시 실행이 아니라 코어 app.schedule 에
// 예약(arm)된다. 코어 타이머가 due 시각에 runbook.schedule.fire 를 호출하면 action(셸)이 실행되고,
// 반복/간격이면 다음 occurrence 를 재무장한다. 두 축으로 단언한다:
//   (a) 근미래 단발(none) 예약 → 코어가 실제로 발화 → action 출력이 lastOutput/history 에(타이머 실증),
//       단발이라 발화 후 미재무장(schedule.list 에서 빠짐).
//   (b) daily 예약 후 runbook.schedule.fire 직접 호출(스케줄러 발화 모사) → action 실행 + 다음 occurrence
//       (~+1일) 재무장(schedule.list 에 잔류).
//
// 전제: 코어 app(make dev) 실행 중 + dev-load 가능. (notify/reminder 는 OS UI 부수효과라 E2E 제외 —
// arm 단위 테스트가 notify.show 예약을 검증.)
// 사용: SOKSAK_SOCKET=~/.soksak/com.soksak.dev.sock node e2e/runbook-schedule.mjs   (repo 루트)
// 종료코드: 0 = 전부 PASS, 1 = FAIL.

import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SOCKET =
  process.env.SOKSAK_SOCKET || path.join(os.homedir(), ".soksak", "com.soksak.dev.sock");
const PLUGIN = "soksak-plugin-runbook";
const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN = Date.now().toString(36);
const SCOPE = `e2e-runbook-sch-${RUN}`;

let sock,
  seq = 0;
const pending = new Map();
let rbuf = "";
function connect() {
  return new Promise((resolve, reject) => {
    sock = net.createConnection(SOCKET);
    sock.setNoDelay(true);
    sock.once("connect", resolve);
    sock.once("error", reject);
    sock.on("data", (d) => {
      rbuf += d.toString("utf8");
      let i;
      while ((i = rbuf.indexOf("\n")) >= 0) {
        const line = rbuf.slice(0, i);
        rbuf = rbuf.slice(i + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          p(msg);
        }
      }
    });
  });
}
function rpc(method, params = {}, opts = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    sock.write(JSON.stringify({ id, method, params, ...opts }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`TIMEOUT ${method}`));
      }
    }, 20000);
  });
}
const m = (name, params, opts) => rpc(`plugin.${PLUGIN}.runbook.${name}`, params, opts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitSocketReady(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await rpc("state.context", {});
      if (r.ok) return true;
    } catch {
      /* 미준비 */
    }
    await sleep(500);
  }
  return false;
}

let passed = 0;
const failures = [];
function ok(cond, label) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}
function section(name) {
  console.log(`\n[${name}]`);
}

// 코어 schedule.list 에 id 존재 여부.
async function scheduled(id) {
  const r = await rpc("schedule.list", {});
  const list = Array.isArray(r.schedules) ? r.schedules : [];
  return list.find((s) => s.id === id) ?? null;
}

async function main() {
  for (let i = 0; i < 60; i++) {
    try {
      await connect();
      break;
    } catch {
      await sleep(500);
    }
  }
  if (!sock) {
    console.error("소켓 연결 실패:", SOCKET);
    process.exit(1);
  }
  if (!(await waitSocketReady())) {
    console.error("앱 미준비(state.context) — dev 빌드 대기 초과");
    process.exit(1);
  }
  console.log(`소켓: ${SOCKET}\n스코프(격리): ${SCOPE}`);

  section("setup");
  await rpc("plugin.disable", { id: PLUGIN }).catch(() => {});
  const loaded = await rpc("plugin.dev.load", { path: PLUGIN_DIR });
  ok(loaded.ok !== false, "plugin.dev.load(최신 main.js)");
  const enabled = await rpc("plugin.enable", { id: PLUGIN });
  ok(enabled.ok !== false, "plugin.enable(dev 동의 면제)");

  try {
    // ── (a) 근미래 단발 → 실제 타이머 발화 ──
    section("a) 근미래 단발(none) — 실제 타이머 발화");
    const MARK = `sch-ran-${RUN}`;
    const at = Date.now() + 2500; // 2.5초 후
    const addA = await m("command.add", {
      scope: SCOPE,
      label: "A-once",
      command: `echo ${MARK}`,
      executionType: "schedule",
      scheduleAt: at,
      repeatType: "none",
    });
    ok(typeof addA.commandId === "string", "schedule command.add → commandId");
    const armA = await m("command.run", { scope: SCOPE, commandId: addA.commandId });
    ok(armA.ok === true && armA.scheduled === true, "command.run → 예약(arm, 즉시 실행 아님)");
    ok(Math.abs(armA.nextAt - at) < 1000, `nextAt ≈ scheduleAt(${armA.nextAt})`);
    const fireId = `runbook:${addA.commandId}`;
    ok((await scheduled(fireId)) != null, "코어 schedule.list 에 발화 등록됨");

    // 발화 대기(최대 ~7초 폴링) — lastExecutedAt 갱신을 관찰.
    let fired = null;
    for (let i = 0; i < 14; i++) {
      await sleep(600);
      const g = await m("command.get", { scope: SCOPE, commandId: addA.commandId });
      if (g.ok && g.command && typeof g.command.lastExecutedAt === "number") {
        fired = g.command;
        break;
      }
    }
    ok(fired != null, "코어 타이머가 due 시각에 발화함(lastExecutedAt 갱신)");
    ok(fired != null && String(fired.lastOutput).includes(MARK), "action(셸) 출력이 lastOutput 에");
    const histA = await m("history.list", { scope: SCOPE });
    ok(JSON.stringify(histA).includes(MARK), "히스토리에 발화 기록");
    ok((await scheduled(fireId)) == null, "단발 → 발화 후 미재무장(schedule.list 에서 빠짐)");

    // ── (b) daily — 실제 타이머 발화 후 다음 occurrence(+1일) 재무장 ──
    section("b) daily — 타이머 발화 후 +1일 재무장");
    const DAY = 86_400_000;
    const atB = Date.now() + 2000; // 2초 후 발화
    const markB = `daily-${RUN}`;
    const addB = await m("command.add", {
      scope: SCOPE,
      label: "B-daily",
      command: `echo ${markB}`,
      executionType: "schedule",
      scheduleAt: atB,
      repeatType: "daily",
    });
    const armB = await m("command.run", { scope: SCOPE, commandId: addB.commandId });
    ok(armB.ok === true && armB.scheduled === true, "daily 예약(arm)");
    const fireIdB = `runbook:${addB.commandId}`;
    const beforeFire = await scheduled(fireIdB);
    ok(beforeFire != null && Math.abs(beforeFire.at - atB) < 1000, "발화 등록(at≈scheduleAt)");

    // 타이머가 atB 에 발화 → action 실행 + daily 재무장. 발화(action 출력) 관찰까지 폴링.
    let firedB = false;
    let afterFire = null;
    for (let i = 0; i < 14; i++) {
      await sleep(600);
      const h = await m("history.list", { scope: SCOPE });
      if (JSON.stringify(h).includes(markB)) {
        firedB = true;
        afterFire = await scheduled(fireIdB);
        break;
      }
    }
    ok(firedB, "코어 타이머가 daily action 발화");
    ok(afterFire != null, "daily → 발화 후 재무장(schedule.list 잔류, 단발과 대비)");
    ok(afterFire != null && Math.abs(afterFire.at - (atB + DAY)) < 3000, "다음 occurrence = +1일 전진");

    // ── (c) 삭제 → 코어 등록 취소 ──
    section("c) 삭제 → 등록 취소");
    await m("command.delete", { scope: SCOPE, commandId: addB.commandId });
    ok((await scheduled(fireIdB)) == null, "휴지통 schedule → 코어 등록 취소(발화 안 함)");

    // ── teardown ──
    section("teardown");
    const hc = await m("history.clear", { scope: SCOPE });
    ok(hc.ok, `history.clear → ${hc.deleted}건`);
    const all = (await m("command.list", { scope: SCOPE })).commands;
    for (const c of all) await m("command.delete", { scope: SCOPE, commandId: c.id });
    // 잔여 등록 정리(혹시 남았으면).
    await rpc("schedule.cancel", { id: fireId }).catch(() => {});
    await rpc("schedule.cancel", { id: fireIdB }).catch(() => {});
    ok((await m("command.list", { scope: SCOPE })).commands.length === 0, "명령 정리 확인");
  } finally {
    /* 소켓만 — 서버 없음 */
  }

  console.log(`\n${"=".repeat(40)}`);
  if (failures.length === 0) {
    console.log(`PASS — ${passed}개 단언 전부 통과`);
    process.exit(0);
  } else {
    console.log(`FAIL — ${failures.length}개 실패:`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("E2E 예외:", e);
  process.exit(1);
});
