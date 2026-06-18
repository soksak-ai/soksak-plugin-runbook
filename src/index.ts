// 런북 플러그인 entry — 데이터 모델(commands/groups/history) + CRUD·실행 커맨드 + 런북 뷰(명령
// 목록 + 인라인 배지 입력 에디터). R7: 모든 기능을 커맨드로 노출(UI 없이 E2E 전부) + contributes.nodes·
// data-node 로 DOM 노출.
//
// 데이터는 코어 app.data(SQLite, CJK 전문검색, ns=pluginId 격리), 변경 동기화는 app.data.watch
// (전 창 브로드캐스트, 폴링 0). Reference 해석 엔진(src/refs)은 순수 코어 — command.add/update 시
// command 템플릿을 parse 해 Reference 메타를 추출·저장한다(검증·표시용).
//
// [인라인 배지 에디터] 토큰↔배지 직렬화·트리거 감지는 src/ui/tokens 순수 모듈(단일 파서 parse 재사용
// R8). runbook.editor.tokens/serialize 로 헤드리스 노출(에디터 mount 무관 — 순수 검증).

import { registerCommands } from "./commands/runbook";
import { defineCollections, type DataApi } from "./data/store";
import { COMMANDS, GROUPS, HISTORY } from "./data/model";
import { parse, resolve, type ResolveContext } from "./refs/index";
import { deserialize, serialize, tokensOf } from "./ui/tokens";
import { createRunbookView, type RunbookApi } from "./ui/view";

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

interface ViewProvider {
  mount: (container: HTMLElement, ctx: unknown) => void;
  unmount?: (container: HTMLElement) => void;
}

interface UiApi {
  registerView: (viewId: string, provider: ViewProvider) => Disposable;
}

interface SecretsApi {
  keys: () => Promise<string[]>;
  /** 이 플러그인 ns 에 key 존재 여부(볼트 언락 전제). 평문 0 — boolean 만. 실행 엔진의 SECRET_PENDING 게이트. */
  has: (key: string) => Promise<boolean>;
}

interface PluginContext {
  app: {
    pluginId: string;
    data?: DataApi;
    commands?: CommandsApi;
    process?: ProcessApi;
    ui?: UiApi;
    secrets?: SecretsApi;
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

    // ── 런북 뷰(우측 사이드바). 데이터 변경 → 전 창 mounts refresh(폴링 0). ──
    // mounts 는 마운트된 뷰 인스턴스 — data.watch 가 전 창에 refresh 라우팅.
    const mounts = new Set<{ refresh: () => void }>();
    if (app.ui) {
      const viewApp: RunbookApi = {
        data: data as unknown as RunbookApi["data"],
        commands: { execute: (name, params) => cmds.execute!(name, params) as Promise<Record<string, unknown>> },
        secrets: app.secrets,
        pluginId: app.pluginId,
      };
      sub(app.ui.registerView("runbook", createRunbookView(viewApp, mounts) as unknown as ViewProvider));
    }

    // 전 창 동기화(데이터 변경 → watch). 뷰가 마운트돼 있으면 그 인스턴스들을 재질의(전 창 일관, 폴링 0).
    for (const coll of [COMMANDS, GROUPS, HISTORY]) {
      sub(
        data.watch(coll, undefined, () => {
          for (const mEntry of mounts) mEntry.refresh();
        }),
      );
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
      // 셸 실행 전 가용성 게이트(SECRET_PENDING) — app.secrets.has(평문 0, ns 자동주입).
      secrets: app.secrets,
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

    // ── 인라인 배지 에디터 순수 로직 노출(에디터 mount 무관 — 헤드리스 검증 R7). ──
    // 토큰↔배지 직렬화는 src/ui/tokens(단일 파서 parse 재사용 R8). 시크릿 토큰은 key 만 — 평문 0(R2).
    sub(
      cmds.register("runbook.editor.tokens", {
        description:
          "저장형 토큰 문자열을 배지 토큰 배열로 역직렬화(텍스트 제외). 인라인 배지 에디터의 토큰 모델 검증용. 시크릿 토큰은 provider·key 만 — 평문 미보유(R2).",
        params: { text: { type: "string", required: true, description: "저장형 토큰 문자열" } },
        returns: "{ tokens: [{ provider, key, jsonPath?, options?, raw }] }",
        examples: [
          `sok plugin.soksak-plugin-runbook.runbook.editor.tokens '{"text":"deploy {env:dev|prod} \\\`secret@token\\\`"}'`,
        ],
        handler: (p) => ({ ok: true, tokens: tokensOf(String(p.text ?? "")) }),
      }),
    );
    sub(
      cmds.register("runbook.editor.serialize", {
        description:
          "배지 토큰/텍스트 세그먼트 배열을 저장형 토큰 문자열로 직렬화(에디터 저장 경로의 순수 노출). raw 가 없는 토큰은 provider 규약으로 합성. text 만 넘기면 역직렬화→재직렬화 왕복(항등 확인).",
        params: {
          text: { type: "string", description: "저장형 문자열(왕복 검증용)" },
          segments: { type: "object", description: "세그먼트 배열(직접 직렬화)" },
        },
        returns: "{ serialized }",
        handler: (p) => {
          if (Array.isArray((p as { segments?: unknown }).segments)) {
            return { ok: true, serialized: serialize((p as { segments: never[] }).segments) };
          }
          // text 만 → 역직렬화 후 재직렬화(왕복 항등이어야 함). 단일 파서(parse)를 거친다.
          return { ok: true, serialized: serialize(deserialize(String(p.text ?? ""))) };
        },
      }),
    );
  },

  deactivate() {
    // 등록물·구독은 ctx.subscriptions/호스트 tracker 가 자동 수거.
  },
};
