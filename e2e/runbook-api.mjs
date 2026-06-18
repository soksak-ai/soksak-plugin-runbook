#!/usr/bin/env node
// soksak-plugin-runbook api(HTTP) 실행타입 E2E — 로컬 HTTP 서버로 결정적(외부망 비의존 R10).
//
// 소켓(JSON-RPC)으로 실제 앱을 구동하고, 같은 머신에 띄운 로컬 HTTP 서버로 요청을 받아 단언한다:
//   (a) 기본 GET — url/method 해소 → 응답 status/body 캡처.
//   (b) 링킹 — 참조 script 명령 출력이 api url 에 되먹임(jsonPath).
//   (c) 시크릿 헤더 실주입(R2) — secret.set 한 값이 Rust 경계에서 헤더로 주입(서버가 실값 수신),
//       명령 레코드·히스토리엔 토큰만(평문 0). secret 미설정이면 SECRET_PENDING.
//   (d) 미입력 파라미터 → UNRESOLVED(전송 0).
//
// 전제: 코어 app(make dev) 실행 중 + dev-load 가능. 시크릿 단언(c)은 격리볼트 언락 필요 —
//   SOKSAK_VAULT_PATH=$(mktemp -d)/secrets.vault SOKSAK_VAULT_KEY=<pw> make dev (오픈 메커니즘).
// 사용: SOKSAK_SOCKET=~/.soksak/com.soksak.dev.sock node e2e/runbook-api.mjs   (repo 루트)
// 종료코드: 0 = 전부 PASS, 1 = FAIL.

import http from "node:http";
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
const SCOPE = `e2e-runbook-api-${RUN}`;

// ── 로컬 HTTP 서버 — 요청을 server-side 로 포착하고 고정 JSON 응답(요청 헤더를 응답에 반사하지 않음:
//    시크릿이 응답→히스토리로 새지 않게). received[] 를 테스트가 직접 단언한다. ──
function startServer() {
  return new Promise((resolve) => {
    const received = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.writeHead(200, { "content-type": "application/json" });
        // 응답엔 요청 헤더/바디를 반사하지 않는다 — value(링킹용)·path 만.
        res.end(JSON.stringify({ ok: true, value: "42", path: req.url }));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, received }));
  });
}

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

