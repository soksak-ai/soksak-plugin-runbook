// 런북 플러그인 entry — 이번 범위 = 데이터 모델(commands/groups/history) + CRUD 커맨드 headless
// (R7: UI 없이 E2E 전부). 5종 실행기·secretRef 주입·배지 입력 UI 는 후속 워크플로.
//
// 데이터는 코어 app.data(SQLite, CJK 전문검색, ns=pluginId 격리), 변경 동기화는 app.data.watch
// (전 창 브로드캐스트, 폴링 0). Reference 해석 엔진(src/refs)은 순수 코어 — command.add/update 시
// command 템플릿을 parse 해 Reference 메타를 추출·저장한다(검증·표시용, 실행은 후속).

import { registerCommands } from "./commands/runbook";
import { defineCollections, type DataApi } from "./data/store";
import { COMMANDS, GROUPS, HISTORY } from "./data/model";
import { parse, resolve, type ResolveContext } from "./refs/index";

type Disposable = { dispose: () => void };

interface CommandsApi {
  register: (
    name: string,
    spec: {
      description: string;
      params?: Record<string, unknown>;
      returns?: string;
      examples?: string[];
      handler: (params: Record<string, unknown>) => unknown;
    },
  ) => Disposable;
  execute?: (
    name: string,
    params?: Record<string, unknown>,
  ) => Promise<{ ok: boolean; code?: string; message?: string; [k: string]: unknown }>;
}

interface ProcessApi {
  spawn: (
    cmd: string,
    args: string[],
    opts?: { cwd?: string; env?: Record<string, string>; envRemove?: string[] },
  ) => Promise<number>;
  onData: (handle: number, cb: (data: Uint8Array) => void) => Disposable;
  onStderr: (handle: number, cb: (data: Uint8Array) => void) => Disposable;
  onExit: (handle: number, cb: (code: number) => void) => Disposable;
  kill: (handle: number) => Promise<void>;
}

interface PluginContext {
  app: {
    pluginId: string;
    data?: DataApi;
    commands?: CommandsApi;
    process?: ProcessApi;
  };
  subscriptions: Disposable[];
}

export default {
  async activate(ctx: PluginContext) {
    const app = ctx.app;
    const sub = (d: Disposable) => ctx.subscriptions.push(d);

    if (!app.data || !app.commands) {
      // data·commands 권한 없으면 표면이 undefined(권한 게이트) — 헤드리스 CRUD 불가.
      return;
    }
    const data = app.data;
    const cmds = app.commands;

    // 컬렉션 3종 define(멱등).
    await defineCollections(data);

    // 전 창 동기화(데이터 변경 → watch). 뷰는 후속이지만 watch seam 은 지금 둔다(폴링 0).
    for (const coll of [COMMANDS, GROUPS, HISTORY]) {
      sub(data.watch(coll, undefined, () => {}));
    }

    // CRUD + 실행 커맨드 등록(전 기능 노출 R7). 실행 엔진은 셸 spawn(app.process)·터미널(term.exec
    // via app.commands.execute) 을 쓴다 — 권한 미선언 시 표면이 undefined → 엔진이 NO_RUNTIME 명시 거부.
    const execFn = cmds.execute;
    registerCommands(data, cmds, sub, {
      process: app.process,
      execute: execFn
        ? { execute: (name, params) => execFn(name, params) }
        : undefined,
      // secret 참조 해소 ns = 이 플러그인 id(평문 아님 — 핸들 ns). secretEnv 주입은 Rust 경계.
      secretNs: app.pluginId,
    });

    // ── Reference 엔진 검증 노출(엔진 자체 단언용 — parse/resolve 순수 코어). ──
    sub(
      cmds.register("ref.parse", {
        description: "Reference 템플릿을 파싱해 노드와 추출된 Reference 목록을 반환(엔진 검증).",
        params: { template: { type: "string", required: true } },
        returns: "{ nodes, refs }",
        handler: (p) => parse(String(p.template ?? "")),
      }),
    );
    sub(
      cmds.register("ref.resolve", {
        description:
          "Reference 템플릿을 주어진 context 로 해석해 텍스트·에러·시크릿 핸들을 반환(엔진 검증). 평문 시크릿 미수신 — secretNs 만.",
        params: { template: { type: "string", required: true }, context: { type: "object" } },
        returns: "{ text, errors, handles }",
        handler: (p) =>
          resolve(parse(String(p.template ?? "")), (p.context ?? {}) as ResolveContext),
      }),
    );
  },

  deactivate() {
    // 등록물·구독은 ctx.subscriptions/호스트 tracker 가 자동 수거.
  },
};
