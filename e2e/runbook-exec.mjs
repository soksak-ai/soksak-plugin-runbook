#!/usr/bin/env node
// soksak-plugin-runbook 실행 엔진 E2E — 멱등 hard 시나리오(링킹·셸·순환·미해소·secret).
//
// 소켓(JSON-RPC)으로 실제 앱을 구동하고 runbook.command.run 으로 실행을 단언한다(UI 없이 R7).
// 합성 scope 로 격리(RUN 마다 새 root) — clear/소프트삭제로 흔적 최소화. RED→GREEN 적대적 검증.
//
// 전제: 코어 app(make dev) 실행 중 + 이 플러그인 dev-load 가능. dev 소스 = 동의 면제.
// secret 실주입 단언(e3)은 볼트 언락이 필요하다 — 사용자 실볼트 비오염을 위해 격리 볼트로 dev 를 기동한다:
//   SOKSAK_VAULT_PATH=$(mktemp -d)/secrets.vault SOKSAK_VAULT_KEY=<pw> make dev   (오픈 메커니즘, lock-in 0)
// 사용: SOKSAK_SOCKET=~/.soksak/com.soksak.dev.sock node e2e/runbook-exec.mjs   (repo 루트)
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
const SCOPE = `e2e-runbook-exec-${RUN}`;

// ── 소켓 RPC ──
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
// plugin.<id>.runbook.<seg>.
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

