// 실행 엔진의 secret 가용성 게이트 — script/background 가 셸 spawn 하기 전에, 참조된 secret 이 볼트에
// 실제로 있고 언락됐는지(app.secrets.has) 검사한다. 미가용이면 SECRET_PENDING(명시 거부) — Rust 경계의
// 미가용 실패를 generic EXEC_ERROR 로 뭉뚱그리지 않는다. 가용이면 통과해 $SOKSAK_SECRET_N 플레이스홀더로
// 실행(평문 0, R2). terminal+secret 은 가용성과 무관히 항상 SECRET_PENDING(ps 노출 위험).
import { describe, expect, it } from "vitest";
import { runCommand, type RunDeps } from "./index";
import { type CommandRecord } from "../data/model";

// ── fake DataApi — 단일 command 레코드(맵). put 은 id 반환(history/갱신 무해). ──
function fakeData(
  rec: Partial<CommandRecord> & { command: string; executionType: CommandRecord["executionType"] },
): RunDeps["data"] {
  const id = rec.id ?? "root";
  const full: Record<string, unknown> = { id, label: "T", groupId: "g", order: 0, refs: [], ...rec };
  return {
    define: async () => {},
    put: async (_c, _d, o) => o?.id ?? "h1",
    get: async (_c, gid) => (gid === id ? full : null),
    query: async () => [],
    search: async () => [],
    count: async () => 0,
    delete: async () => true,
    watch: () => ({ dispose: () => {} }),
  };
}

// ── fake ProcessApi — spawn 한 셸 명령 + secretEnv 를 포착. onExit 는 마이크로태스크로 발화(등록 후). ──
function fakeProcess(stdout: string, exitCode: number, capture: { cmd?: string; secretEnv?: Record<string, string> }): RunDeps["process"] {
  return {
    spawn: async (_cmd, args, opts) => {
      capture.cmd = args[1];
      capture.secretEnv = opts?.secretEnv;
      return 1;
    },
    onData: (_h, cb) => {
      cb(new TextEncoder().encode(stdout));
      return { dispose: () => {} };
    },
    onStderr: () => ({ dispose: () => {} }),
    onExit: (_h, cb) => {
      queueMicrotask(() => cb(exitCode));
      return { dispose: () => {} };
    },
    kill: async () => {},
  };
}

// spawn 되면 즉시 실패 — 게이트가 단락(spawn 미도달)함을 증명한다.
const explodingProcess: RunDeps["process"] = {
  spawn: async () => {
    throw new Error("게이트를 통과하면 안 됨 — spawn 호출됨");
  },
  onData: () => ({ dispose: () => {} }),
  onStderr: () => ({ dispose: () => {} }),
  onExit: () => ({ dispose: () => {} }),
  kill: async () => {},
};

describe("runCommand — secret 가용성 게이트(SECRET_PENDING)", () => {
  it("script+secret, 프로브가 미가용(has=false) → SECRET_PENDING(spawn 미도달)", async () => {
    const data = fakeData({ command: "echo `secret@apiKey`", executionType: "script" });
    const r = await runCommand(
      { data, process: explodingProcess, secrets: { has: async () => false } },
      { commandId: "root", secretNs: "test-ns" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SECRET_PENDING");
  });

  it("script+secret, 프로브 throw(볼트 잠김) → SECRET_PENDING", async () => {
    const data = fakeData({ command: "echo `secret@apiKey`", executionType: "script" });
    const r = await runCommand(
      {
        data,
        process: explodingProcess,
        secrets: {
          has: async () => {
            throw new Error("vault locked");
          },
        },
      },
      { commandId: "root", secretNs: "test-ns" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SECRET_PENDING");
  });

  it("script+secret, secrets 표면 없음(권한 미선언) → SECRET_PENDING", async () => {
    const data = fakeData({ command: "echo `secret@apiKey`", executionType: "script" });
    const r = await runCommand(
      { data, process: explodingProcess },
      { commandId: "root", secretNs: "test-ns" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SECRET_PENDING");
  });

  it("script+secret, 프로브 가용(has=true) → 통과: $SOKSAK_SECRET_0 플레이스홀더 + secretEnv(평문 0)", async () => {
    const data = fakeData({ command: "echo `secret@apiKey`", executionType: "script" });
    const cap: { cmd?: string; secretEnv?: Record<string, string> } = {};
    const probed: string[] = [];
    const r = await runCommand(
      {
        data,
        process: fakeProcess("done", 0, cap),
        secrets: {
          has: async (k) => {
            probed.push(k);
            return true;
          },
        },
      },
      { commandId: "root", secretNs: "test-ns" },
    );
    expect(r.ok).toBe(true);
    expect(probed).toContain("apiKey"); // 게이트가 실제로 프로브했다.
    // 셸로 간 명령엔 평문 시크릿이 아니라 env 플레이스홀더만(R2).
    expect(cap.cmd).toContain("$SOKSAK_SECRET_0");
    expect(cap.cmd).not.toContain("apiKey"); // key 이름조차 명령 텍스트엔 없다.
    expect(cap.secretEnv).toEqual({ SOKSAK_SECRET_0: "apiKey" });
  });

  it("terminal+secret 은 가용성과 무관히 SECRET_PENDING(ps 노출 위험)", async () => {
    const data = fakeData({ command: "deploy `secret@apiKey`", executionType: "terminal" });
    const r = await runCommand(
      { data, secrets: { has: async () => true }, commands: { execute: async () => ({ ok: true }) } },
      { commandId: "root", secretNs: "test-ns" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SECRET_PENDING");
  });

  it("script+secret 없음 → 게이트 무관, 정상 실행(프로브 미호출)", async () => {
    const data = fakeData({ command: "echo hi", executionType: "script" });
    const cap: { cmd?: string; secretEnv?: Record<string, string> } = {};
    let probeCalls = 0;
    const r = await runCommand(
      {
        data,
        process: fakeProcess("hi", 0, cap),
        secrets: {
          has: async () => {
            probeCalls += 1;
            return true;
          },
        },
      },
      { commandId: "root", secretNs: "test-ns" },
    );
    expect(r.ok).toBe(true);
    expect(probeCalls).toBe(0); // secret 참조 없음 → 프로브 안 함.
    expect(cap.secretEnv).toEqual({}); // secretEnv 비어 있음.
  });
});
