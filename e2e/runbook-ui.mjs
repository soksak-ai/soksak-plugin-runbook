#!/usr/bin/env node
// soksak-plugin-runbook UI E2E — 인라인 배지 입력 에디터 + 명령 목록 뷰 멱등 시나리오.
//
// 소켓(JSON-RPC)으로 실제 앱을 구동한다. 두 축으로 단언한다:
//   (A) 헤드리스 순수 토큰 처리(runbook.editor.tokens/serialize) — 에디터 mount 무관. 토큰↔배지
//       왕복 + 시크릿 토큰이 배지로 직렬화돼도 평문 0·key 만(R2).
//   (B) 뷰 개방 → ui.tree 로 노드 노출 확인 → 편집 폼 열어 배지 렌더 → ui.measure 로 배지 rect.
//
// 데이터는 합성 scope 로 격리(다른 런북과 분리). 뷰는 활성 프로젝트(전역 scope)에 그려지므로 뷰
// 단언용 명령은 scope 없이 추가하고 teardown 에서 정리한다(흔적 최소화).
//
// 전제: 코어 app(make dev) 실행 중 + 이 플러그인 dev-load 가능(이 repo 경로). dev 소스=동의 면제.
// 사용: SOKSAK_SOCKET=~/.soksak/com.soksak.dev.sock node e2e/runbook-ui.mjs   (이 repo 루트에서)
// 종료코드: 0 = 전부 PASS, 1 = FAIL.

import { execFileSync } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SOCKET =
  process.env.SOKSAK_SOCKET || path.join(os.homedir(), ".soksak", "com.soksak.dev.sock");
