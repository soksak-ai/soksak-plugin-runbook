// 링킹 — command 참조 의존 그래프를 구성하고 위상순으로 실행 계획을 낸다(R4 핵심).
//
// command 참조(`command@id|jsonPath`)는 다른 작업의 출력을 가리킨다. 한 명령을 풀려면 그것이
// 참조하는 command 들을 먼저 실행해 출력을 모으고(context.command), 그 context 로 resolve 해야
// 한다. 즉 한 명령의 출력이 다음 입력으로 되먹임된다. 이 모듈은 그 의존 닫힘(closure)을 모으고
// 순환을 검출하는 순수부 — 실제 셸 실행은 호출자(engine)가 outcome 맵으로 채운다(중복 0).
//
// 순수성: 본 모듈은 I/O 를 하지 않는다. 참조 명령의 본문 템플릿은 loadTemplate 콜백으로 받는다
// (engine 이 app.data.get 으로 주입). 미정의 참조는 그래프에서 빠지고 resolve 단계 LinkError 가 된다.

import {
  commandDeps,
  detectCycle,
  parse,
  topoSort,
  type DepGraph,
} from "../refs/index";

/** 링킹 계획. order = 위상순 실행 순서(의존 먼저, 루트 나중). missing = 본문을 못 찾은 참조 id. */
export interface LinkPlan {
  /** 위상순 command id(의존이 앞, 루트가 뒤). 루트 자신도 포함된다. */
  order: string[];
  /** 정의를 못 찾은 command 참조 id(실행 불가 — resolve 단계에서 LinkError). */
  missing: string[];
}

/** 순환 거부. cycle = 순환 경로(예: ["a","b","a"]). */
export interface LinkCycle {
  cycle: string[];
}

export type LinkOutcome =
  | { ok: true; plan: LinkPlan }
  | { ok: false; cycle: string[] };

/** 루트 command 의 의존 닫힘을 BFS 로 모으며 본문 템플릿 맵을 구성한다(순수 — loadTemplate 만 호출).
 *  본문을 못 찾는 참조는 그래프에 노드로 넣지 않는다 → topoSort 대상에서 빠지고 missing 으로 보고. */
function collectTasks(
  rootId: string,
  rootTemplate: string,
  loadTemplate: (id: string) => string | null,
): { tasks: Record<string, string>; missing: Set<string> } {
  const tasks: Record<string, string> = { [rootId]: rootTemplate };
  const missing = new Set<string>();
  const seen = new Set<string>([rootId]);
  const queue: string[] = [rootId];

  while (queue.length > 0) {
    const id = queue.shift() as string;
    const { refs } = parse(tasks[id]);
    for (const depId of commandDeps(refs)) {
      if (seen.has(depId)) continue;
      seen.add(depId);
      const tmpl = loadTemplate(depId);
      if (tmpl == null) {
        missing.add(depId);
        continue;
      }
      tasks[depId] = tmpl;
      queue.push(depId);
    }
  }
  return { tasks, missing };
}

/** 루트 command 의 링킹 계획을 낸다. 순환이면 ok:false(무한재귀 제거 R4). 순수. */
export function planLink(
  rootId: string,
  rootTemplate: string,
  loadTemplate: (id: string) => string | null,
): LinkOutcome {
  const { tasks, missing } = collectTasks(rootId, rootTemplate, loadTemplate);

  // 의존 그래프 + 순환 검출 — 순환이면 즉시 거부(resolve·실행 진입 전).
  const graph: DepGraph = new Map();
  for (const [id, template] of Object.entries(tasks)) {
    const { refs } = parse(template);
    // 정의된 참조만 그래프 엣지로(미정의는 missing — 순환 대상 아님).
    const deps = commandDeps(refs).filter((d) => d in tasks);
    graph.set(id, new Set(deps));
  }
  const cycle = detectCycle(graph);
  if (cycle) return { ok: false, cycle };

  const order = topoSort(graph);
  return { ok: true, plan: { order, missing: [...missing] } };
}
