// applySecretEnv 단위 — secret 참조 → env 플레이스홀더($SOKSAK_SECRET_N) + secretEnv 맵. 평문 0(R2).
//
// resolve 는 secret 참조를 인라인 마커(" secret:<key> ")로 남기고 핸들을 수집한다(평문 미주입).
// applySecretEnv 는 그 마커를 $SOKSAK_SECRET_N 으로 치환하고 {SOKSAK_SECRET_N: key} 를 누적한다.
// 실제 평문 해소·자식 env 주입은 Rust 경계(process_spawn secret_env) — 이 순수부는 키 이름만 다룬다.

import { describe, expect, it } from "vitest";
import { applySecretEnv } from "./engine";
import { parse, resolve } from "../refs/index";

/** 템플릿을 secretNs context 로 resolve → applySecretEnv 적용(엔진 실경로와 동형). */
function run(template: string, secretNs = "soksak-plugin-runbook") {
  const r = resolve(parse(template), { secretNs });
  return applySecretEnv(r.text, r.handles);
}

describe("applySecretEnv — secret 참조를 env 플레이스홀더로(평문 0)", () => {
  it("단일 secret → $SOKSAK_SECRET_0 + secretEnv{SOKSAK_SECRET_0: key}", () => {
    const { text, secretEnv } = run("curl -H 'Authorization: Bearer `secret@apiKey`' x");
    expect(secretEnv).toEqual({ SOKSAK_SECRET_0: "apiKey" });
    expect(text).toContain("$SOKSAK_SECRET_0");
    // 평문은 없다(키 이름만) — apiKey 자체가 셸 명령에 그대로 박히지 않는다.
    expect(text).not.toContain("secret:apiKey");
  });

  it("여러 secret → 인덱스 증가, 같은 key 는 같은 env 재사용(중복 주입 0)", () => {
    const { text, secretEnv } = run("`secret@a` `secret@b` `secret@a`");
    // a 는 0, b 는 1, 두 번째 a 는 0 재사용.
    expect(secretEnv).toEqual({ SOKSAK_SECRET_0: "a", SOKSAK_SECRET_1: "b" });
    const count0 = (text.match(/\$SOKSAK_SECRET_0/g) ?? []).length;
    expect(count0).toBe(2); // a 두 출현 모두 같은 env
    expect(text).toContain("$SOKSAK_SECRET_1");
  });

  it("secret 없으면 secretEnv 비어있고 텍스트 불변", () => {
    const { text, secretEnv } = run("echo {{HOME}}");
    expect(secretEnv).toEqual({});
    expect(text).toContain("echo");
  });

  it("secretNs 없으면 secret 은 미해소(핸들 0) → secretEnv 비어있음", () => {
    const r = resolve(parse("`secret@apiKey`"), {});
    const { secretEnv } = applySecretEnv(r.text, r.handles);
    expect(secretEnv).toEqual({});
  });
});
