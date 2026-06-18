import { describe, expect, it } from "vitest";
import {
  badgeLabel,
  deserialize,
  detectTrigger,
  filterCandidates,
  serialize,
  tokenToRaw,
  tokensOf,
  type Segment,
} from "./tokens";

describe("직렬화 ↔ 역직렬화 왕복(단일 파서 재사용)", () => {
  const cases = [
    "make deploy {env:dev|prod}",
    "curl -H 'Authorization: `secret@token`' {{API_BASE}}/x",
    "echo `command@fetch|data.token` done",
    "paste `clipboard@sel` and `var@cfg|items[0].x`",
    "plain text no tokens",
    "{a}{{b}}`secret@c`", // 연속 토큰(텍스트 0 사이)
  ];
  for (const tmpl of cases) {
    it(`왕복 항등: ${tmpl}`, () => {
      const segs = deserialize(tmpl);
      expect(serialize(segs)).toBe(tmpl);
    });
  }

  it("시크릿 배지는 평문을 보유하지 않는다 — key 만(R2)", () => {
    const segs = deserialize("auth `secret@apiKey`");
    const badge = segs.find((s) => s.kind === "badge");
    expect(badge).toBeDefined();
    if (badge && badge.kind === "badge") {
      expect(badge.token.provider).toBe("secret");
      expect(badge.token.key).toBe("apiKey");
      // 토큰 모델 어디에도 value/평문 필드가 없다.
      expect(Object.keys(badge.token).sort()).toEqual(["key", "provider", "raw"].sort());
    }
  });

  it("tokensOf 는 텍스트를 제외하고 배지 토큰만", () => {
    const toks = tokensOf("a {x} b `secret@k` c");
    expect(toks.map((t) => t.provider)).toEqual(["param", "secret"]);
    expect(toks.map((t) => t.key)).toEqual(["x", "k"]);
  });
});

describe("tokenToRaw — 후보 선택으로 새 배지 합성(raw 없는 경로)", () => {
  it("param 자유/옵션", () => {
    expect(tokenToRaw({ provider: "param", key: "env" })).toBe("{env}");
    expect(tokenToRaw({ provider: "param", key: "env", options: ["dev", "prod"] })).toBe(
      "{env:dev|prod}",
    );
  });
  it("env", () => {
    expect(tokenToRaw({ provider: "env", key: "HOME" })).toBe("{{HOME}}");
  });
  it("백틱 배지 + jsonPath", () => {
    expect(tokenToRaw({ provider: "secret", key: "token" })).toBe("`secret@token`");
    expect(tokenToRaw({ provider: "command", key: "f", jsonPath: "a.b" })).toBe(
      "`command@f|a.b`",
    );
  });

  it("합성한 raw 가 다시 역직렬화되어 같은 토큰으로 왕복", () => {
    const segs: Segment[] = [
      { kind: "text", value: "x " },
      { kind: "badge", token: { provider: "secret", key: "k", raw: "" } },
    ];
    const str = serialize(segs); // raw="" 라 tokenToRaw 로 합성
    expect(str).toBe("x `secret@k`");
    expect(tokensOf(str)[0]).toMatchObject({ provider: "secret", key: "k" });
  });
});

describe("badgeLabel — 표시 idiom <type>#<key>", () => {
  it("기본", () => {
    expect(badgeLabel({ provider: "secret", key: "token", raw: "`secret@token`" })).toBe(
      "secret#token",
    );
  });
  it("jsonPath 부기", () => {
    expect(
      badgeLabel({ provider: "command", key: "f", jsonPath: "data.x", raw: "" }),
    ).toBe("command#f·data.x");
  });
});

describe("detectTrigger — 종류별·경계", () => {
  it("param '{' 열림", () => {
    expect(detectTrigger("make deploy {en")).toEqual({
      provider: "param",
      query: "en",
      start: 12,
    });
  });
  it("param 콜론 이후(옵션 영역)는 트리거 아님", () => {
    expect(detectTrigger("{env:de")).toBeNull();
  });
  it("닫힌 param 뒤는 트리거 아님", () => {
    expect(detectTrigger("{env} more")).toBeNull();
  });
  it("env '{{' 가 param 보다 우선", () => {
    expect(detectTrigger("path {{HO")).toEqual({
      provider: "env",
      query: "HO",
      start: 5,
    });
  });
  it("닫힌 env 뒤는 트리거 아님", () => {
    expect(detectTrigger("{{HOME}} x")).toBeNull();
  });
  it("secret 백틱 배지", () => {
    expect(detectTrigger("auth `secret@ap")).toEqual({
      provider: "secret",
      query: "ap",
      start: 5,
    });
  });
  it("command 백틱 배지(가장 구체적 opener)", () => {
    expect(detectTrigger("x `command@fe")).toEqual({
      provider: "command",
      query: "fe",
      start: 2,
    });
  });
  it("clipboard·var 백틱 배지", () => {
    expect(detectTrigger("`clipboard@")?.provider).toBe("clipboard");
    expect(detectTrigger("`var@c")?.provider).toBe("var");
  });
  it("닫힌 백틱 배지 뒤는 트리거 아님", () => {
    expect(detectTrigger("`secret@k` rest")).toBeNull();
  });
  it("provider@ 미완성 백틱은 트리거 아님(provider 미확정)", () => {
    expect(detectTrigger("`sec")).toBeNull();
  });
  it("공백 들어온 백틱 쿼리는 종료", () => {
    expect(detectTrigger("`secret@a b")).toBeNull();
  });
  it("토큰 없는 평문은 null", () => {
    expect(detectTrigger("just words")).toBeNull();
  });
});

describe("filterCandidates — prefix 우선 부분일치", () => {
  it("빈 쿼리는 전체(복사본)", () => {
    const c = ["a", "b"];
    expect(filterCandidates(c, "")).toEqual(["a", "b"]);
    expect(filterCandidates(c, "")).not.toBe(c);
  });
  it("부분일치 + prefix 정렬", () => {
    expect(filterCandidates(["apiKey", "key", "secretKey"], "key")).toEqual([
      "key",
      "apiKey",
      "secretKey",
    ]);
  });
  it("대소문자 무시", () => {
    expect(filterCandidates(["TOKEN"], "tok")).toEqual(["TOKEN"]);
  });
  it("미일치는 제외", () => {
    expect(filterCandidates(["a", "b"], "zzz")).toEqual([]);
  });
});
