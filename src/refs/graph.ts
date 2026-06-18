// 의존 그래프 + 위상정렬 + 순환 검출 (R4 — 레거시의 무한재귀 제거).
//
// command Reference 는 다른 작업(command)의 출력을 가리킨다 — A 가 B 를 참조하고 B 가 A 를
// 참조하면 순환이다. 레거시는 문자열 치환을 재귀로 풀어 A→B→A 에서 무한재귀였다. 여기서는
// 그래프를 명시 구성하고 detectCycle 로 거부한다. 실행 순서는 topoSort 가 의존 역순으로 낸다.
//
// command 작업의 본문 템플릿을 풀려면 그 본문이 또 다른 command 를 참조할 수 있으므로,
// 그래프는 "노드 id → 그 노드가 참조하는 command id 목록"으로 표현한다(노드=작업).

import { parse } from "./parse";
import type { Reference } from "./types";

/** 노드 id → 의존하는 command id 집합. */
export type DepGraph = Map<string, Set<string>>;

/** 단일 작업의 command Reference 들에서 직접 의존 id 를 뽑는다(순수). */
export function commandDeps(refs: Reference[]): string[] {
  const out: string[] = [];
  for (const r of refs) {
    if (r.provider === "command") out.push(r.key);
  }
  return out;
}

/** 작업 맵(id → 본문 템플릿)에서 의존 그래프를 구성한다. 본문을 parse 해 command 참조를 모은다. */
export function dependencyGraph(tasks: Record<string, string>): DepGraph {
  const graph: DepGraph = new Map();
  for (const [id, template] of Object.entries(tasks)) {
    const { refs } = parse(template);
    graph.set(id, new Set(commandDeps(refs)));
  }
  return graph;
}

/** 순환 경로를 찾는다. 있으면 순환을 이루는 노드 경로(예: ["a","b","a"]), 없으면 null. */
export function detectCycle(graph: DepGraph): string[] | null {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of graph.keys()) color.set(id, WHITE);
  const stack: string[] = [];

  const dfs = (node: string): string[] | null => {
    color.set(node, GRAY);
    stack.push(node);
    for (const dep of graph.get(node) ?? []) {
      // 그래프에 없는 의존(미정의 작업)은 순환 대상이 아님 — 해소 단계에서 LinkError.
      if (!graph.has(dep)) continue;
      const c = color.get(dep);
      if (c === GRAY) {
        // dep 부터 현재까지가 순환. 닫는 노드를 끝에 붙여 경로를 명시.
        const from = stack.indexOf(dep);
        return [...stack.slice(from), dep];
      }
      if (c === WHITE) {
        const found = dfs(dep);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return null;
  };

  for (const id of graph.keys()) {
    if (color.get(id) === WHITE) {
      const cycle = dfs(id);
      if (cycle) return cycle;
    }
  }
  return null;
}

/** 위상정렬(의존 먼저 → 의존자 나중). 순환이면 throw(detectCycle 로 먼저 거른다는 계약). */
export function topoSort(graph: DepGraph): string[] {
  const cycle = detectCycle(graph);
  if (cycle) {
    throw new Error(`순환 의존 — 위상정렬 불가: ${cycle.join(" → ")}`);
  }
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (node: string): void => {
    if (visited.has(node)) return;
    visited.add(node);
    for (const dep of graph.get(node) ?? []) {
      if (graph.has(dep)) visit(dep);
    }
    order.push(node); // 의존을 먼저 push → 의존이 앞, 의존자가 뒤
  };
  for (const id of graph.keys()) visit(id);
  return order;
}
