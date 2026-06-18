// 런북 플러그인 entry — 이번 범위는 최소 activate 다(엔진을 소켓에서 검증하는 커맨드 2개 +
// 데이터 컬렉션 define). 5종 실행타입·배지 입력 UI·secretRef 주입은 후속 워크플로.
//
// Reference 해석 엔진(src/refs)은 순수 코어이며, 여기서는 그것을 sok CLI/MCP 로 노출해
// 헤드리스 E2E 가 parse/resolve 동작을 단언할 수 있게 한다(R7 — 모든 기능을 커맨드로).

import { parse, resolve, type ResolveContext } from "./refs/index";

const COLL = "runbooks";

interface PluginContext {
  app: {
    pluginId: string;
    data?: {
      define: (
        coll: string,
        opts: { indexes?: string[]; fts?: string[] },
      ) => Promise<void>;
    };
    commands?: {
      register: (
        name: string,
        spec: {
          description: string;
          handler: (params: Record<string, unknown>) => unknown;
        },
      ) => { dispose: () => void };
    };
  };
  subscriptions: { dispose: () => void }[];
}

export default {
  async activate(ctx: PluginContext) {
    const app = ctx.app;
    const sub = (d: { dispose: () => void }) => ctx.subscriptions.push(d);

    // 데이터 컬렉션 정의(멱등). 작업 본문·이름은 인덱스, 본문은 CJK 검색 대상.
    // 실제 작업 CRUD 는 후속 범위 — 여기서는 컬렉션만 마련한다.
    await app.data?.define(COLL, {
      indexes: ["name", "kind"],
      fts: ["name", "template"],
    });

    // ref.parse — 템플릿을 파싱해 노드/Reference 를 그대로 반환(엔진 검증용).
    if (app.commands) {
      sub(
        app.commands.register("ref.parse", {
          description:
            "Reference 템플릿을 파싱해 노드와 추출된 Reference 목록을 반환(엔진 검증).",
          handler: (params) => {
            const template = String(params.template ?? "");
            return parse(template);
          },
        }),
      );

      // ref.resolve — 템플릿을 context 로 해석해 텍스트/에러/핸들을 반환(엔진 검증용).
      // 평문 시크릿은 받지 않는다 — secretNs 만(핸들 생성 R2).
      sub(
        app.commands.register("ref.resolve", {
          description:
            "Reference 템플릿을 주어진 context 로 해석해 텍스트·에러·시크릿 핸들을 반환(엔진 검증).",
          handler: (params) => {
            const template = String(params.template ?? "");
            const ctxIn = (params.context ?? {}) as ResolveContext;
            return resolve(parse(template), ctxIn);
          },
        }),
      );
    }
  },
};