const PLUGIN = "soksak-plugin-runbook";
const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIEW = `${PLUGIN}.runbook`;
const RUN = Date.now().toString(36);
const SCOPE = `e2e-runbook-ui-${RUN}`;

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
const m = (name, params, opts) => rpc(`plugin.${PLUGIN}.runbook.${name}`, params, opts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ui.tree 에서 nodePath suffix 로 노드 1개 주소를 찾는다(동적 키는 prefix 매칭).
async function findNode(suffix) {
  const tree = await rpc("ui.tree", {});
  if (!tree || !Array.isArray(tree.nodes)) return null;
  // 정확 일치 우선, 없으면 "<suffix>/" prefix(동적 <id>/<key>).
  const exact = tree.nodes.find((n) => n.nodePath === suffix);
  if (exact) return exact.address;
  const pref = tree.nodes.find((n) => n.nodePath.startsWith(suffix + "/"));
  return pref ? pref.address : null;
}

async function main() {
  // ── 최신 main.js 재번들(import 0 보장) ──
  section("rebuild");
  try {
    execFileSync("npm", ["run", "build"], { cwd: PLUGIN_DIR, stdio: "pipe" });
    ok(true, "npm run build(최신 main.js 재번들)");
  } catch (e) {
    ok(false, "npm run build 실패: " + (e.message || e));
  }

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

  // ── setup: 재적재 + 활성 ──
  section("setup");
  await rpc("plugin.disable", { id: PLUGIN }).catch(() => {});
  const loaded = await rpc("plugin.dev.load", { path: PLUGIN_DIR });
  ok(loaded.ok, "plugin.dev.load(최신 main.js)");
  const enabled = await rpc("plugin.enable", { id: PLUGIN });
  ok(enabled.ok && enabled.status === "enabled", "plugin.enable(dev 동의 면제)");

  // ── A: 헤드리스 토큰 처리(에디터 mount 무관 — 순수 커맨드) ──
  section("A 헤드리스 토큰 왕복(순수)");
  const TEMPLATE = "make deploy {env:dev|prod} `secret@token` to {{API_BASE}}";
  const tk = await m("editor.tokens", { text: TEMPLATE });
  ok(tk.ok && Array.isArray(tk.tokens), "editor.tokens → 토큰 배열");
  ok(tk.tokens.length === 3, "토큰 3개(param·secret·env)");
  const providers = tk.tokens.map((t) => t.provider);
  ok(
    providers.includes("param") && providers.includes("secret") && providers.includes("env"),
    "provider 종류 param·secret·env",
  );
  const sec = tk.tokens.find((t) => t.provider === "secret");
  ok(sec && sec.key === "token", "시크릿 토큰 key=token");
  // R2: 시크릿 토큰은 평문 미보유 — provider·key·raw 외 필드 없음.
  ok(
    sec && Object.keys(sec).sort().join(",") === "key,provider,raw",
    "시크릿 토큰은 평문 0 — provider/key/raw 만(R2)",
  );
  ok(sec && !/value|plain|secret-value/.test(JSON.stringify(sec)), "시크릿 직렬화에 평문 흔적 0");
  const ser = await m("editor.serialize", { text: TEMPLATE });
  ok(ser.ok && ser.serialized === TEMPLATE, "editor.serialize 왕복 항등(저장형 보존)");
  // 세그먼트 직접 직렬화(raw 없는 토큰 합성).
  const ser2 = await m("editor.serialize", {
    segments: [
      { kind: "text", value: "x " },
      { kind: "badge", token: { provider: "secret", key: "apiKey", raw: "" } },
    ],
  });
  ok(ser2.ok && ser2.serialized === "x `secret@apiKey`", "세그먼트 직렬화(raw 합성 → 저장형)");

  // ── B: 뷰 개방 → 노드 노출 → 편집 폼 배지 렌더 → 배지 rect ──
  section("B 뷰 개방·노드 노출");
  // 뷰 단언용 명령은 전역 scope(뷰가 그리는 활성 프로젝트). 시크릿 토큰 포함 → 편집 폼에서 배지로.
  const add = await m("command.add", {
    label: `UI배지테스트-${RUN}`,
    command: "deploy `secret@token` {env:dev|prod}",
    executionType: "script",
  });
  ok(add.ok && typeof add.commandId === "string", "뷰용 명령 추가(시크릿 토큰 포함)");
  const CMD = add.commandId;

  const opened = await rpc("plugin.view.open", { view: VIEW, placement: "sidebar-right" });
  ok(opened.ok !== false && opened.view === VIEW, "plugin.view.open(우측 사이드바)");
  await sleep(400); // mount + 첫 refresh 대기

  const inputAddr = await findNode("command-input");
  ok(inputAddr === null, "최초엔 에디터 미마운트(폼 미개방) — command-input 없음");
  const searchAddr = await findNode("search-input");
  ok(!!searchAddr, "ui.tree 에 search-input 노출(뷰 마운트 확인)");
  const addAddr = await findNode("command-add");
  ok(!!addAddr, "ui.tree 에 command-add 노출");

  // 추가 폼을 열어 에디터 마운트(빈 템플릿) — command-input 노출 확인.
  section("B2 폼 개방 → 인라인 에디터 노출");
  if (addAddr) {
    await rpc("ui.input.click", { address: addAddr });
    await sleep(250);
  }
  const inputAddr2 = await findNode("command-input");
  ok(!!inputAddr2, "폼 개방 후 ui.tree 에 command-input(contenteditable) 노출");
  // 폼 닫기.
  const cancelAddr = await findNode("form-cancel");
  if (cancelAddr) await rpc("ui.input.click", { address: cancelAddr });
  await sleep(150);

  // 편집 폼(기존 명령) 열기 → 시크릿 배지 렌더 → 배지 rect 측정.
  section("B3 편집 폼 → 배지 렌더 → rect");
  // command-edit 행 버튼(동적 키) 주소 — 행이 그려졌는지 확인 후 클릭.
  const rowAddr = await findNode("command-row");
  ok(!!rowAddr, "ui.tree 에 command-row 노출(목록 행)");
  const editAddr = await findNode("command-edit");
  ok(!!editAddr, "ui.tree 에 command-edit(편집 버튼) 노출");
  if (editAddr) {
    await rpc("ui.input.click", { address: editAddr });
    await sleep(300);
  }
  const editorAddr = await findNode("command-input");
  ok(!!editorAddr, "편집 폼 에디터 마운트(command-input)");
  const badgeAddr = await findNode("badge");
  ok(!!badgeAddr, "ui.tree 에 badge 노드 노출(시크릿 토큰이 배지 span 으로 렌더)");
  if (badgeAddr) {
    const measured = await rpc("ui.measure", { address: badgeAddr });
    ok(
      measured && measured.rect && measured.rect.w > 0 && measured.rect.h > 0,
      `ui.measure 배지 rect(w=${measured?.rect?.w}, h=${measured?.rect?.h})`,
    );
  }
  // 편집 폼 닫기.
  const cancel2 = await findNode("form-cancel");
  if (cancel2) await rpc("ui.input.click", { address: cancel2 });
  await sleep(150);

  // ── teardown ──
  section("teardown");
  await rpc("plugin.view.close", { view: VIEW }).catch(() => {});
  const del = await m("command.delete", { commandId: CMD });
  ok(del.ok, "뷰용 명령 정리(소프트 삭제)");

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