async function main() {
  const { server, port, received } = await startServer();
  const base = `http://127.0.0.1:${port}`;

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
  console.log(`소켓: ${SOCKET}\n로컬서버: ${base}\n스코프(격리): ${SCOPE}`);

  // ── setup ──
  section("setup");
  await rpc("plugin.disable", { id: PLUGIN }).catch(() => {});
  const loaded = await rpc("plugin.dev.load", { path: PLUGIN_DIR });
  ok(loaded.ok !== false, "plugin.dev.load(최신 main.js)");
  const enabled = await rpc("plugin.enable", { id: PLUGIN });
  ok(enabled.ok !== false, "plugin.enable(dev 동의 면제)");

  try {
    // ── (a) 기본 GET ──
    section("a) 기본 GET — url/method 해소 + 응답 캡처");
    const addG = await m("command.add", {
      scope: SCOPE,
      label: "G",
      executionType: "api",
      httpMethod: "GET",
      url: `${base}/ping`,
    });
    ok(typeof addG.commandId === "string", "api command.add → commandId");
    const runG = await m("command.run", { scope: SCOPE, commandId: addG.commandId });
    ok(runG.ok === true, "api run ok");
    ok(runG.statusCode === 200, `응답 status=200(got ${runG.statusCode})`);
    ok(String(runG.output).includes('"value":"42"'), "응답 바디 캡처(value=42)");
    const gReq = received.find((r) => r.url === "/ping");
    ok(gReq?.method === "GET", "서버가 GET /ping 수신");

    // ── (b) 링킹 — script 출력이 api url 에 되먹임 ──
    section("b) 링킹(command 출력 → api url)");
    const addA = await m("command.add", {
      scope: SCOPE,
      label: "A-id",
      command: "echo '{\"id\":\"7\"}'",
      executionType: "script",
    });
    const addB = await m("command.add", {
      scope: SCOPE,
      label: "B-api",
      executionType: "api",
      httpMethod: "GET",
      url: `${base}/users/\`command@${addA.commandId}|id\``,
    });
    const runB = await m("command.run", { scope: SCOPE, commandId: addB.commandId });
    ok(runB.ok === true, "링킹 api run ok(A 먼저 실행)");
    const bReq = received.find((r) => r.url === "/users/7");
    ok(!!bReq, "서버가 /users/7 수신(A 출력 id=7 되먹임)");

    // ── (c) 시크릿 헤더 실주입(R2) ──
    section("c) 시크릿 헤더 실주입(R2)");
    const backend = await rpc("secret.backend", {});
    ok(backend.unlocked === true, "볼트 언락(미언락이면 SOKSAK_VAULT_PATH+KEY 로 dev 재기동)");
    const KEY = `e2eHttpKey${RUN}`;
    const VALUE = "sk-inject-7f3a";
    const setR = await rpc("secret.set", { ns: PLUGIN, key: KEY, value: VALUE });
    ok(setR.ok === true, "secret.set(격리볼트)");
    const addS = await m("command.add", {
      scope: SCOPE,
      label: "S-api",
      executionType: "api",
      httpMethod: "GET",
      url: `${base}/secure`,
      headers: { authorization: "Bearer `secret@" + KEY + "`" },
    });
    const runS = await m("command.run", { scope: SCOPE, commandId: addS.commandId });
    ok(runS.ok === true, "시크릿 api run ok");
    const sReq = received.find((r) => r.url === "/secure");
    ok(sReq?.headers?.authorization === `Bearer ${VALUE}`, "서버가 실 시크릿값 헤더 수신(Rust 경계 주입)");
    // R2 — 명령 레코드엔 토큰만(평문 0), 히스토리(응답)엔 평문 0.
    const recS = await m("command.get", { scope: SCOPE, commandId: addS.commandId });
    ok(!JSON.stringify(recS).includes(VALUE), "명령 레코드에 평문 시크릿 0(토큰만)");
    const histS = await m("history.list", { scope: SCOPE });
    ok(!JSON.stringify(histS).includes(VALUE), "히스토리에 평문 시크릿 0(R2)");

    // 시크릿 미설정 헤더 → SECRET_PENDING.
    const addP = await m("command.add", {
      scope: SCOPE,
      label: "P-api",
      executionType: "api",
      httpMethod: "GET",
      url: `${base}/p`,
      headers: { authorization: "Bearer `secret@neverSet" + RUN + "`" },
    });
    const runP = await m("command.run", { scope: SCOPE, commandId: addP.commandId });
    ok(runP.ok === false && runP.code === "SECRET_PENDING", "미설정 secret 헤더 → SECRET_PENDING");

    await rpc("secret.delete", { ns: PLUGIN, key: KEY }).catch(() => {});

    // ── (d) 미입력 파라미터 → UNRESOLVED ──
    section("d) 미입력 파라미터(url) → UNRESOLVED");
    const before = received.length;
    const addU = await m("command.add", {
      scope: SCOPE,
      label: "U-api",
      executionType: "api",
      httpMethod: "GET",
      url: `${base}/{missing}`,
    });
    const runU = await m("command.run", { scope: SCOPE, commandId: addU.commandId });
    ok(runU.ok === false && runU.code === "UNRESOLVED", "미입력 파라미터 → UNRESOLVED");
    ok(received.length === before, "전송되지 않음(미치환 토큰 누출 0)");

    // ── teardown ──
    section("teardown");
    const hc = await m("history.clear", { scope: SCOPE });
    ok(hc.ok, `history.clear → ${hc.deleted}건`);
    const all = (await m("command.list", { scope: SCOPE })).commands;
    for (const c of all) await m("command.delete", { scope: SCOPE, commandId: c.id });
    ok((await m("command.list", { scope: SCOPE })).commands.length === 0, "명령 정리 확인");
  } finally {
    server.close();
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
