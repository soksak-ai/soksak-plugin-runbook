// 실행 엔진 api(HTTP) 경로 — executeNode 가 url/headers/query/body 를 단일 Reference 엔진으로 해소해
// app.network.http 로 보낸다. 시크릿은 secretSubst(marker→key)로만 넘기고 평문은 Rust 경계에서 치환(R2).
// 응답(status/body)을 캡처해 링킹 되먹임. fake network/process 로 격리(외부망·셸 없이 순수 계약 검증).
import { describe, expect, it } from "vitest";
import { runCommand, type RunDeps } from "./index";
import { type CommandRecord } from "../data/model";

// resolve 의 secret 마커 래퍼 — NUL 문자(평문 아님). 소스에 리터럴 NUL 을 넣지 않으려 코드로 구성.
const NUL = String.fromCharCode(0);
const mark = (key: string) => `${NUL}secret:${key}${NUL}`;

function fakeData(recs: CommandRecord[]): RunDeps["data"] {
  const byId = new Map(recs.map((r) => [r.id as string, r]));
  return {
    define: async () => {},
    put: async (_c, d, o) => o?.id ?? (d.id as string) ?? "h1",
    get: async (_c, id) => byId.get(id) ?? null,
    query: async () => [],
    search: async () => [],
    count: async () => 0,
    delete: async () => true,
    watch: () => ({ dispose: () => {} }),
  };
}

type ReqCap = {
  req?: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    body?: string;
    contentType?: string;
    secretSubst?: Record<string, string>;
  };
};

function fakeNetwork(
  resp: { status: number; headers?: Record<string, string>; body: string },
  cap: ReqCap,
): RunDeps["network"] {
  return {
    http: async (req) => {
      cap.req = req;
      return { status: resp.status, headers: resp.headers ?? {}, body: resp.body };
    },
  };
}

// 셸 노드용 fake process — 고정 stdout/exit. onExit 는 마이크로태스크로(등록 후 발화).
function fakeProcess(stdout: string): RunDeps["process"] {
  return {
    spawn: async () => 1,
    onData: (_h, cb) => {
      cb(new TextEncoder().encode(stdout));
      return { dispose: () => {} };
    },
    onStderr: () => ({ dispose: () => {} }),
    onExit: (_h, cb) => {
      queueMicrotask(() => cb(0));
      return { dispose: () => {} };
    },
    kill: async () => {},
  };
}

function apiRec(over: Partial<CommandRecord>): CommandRecord {
  return {
    id: "root",
    label: "T",
    groupId: "g",
    order: 0,
    command: "",
    executionType: "api",
    deleted: false,
    favorite: false,
    ...over,
  };
}

describe("runCommand — api(HTTP) 실행", () => {
  it("url/method/headers/body 를 Reference 해소해 전송 + 응답 캡처", async () => {
    const data = fakeData([
      apiRec({
        url: "https://x/{path}",
        httpMethod: "POST",
        headers: { "x-a": "1" },
        bodyData: '{"k":"v"}',
        bodyType: "json",
      }),
    ]);
    const cap: ReqCap = {};
    const r = await runCommand(
      { data, network: fakeNetwork({ status: 200, body: '{"id":42}' }, cap) },
      { commandId: "root", inputs: { path: "users" } },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.statusCode).toBe(200);
      expect(r.output).toContain("[200]");
      expect(r.output).toContain('{"id":42}');
    }
    expect(cap.req?.method).toBe("POST");
    expect(cap.req?.url).toBe("https://x/users"); // {path} 치환
    expect(cap.req?.headers?.["x-a"]).toBe("1");
    expect(cap.req?.body).toBe('{"k":"v"}');
    expect(cap.req?.contentType).toBe("application/json"); // bodyType=json
  });

  it("secret 헤더는 marker+secretSubst 로만 — 평문 미주입(R2)", async () => {
    const data = fakeData([
      apiRec({
        url: "https://x",
        headers: { authorization: "Bearer `secret@apiKey`" },
      }),
    ]);
    const cap: ReqCap = {};
    const r = await runCommand(
      {
        data,
        network: fakeNetwork({ status: 200, body: "ok" }, cap),
        secrets: { has: async () => true },
      },
      { commandId: "root", secretNs: "ns" },
    );
    expect(r.ok).toBe(true);
    // 헤더엔 NUL 마커만(평문 아님), secretSubst 가 marker→key 를 따로 넘긴다.
    expect(cap.req?.headers?.authorization).toBe(`Bearer ${mark("apiKey")}`);
    expect(cap.req?.secretSubst).toEqual({ [mark("apiKey")]: "apiKey" });
  });

  it("링킹 — 참조 명령 출력이 url 에 되먹임(jsonPath)", async () => {
    const data = fakeData([
      apiRec({ id: "root", url: "https://x/`command@A|v`" }),
      {
        id: "A",
        label: "A",
        groupId: "g",
        order: 0,
        command: 'echo {"v":"9"}',
        executionType: "script",
        deleted: false,
        favorite: false,
      },
    ]);
    const cap: ReqCap = {};
    const r = await runCommand(
      {
        data,
        process: fakeProcess('{"v":"9"}'),
        network: fakeNetwork({ status: 200, body: "ok" }, cap),
      },
      { commandId: "root" },
    );
    expect(r.ok).toBe(true);
    expect(cap.req?.url).toBe("https://x/9"); // A 출력 v=9 가 B url 에 치환
  });

  it("url 의 미입력 파라미터 → UNRESOLVED(미치환 토큰 전송 0)", async () => {
    const data = fakeData([apiRec({ url: "https://x/{missing}" })]);
    const cap: ReqCap = {};
    const r = await runCommand(
      { data, network: fakeNetwork({ status: 200, body: "ok" }, cap) },
      { commandId: "root" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("UNRESOLVED");
    expect(cap.req).toBeUndefined(); // 전송되지 않음
  });

  it("network 표면 없음(권한 미선언) → NO_RUNTIME", async () => {
    const data = fakeData([apiRec({ url: "https://x" })]);
    const r = await runCommand({ data }, { commandId: "root" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NO_RUNTIME");
  });

  it("secret 미가용 → SECRET_PENDING(전송 전 거부)", async () => {
    const data = fakeData([
      apiRec({ url: "https://x", headers: { authorization: "Bearer `secret@apiKey`" } }),
    ]);
    const cap: ReqCap = {};
    const r = await runCommand(
      {
        data,
        network: fakeNetwork({ status: 200, body: "ok" }, cap),
        secrets: { has: async () => false },
      },
      { commandId: "root", secretNs: "ns" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SECRET_PENDING");
    expect(cap.req).toBeUndefined();
  });

  it("multipart 바디는 후속 → NO_RUNTIME(명시)", async () => {
    const data = fakeData([apiRec({ url: "https://x", bodyType: "multipart" })]);
    const cap: ReqCap = {};
    const r = await runCommand(
      { data, network: fakeNetwork({ status: 200, body: "ok" }, cap) },
      { commandId: "root" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NO_RUNTIME");
  });
});