// ── 단언 ──
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

  // ── setup: 최신 main.js 재적재 + 활성(dev 소스 = 동의 면제) ──
  section("setup");
  await rpc("plugin.disable", { id: PLUGIN }).catch(() => {});
  const loaded = await rpc("plugin.dev.load", { path: PLUGIN_DIR });
  ok(loaded.ok, "plugin.dev.load(최신 main.js)");
  const enabled = await rpc("plugin.enable", { id: PLUGIN });
  ok(enabled.ok && enabled.status === "enabled", "plugin.enable(dev 동의 면제)");
  await m("history.clear", { scope: SCOPE }).catch(() => {});

  // ── (a) 단순 셸 실행 — echo 명령 run → output 일치·exitCode 0·history 1건·lastExecutedAt 갱신 ──
  section("a) 셸 실행(script echo)");
  const addEcho = await m("command.add", {
    scope: SCOPE,
    label: "에코",
    command: "echo soksak-exec-ok",
    executionType: "script",
  });
  ok(addEcho.ok && typeof addEcho.commandId === "string", "command.add(echo) → commandId");
  const ECHO = addEcho.commandId;
  const runEcho = await m("command.run", { scope: SCOPE, commandId: ECHO });
  ok(runEcho.ok === true, "run ok");
  ok(typeof runEcho.output === "string" && runEcho.output.includes("soksak-exec-ok"), "output 에 echo 결과");
  ok(runEcho.exitCode === 0, "exitCode 0");
  const histAfter = await m("history.list", { scope: SCOPE });
  ok(histAfter.ok && histAfter.history.length === 1, "히스토리 1건 자동 기록");
  ok(histAfter.history[0].output && histAfter.history[0].output.includes("soksak-exec-ok"), "히스토리 output 일치");
  const gotEcho = await m("command.get", { scope: SCOPE, commandId: ECHO });
  ok(typeof gotEcho.command.lastExecutedAt === "number" && gotEcho.command.lastExecutedAt > 0, "lastExecutedAt 갱신");
  ok(gotEcho.command.lastStatusCode === 0, "lastStatusCode 0 기록");
  ok(typeof gotEcho.command.lastOutput === "string" && gotEcho.command.lastOutput.includes("soksak-exec-ok"), "lastOutput 갱신");

  // ── (b) 링킹 — A(echo JSON {"v":"42"}) + B(템플릿에 command@A|v) → B run → A 먼저 실행→v=42 치환 ──
  section("b) 링킹(command 참조 되먹임)");
  const addA = await m("command.add", {
    scope: SCOPE,
    // 셸 단어분할/중괄호 처리가 따옴표를 떼지 않도록 작은따옴표로 감싼다 → 유효 JSON stdout.
    command: `echo '{"v":"42"}'`,
    label: "A-json",
    executionType: "script",
  });
  ok(addA.ok, "A.add(echo JSON)");
  const A = addA.commandId;
  // B 는 A 의 출력 v 를 echo 로 되울린다 — 치환 성공 시 stdout 에 42 가 찍힌다.
  const addB = await m("command.add", {
    scope: SCOPE,
    label: "B-link",
    command: "echo linked=`command@" + A + "|v`",
    executionType: "script",
  });
  ok(addB.ok, "B.add(command@A|v 참조)");
  const B = addB.commandId;
  const runB = await m("command.run", { scope: SCOPE, commandId: B });
  ok(runB.ok === true, "B run ok(A 먼저 실행됨)");
  ok(typeof runB.output === "string" && runB.output.includes("linked=42"), "A 출력 v=42 가 B 에 치환됨(되먹임)");
  // 히스토리는 루트(top-level run)만 남긴다 — 링킹 중 참조 실행(A)은 내부 단계라 흔적 없음.
  // 그래서 누계 = echo(섹션 a) + B(섹션 b) = 2건. A 의 출력은 B 의 lastOutput·되먹임으로만 흐른다.
  const histLink = await m("history.list", { scope: SCOPE });
  ok(histLink.history.length === 2, "히스토리 누계 2건(echo + 루트 B만 — 링킹 참조 A 는 내부 단계)");
  // 되먹임 확인 보강 — B 의 lastOutput 에 치환 결과가 남았는가.
  const gotB = await m("command.get", { scope: SCOPE, commandId: B });
  ok(typeof gotB.command.lastOutput === "string" && gotB.command.lastOutput.includes("linked=42"), "B.lastOutput 에 되먹임 결과");

  // ── (c) 순환 — A→B, B→A → run → code CYCLE 거부(무한재귀 아님) ──
  section("c) 순환 거부(CYCLE)");
  const cyA = await m("command.add", { scope: SCOPE, label: "cyA", command: "echo a", executionType: "script" });
  const cyB = await m("command.add", { scope: SCOPE, label: "cyB", command: "echo b", executionType: "script" });
  const CA = cyA.commandId;
  const CB = cyB.commandId;
  // 서로 참조하도록 update — A→B, B→A.
  await m("command.update", { scope: SCOPE, commandId: CA, command: "echo a `command@" + CB + "`" });
  await m("command.update", { scope: SCOPE, commandId: CB, command: "echo b `command@" + CA + "`" });
  const runCycle = await m("command.run", { scope: SCOPE, commandId: CB });
  ok(runCycle.ok === false && runCycle.code === "CYCLE", "순환 → code CYCLE(즉시 거부, 무한재귀 아님)");
  ok(Array.isArray(runCycle.cycle) && runCycle.cycle.length > 0, "cycle 경로 명시");

  // ── (d) 미해소 참조 — 정의 없는 command 참조 → UNRESOLVED ──
  section("d) 미해소 참조(UNRESOLVED)");
  const addU = await m("command.add", {
    scope: SCOPE,
    label: "U-unresolved",
    command: "echo `command@ghost-" + RUN + "`",
    executionType: "script",
  });
  const U = addU.commandId;
  const runU = await m("command.run", { scope: SCOPE, commandId: U });
  ok(runU.ok === false && runU.code === "UNRESOLVED", "정의 없는 참조 → UNRESOLVED");
  ok(Array.isArray(runU.unresolved) && runU.unresolved.length === 1, "unresolved 토큰 보고(미치환 토큰 셸 누출 0)");

  // ── (e) secret 게이트 + 실주입(R2 평문 0) — 코어 secret.*(오픈 표면) 로 격리볼트에 set ──
  section("e) secret 게이트·실주입");
  const NS = PLUGIN; // secretNs = app.pluginId = 이 플러그인 id.

  // 전제: 볼트 언락(dev = SOKSAK_VAULT_KEY). 미언락이면 e3 가 무의미 — 명시 실패로 재기동을 알린다(스킵 아님).
  const backend = await rpc("secret.backend", {});
  ok(
    backend.unlocked === true,
    "볼트 언락(미언락이면 SOKSAK_VAULT_PATH+SOKSAK_VAULT_KEY 로 dev 재기동)",
  );

  // (e1) terminal+secret → SECRET_PENDING — 가용성과 무관히 ps 노출 위험으로 거부.
  const addT = await m("command.add", {
    scope: SCOPE,
    label: "T-secret",
    command: "deploy `secret@apiKey`",
    executionType: "terminal",
  });
  const runT = await m("command.run", { scope: SCOPE, commandId: addT.commandId });
  ok(runT.ok === false && runT.code === "SECRET_PENDING", "terminal+secret → SECRET_PENDING(ps 위험)");

  // (e2) script+secret, 미설정 → SECRET_PENDING — 가용성 게이트(set/unlock 먼저).
  const MISS = `neverSet${RUN}`;
  const addMiss = await m("command.add", {
    scope: SCOPE,
    label: "S-miss",
    command: "echo `secret@" + MISS + "`",
    executionType: "script",
  });
  const runMiss = await m("command.run", { scope: SCOPE, commandId: addMiss.commandId });
  ok(
    runMiss.ok === false && runMiss.code === "SECRET_PENDING",
    "script+미설정 secret → SECRET_PENDING(가용성 게이트)",
  );

  // (e3) script+secret, 설정됨 → 실제 자식 env 주입 + 평문 0(R2). 길이로 실주입을 증명(값 미노출).
  const KEY = `e2eApiKey${RUN}`;
  const VALUE = "abcdef0123456789"; // 16바이트 — 주입 증명을 길이로(평문 미출력).
  const setR = await rpc("secret.set", { ns: NS, key: KEY, value: VALUE });
  ok(setR.ok === true, "secret.set(격리볼트) ok");
  const hasR = await rpc("secret.has", { ns: NS, key: KEY });
  ok(hasR.has === true, "secret.has → true(설정 확인)");

  // printf '%s' "<secret>" | wc -c → 값의 바이트 수만 출력(평문 미노출). 자식 env 주입을 길이로 증명.
  const addI = await m("command.add", {
    scope: SCOPE,
    label: "S-inject",
    command: "printf '%s' \"`secret@" + KEY + "`\" | wc -c | tr -d ' '",
    executionType: "script",
  });
  const runI = await m("command.run", { scope: SCOPE, commandId: addI.commandId });
  ok(runI.ok === true, "script+설정 secret → 실행 ok(가용성 게이트 통과·주입)");
  ok(
    String(runI.output).trim() === String(VALUE.length),
    `주입된 값 길이=${VALUE.length}(자식 env 로 실평문 주입 증명)`,
  );
  ok(!String(runI.output).includes(VALUE), "출력에 평문 시크릿 0(R2)");

  // 히스토리·명령 레코드도 평문 0 — 출력엔 길이만, 템플릿엔 토큰만.
  const histI = await m("history.list", { scope: SCOPE });
  ok(!JSON.stringify(histI).includes(VALUE), "히스토리에 평문 시크릿 0(R2)");
  const recI = await m("command.get", { scope: SCOPE, commandId: addI.commandId });
  ok(!JSON.stringify(recI).includes(VALUE), "명령 레코드에 평문 시크릿 0(토큰만)");

  // 테스트 시크릿 정리(격리볼트라도 흔적 0).
  const delR = await rpc("secret.delete", { ns: NS, key: KEY });
  ok(delR.removed === true, "secret.delete(테스트 시크릿 정리)");

  // ── (f) 없는 commandId → TARGET_NOT_FOUND ──
  section("f) 없는 명령");
  const runNope = await m("command.run", { scope: SCOPE, commandId: "nope-" + RUN });
  ok(runNope.ok === false && runNope.code === "TARGET_NOT_FOUND", "없는 commandId → TARGET_NOT_FOUND");

  // ── teardown: 합성 scope 비우기 ──
  section("teardown");
  const hc = await m("history.clear", { scope: SCOPE });
  ok(hc.ok, `history.clear → ${hc.deleted}건`);
  const all = (await m("command.list", { scope: SCOPE })).commands;
  for (const c of all) await m("command.delete", { scope: SCOPE, commandId: c.id });
  ok((await m("command.list", { scope: SCOPE })).commands.length === 0, "명령 정리 확인");

  // ── 결과 ──
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
  console.error("E2E 오류:", e);
  process.exit(1);
});
