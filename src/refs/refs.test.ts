import { describe, expect, it } from "vitest";
import {
  dependencyGraph,
  detectCycle,
  extractJsonPath,
  parse,
  resolve,
  topoSort,
  type DepGraph,
} from "./index";

describe("parse — 전 토큰 종류 추출", () => {
  it("파라미터 {name} 와 {name:a|b} 를 구분 추출", () => {
    const { refs } = parse("hello {who} run {mode:fast|slow}");
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ provider: "param", key: "who" });
    expect(refs[0].options).toBeUndefined();
    expect(refs[1]).toMatchObject({ provider: "param", key: "mode" });
    expect(refs[1].options).toEqual(["fast", "slow"]);
  });

  it("환경변수 {{var}} 를 param 과 혼동하지 않는다", () => {
    const { refs } = parse("path={{HOME}}/bin and {x}");
    expect(refs[0]).toMatchObject({ provider: "env", key: "HOME" });
    expect(refs[1]).toMatchObject({ provider: "param", key: "x" });
  });

  it("저장형 배지 — secret/command/clipboard/var 와 jsonPath 추출", () => {
    const { refs } = parse(
      "auth `secret@apiKey` data `command@fetch|data.token` clip `clipboard@sel` v `var@cfg|items[0].x`",
    );
    expect(refs[0]).toMatchObject({ provider: "secret", key: "apiKey" });
    expect(refs[1]).toMatchObject({
      provider: "command",
      key: "fetch",
      jsonPath: "data.token",
    });
    expect(refs[2]).toMatchObject({ provider: "clipboard", key: "sel" });
    expect(refs[3]).toMatchObject({
      provider: "var",
      key: "cfg",
      jsonPath: "items[0].x",
    });
  });

  it("노드 순서 — 텍스트와 ref 가 위치순으로 교차", () => {
    const { nodes } = parse("a {x} b");
    expect(nodes.map((n) => n.kind)).toEqual(["text", "ref", "text"]);
  });
});

describe("detectCycle / topoSort — 순환 검출 + 위상정렬", () => {
  it("A↔B 순환을 거부한다(레거시 무한재귀 제거)", () => {
    const g = dependencyGraph({
      a: "calls `command@b`",
      b: "calls `command@a`",
    });
    const cycle = detectCycle(g);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain("a");
    expect(cycle).toContain("b");
    expect(() => topoSort(g)).toThrow(/순환/);
  });

  it("정상 DAG 를 통과시키고 의존 순서로 정렬", () => {
    // a → b → c (a 가 b 를, b 가 c 를 참조). 의존이 먼저: c, b, a.
    const g = dependencyGraph({
      a: "use `command@b`",
      b: "use `command@c`",
      c: "leaf",
    });
    expect(detectCycle(g)).toBeNull();
    const order = topoSort(g);
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("a"));
  });

  it("자기참조 A→A 도 순환으로 본다", () => {
    const g: DepGraph = dependencyGraph({ a: "loop `command@a`" });
    expect(detectCycle(g)).not.toBeNull();
  });
});

describe("extractJsonPath — 단일 유틸(점표기 + [n])", () => {
  it("data.token", () => {
    expect(extractJsonPath({ data: { token: "T" } }, "data.token")).toBe("T");
  });
  it("items[0].x", () => {
    expect(
      extractJsonPath({ items: [{ x: 42 }] }, "items[0].x"),
    ).toBe(42);
  });
  it("미존재 경로는 undefined", () => {
    expect(extractJsonPath({ a: 1 }, "a.b.c")).toBeUndefined();
  });
  it("빈 경로는 값 자체", () => {
    expect(extractJsonPath({ a: 1 }, "")).toEqual({ a: 1 });
  });
});

describe("resolve — 치환 정확·secret=핸들·미해소→LinkError", () => {
  it("param/env/command jsonPath 를 정확히 치환", () => {
    const parsed = parse("{who} at {{HOME}} got `command@fetch|data.token`");
    const r = resolve(parsed, {
      param: { who: "max" },
      env: { HOME: "/home/max" },
      command: { fetch: { data: { token: "TKN" } } },
    });
    expect(r.errors).toHaveLength(0);
    expect(r.text).toBe("max at /home/max got TKN");
  });

  it("secret 은 평문이 아니라 핸들 마커만 내놓는다(R2)", () => {
    const parsed = parse("Authorization: Bearer `secret@apiKey`");
    const r = resolve(parsed, { secretNs: "soksak-plugin-runbook" });
    expect(r.handles).toEqual([
      { __secretRef: true, ns: "soksak-plugin-runbook", key: "apiKey" },
    ]);
    // 평문이 텍스트에 새지 않는다 — 마커 자리만.
    expect(r.text).not.toContain("Bearer apiKey");
    expect(r.text).toContain("secret:apiKey");
  });

  it("미해소 참조는 LinkError 로 명시 전파하고 원문 토큰을 출력에 흘리지 않는다", () => {
    const parsed = parse("run {missing} and `command@nope`");
    const r = resolve(parsed, {});
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0].ref.key).toBe("missing");
    expect(r.errors[1].ref.key).toBe("nope");
    // 미치환 토큰이 셸/HTTP 로 새면 안 된다.
    expect(r.text).not.toContain("{missing}");
    expect(r.text).not.toContain("command@nope");
  });

  it("옵션 목록 밖의 값은 거부", () => {
    const parsed = parse("{mode:fast|slow}");
    const r = resolve(parsed, { param: { mode: "turbo" } });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].reason).toMatch(/옵션/);
  });
});
