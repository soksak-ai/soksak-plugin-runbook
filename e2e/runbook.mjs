#!/usr/bin/env node
// soksak-plugin-runbook E2E — 멱등 시나리오 드라이버(clipboard.mjs idiom).
//
// 소켓(JSON-RPC)으로 실제 앱을 구동하고, runbook CRUD 커맨드로 단언한다(UI 없이 R7).
// 데이터는 합성 scope 로 격리한다(다른 프로젝트 런북과 분리) — clear 로 깨끗이 시작/정리.
//
// 전제: 코어 app(make dev)이 실행 중 + 이 플러그인 dev-load 가능(이 repo 경로). dev 소스=동의 면제.
// 사용: SOKSAK_SOCKET=~/.soksak/com.soksak.dev.sock node e2e/runbook.mjs   (이 repo 루트에서)
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
const SCOPE = `e2e-runbook-${RUN}`; // 합성 root(격리)

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
    }, 15000);
  });
}
// 등록 명령은 runbook.* 네임스페이스(예: runbook.command.add) — 호출 prefix 와 합쳐
// plugin.<id>.runbook.command.add 가 된다. m 은 그 runbook. 세그먼트를 채운다.
const m = (name, params, opts) => rpc(`plugin.${PLUGIN}.runbook.${name}`, params, opts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 소켓 준비 폴링 — state.context ok 일 때까지(dev 빌드 대기).
async function waitSocketReady(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await rpc("state.context", {});
      if (r.ok) return true;
    } catch {
      /* 아직 미준비 */
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

// 멱등 시작 보장 — scope 가 RUN 마다 새라 항상 비어 있지만, history 만 한 번 비워 둔다(방어).
async function wipe() {
  await m("history.clear", { scope: SCOPE }).catch(() => {});
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
  const ready = await waitSocketReady();
  if (!ready) {
    console.error("앱 미준비(state.context) — dev 빌드 대기 초과");
    process.exit(1);
  }
  console.log(`소켓: ${SOCKET}\n스코프(격리): ${SCOPE}`);

  // ── setup: 최신 main.js 재적재 + 활성(dev 소스=동의 면제) ──
  section("setup");
  await rpc("plugin.disable", { id: PLUGIN }).catch(() => {});
  const loaded = await rpc("plugin.dev.load", { path: PLUGIN_DIR });
  ok(loaded.ok, "plugin.dev.load(최신 main.js)");
  const enabled = await rpc("plugin.enable", { id: PLUGIN });
  ok(enabled.ok && enabled.status === "enabled", "plugin.enable(dev 동의 면제)");
  await wipe();

  const listLen = async (f = {}) => (await m("command.list", { scope: SCOPE, ...f })).commands.length;

  // ── R1: 빈 상태(격리 scope) ──
  section("R1 empty scope");
  ok((await listLen()) === 0, "비휴지통 명령 0(신 scope)");

  // ── R2: command.add(스크립트, Reference 토큰 포함) ──
  section("R2 command.add");
  const add = await m("command.add", {
    scope: SCOPE,
    label: "배포",
    command: "make deploy {env:dev|prod} `secret@token`",
    executionType: "script",
  });
  ok(add.ok && typeof add.commandId === "string", "add → commandId");
  ok(Array.isArray(add.refs) && add.refs.length === 2, "add 결과에 Reference 메타 2개(param·secret)");
  const CMD = add.commandId;
  ok((await listLen()) === 1, "list 1건");

  // ── R3: command.get — 필드·refs 확인 ──
  section("R3 command.get");
  const got = await m("command.get", { scope: SCOPE, commandId: CMD });
  ok(got.ok && got.command.label === "배포", "get label=배포");
  ok(got.command.executionType === "script", "executionType=script(영문키)");
  ok(got.command.deleted === false && got.command.favorite === false, "초기 deleted/favorite=false");
  ok(Array.isArray(got.command.refs) && got.command.refs.some((r) => r.provider === "secret"), "저장된 refs 에 secret provider");
  // refs 전용 커맨드도 같은 결과
  const refsOnly = await m("command.refs", { scope: SCOPE, commandId: CMD });
  ok(refsOnly.ok && refsOnly.refs.length === 2, "command.refs → 2건");

  // ── R4: update(label) — 전체교체 안전(executionType 보존) ──
  section("R4 command.update");
  const upd = await m("command.update", { scope: SCOPE, commandId: CMD, label: "프로덕션 배포" });
  ok(upd.ok, "update ok");
  const got2 = await m("command.get", { scope: SCOPE, commandId: CMD });
  ok(got2.command.label === "프로덕션 배포", "label 갱신됨");
  ok(got2.command.executionType === "script", "누락 필드(executionType) 보존(전체교체 안전)");

  // ── R5: favorite 토글 → 즐겨찾기 목록 1 ──
  section("R5 favorite");
  const fav = await m("command.favorite", { scope: SCOPE, commandId: CMD });
  ok(fav.ok && fav.favorite === true, "favorite 토글 → true");
  ok((await listLen({ favorite: true })) === 1, "즐겨찾기 목록 1건");

  // ── R6: group.add → set-group → 그룹별 목록 ──
  section("R6 group");
  const grpList0 = await m("group.list", { scope: SCOPE });
  ok(grpList0.ok && grpList0.groups.length >= 1, "group.list 기본 그룹 보장(≥1)");
  const ga = await m("group.add", { scope: SCOPE, name: "릴리스", color: "green" });
  ok(ga.ok && typeof ga.groupId === "string", "group.add → groupId");
  const GRP = ga.groupId;
  const sg = await m("command.set-group", { scope: SCOPE, commandId: CMD, groupId: GRP });
  ok(sg.ok && sg.groupId === GRP, "setGroup → 새 그룹");
  ok((await listLen({ groupId: GRP })) === 1, "그룹별 목록 1건");
  ok((await m("command.search", { scope: SCOPE, query: "프로덕션" })).commands.length === 1, "CJK 검색 '프로덕션' 적중");

  // ── R7: 소프트 삭제 → 비휴지통 0·휴지통 1 ──
  section("R7 soft delete");
  ok((await m("command.delete", { scope: SCOPE, commandId: CMD })).ok, "delete(소프트)");
  ok((await listLen()) === 0, "비휴지통 0");
  ok((await listLen({ trash: true })) === 1, "휴지통 1");

  // ── R8: restore → 복귀 ──
  section("R8 restore");
  ok((await m("command.restore", { scope: SCOPE, commandId: CMD })).ok, "restore");
  ok((await listLen()) === 1, "복귀 후 비휴지통 1");
  ok((await listLen({ trash: true })) === 0, "휴지통 0");

  // ── R9: duplicate → 2건 ──
  section("R9 duplicate");
  const dup = await m("command.duplicate", { scope: SCOPE, commandId: CMD });
  ok(dup.ok && dup.commandId !== CMD, "duplicate → 새 commandId");
  ok((await listLen()) === 2, "비휴지통 2건");
  const dupGot = await m("command.get", { scope: SCOPE, commandId: dup.commandId });
  ok(dupGot.command.label.includes("복사"), "복제본 label 에 (복사)");

  // ── R10: history.add → list ──
  section("R10 history");
  const h1 = await m("history.add", {
    scope: SCOPE,
    label: "프로덕션 배포",
    command: "make deploy prod",
    type: "script",
    output: "Deployed OK",
    statusCode: 0,
    commandId: CMD,
  });
  ok(h1.ok && typeof h1.historyId === "string", "history.add → historyId");
  ok((await m("history.list", { scope: SCOPE })).history.length === 1, "history.list 1건");
  ok((await m("history.search", { scope: SCOPE, query: "Deployed" })).history.length === 1, "history 검색 'Deployed' 적중");

  // ── R11: export/import 왕복 ──
  section("R11 export/import");
  const exp = await m("export", { scope: SCOPE });
  ok(exp.ok && exp.counts.commands === 2 && exp.counts.history === 1, "export counts(commands=2,history=1)");
  ok(exp.jsonl.includes("프로덕션 배포"), "export JSONL 에 명령 label");
  // import 멱등(id 보존 upsert) — 같은 jsonl 재적재 시 건수 불변
  const imp = await m("import", { scope: SCOPE, jsonl: exp.jsonl });
  ok(imp.ok && imp.imported >= 3, "import → 최소 3건(group+command×2+history)");
  ok((await listLen()) === 2, "import 후 명령 여전히 2건(멱등 upsert)");

  // ── R12: 잘못된 enum 거부 ──
  section("R12 enum gate");
  const bad = await m("command.add", { scope: SCOPE, label: "x", command: "y", executionType: "삭제됨" });
  ok(bad.ok === false && bad.code === "INVALID_PARAMS", "한국어/미지 executionType 거부");
  const bad2 = await m("command.get", { scope: SCOPE, commandId: "nope-" + RUN });
  ok(bad2.ok === false && bad2.code === "TARGET_NOT_FOUND", "없는 commandId → TARGET_NOT_FOUND");

  // ── teardown: 합성 scope 비우기(history clear + 명령 휴지통화로 흔적 최소화) ──
  section("teardown");
  const hc = await m("history.clear", { scope: SCOPE });
  ok(hc.ok, `history.clear → ${hc.deleted}건`);
  ok((await m("history.list", { scope: SCOPE })).history.length === 0, "history 비움 확인");
  // 명령은 휴지통으로(soft) — scope 가 RUN 마다 새라 잔존이 다른 런에 새지 않는다.
  const all = (await m("command.list", { scope: SCOPE })).commands;
  for (const c of all) await m("command.delete", { scope: SCOPE, commandId: c.id });
  ok((await listLen()) === 0, "명령 정리 확인");

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
