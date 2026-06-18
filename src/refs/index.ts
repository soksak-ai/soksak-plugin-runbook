// Reference 해석 엔진 — 순수 코어 공개 표면(I/O 0). parse(해석) ↔ resolve(치환)는 분리되고,
// 그래프/순환검출/위상정렬은 command 체인의 무한재귀를 구조로 막는다(R4).

export * from "./types";
export { parse } from "./parse";
export { resolve } from "./resolve";
export {
  dependencyGraph,
  detectCycle,
  topoSort,
  commandDeps,
  type DepGraph,
} from "./graph";
export {
  extractJsonPath,
  parseJsonPath,
  stringifyValue,
} from "./jsonpath";
export {
  PARAM_RE,
  ENV_RE,
  BADGE_RE,
  BADGE_PROVIDERS,
} from "./patterns";
