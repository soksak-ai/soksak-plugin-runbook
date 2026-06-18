import { describe, expect, it } from "vitest";
import { planLink } from "./link";

// loadTemplate 헬퍼 — 맵 기반(미정의는 null → missing).
const loader = (tasks: Record<string, string>) => (id: string) => tasks[id] ?? null;

describe("planLink — 링킹 순수부(의존 닫힘 + 위상순 + 순환 검출)", () => {
  it("참조 없는 루트는 자기만 order 에", () => {
    const r = planLink("root", "echo hi", loader({ root: "echo hi" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.order).toEqual(["root"]);
      expect(r.plan.missing).toEqual([]);
    }
  });

  it("의존 닫힘을 모으고 위상순(의존 먼저, 루트 나중)으로 정렬", () => {
    // B 가 A 를 참조 → A 먼저, B 나중.
    const tasks = {
      B: 'use `command@A|v`',
      A: 'echo {"v":"42"}',
    };
    const r = planLink("B", tasks.B, loader(tasks));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.order.indexOf("A")).toBeLessThan(r.plan.order.indexOf("B"));
      expect(r.plan.missing).toEqual([]);
    }
  });

  it("다단 체인(루트→M→leaf)도 의존 먼저", () => {
    const tasks = {
      root: 'r `command@M`',
      M: 'm `command@leaf`',
      leaf: "x",
    };
    const r = planLink("root", tasks.root, loader(tasks));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const o = r.plan.order;
      expect(o.indexOf("leaf")).toBeLessThan(o.indexOf("M"));
      expect(o.indexOf("M")).toBeLessThan(o.indexOf("root"));
    }
  });

  it("순환(A↔B)을 거부한다(무한재귀 제거 R4)", () => {
    const tasks = {
      A: 'a `command@B`',
      B: 'b `command@A`',
    };
    const r = planLink("A", tasks.A, loader(tasks));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.cycle).toContain("A");
      expect(r.cycle).toContain("B");
    }
  });

  it("자기참조 A→A 도 순환", () => {
    const r = planLink("A", 'loop `command@A`', loader({ A: 'loop `command@A`' }));
    expect(r.ok).toBe(false);
  });

  it("정의 없는 참조는 missing 으로(순환 대상 아님)", () => {
    const r = planLink("root", 'use `command@ghost`', loader({ root: 'use `command@ghost`' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.missing).toContain("ghost");
      expect(r.plan.order).toEqual(["root"]);
    }
  });
});
