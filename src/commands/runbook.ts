// 런북 CRUD 커맨드 — 전 기능 노출(R7: UI 없이 E2E 전부). 반환은 {ok:true,...}/{ok:false,code,
// message}. bare id 키 금지 — commandId/groupId/historyId 식으로 명시. 데이터 변경은 app.data
// 가 전 창 watch 로 동기화(폴링 0). 실제 실행기·secretRef 주입·배지 UI 는 후속 범위.

import {
  COMMANDS,
  GROUPS,
  HISTORY,
  commandRefText,
  makeCommand,
  makeGroup,
  makeHistory,
  mergeCommand,
  validateCommandInput,
  type CommandRecord,
  type GroupRecord,
  type HistoryRecord,
} from "../data/model";
import {
  ensureDefaultGroup,
  extractRefs,
  listCommands,
  listHistory,
  nextCommandOrder,
  type DataApi,
} from "../data/store";
import {
  armSchedule,
  cancelSchedule,
  runCommand,
  type ExecuteApi,
  type NetworkApi,
  type ProcessApi,
  type SecretsProbe,
} from "../exec/index";

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
  ) => { dispose: () => void };
}

type Disposable = { dispose: () => void };

const ok = (extra: Record<string, unknown>) => ({ ok: true, ...extra });
const err = (code: string, message: string) => ({ ok: false, code, message });
const scopeOf = (p: Record<string, unknown>): string | undefined =>
  typeof p.scope === "string" ? p.scope : undefined;

/** 실행 엔진이 의존하는 런타임 표면(셸 spawn + 코어 명령 실행). 권한 게이트로 undefined 가능.
 *  secretNs = 이 플러그인 id(app.pluginId) — secret 참조 해소 시 핸들 ns. 평문 아님. */
export interface RuntimeApis {
  process?: ProcessApi;
  execute?: ExecuteApi;
  secretNs?: string;
  /** secret 가용성 프로브(app.secrets) — 셸 실행 전 SECRET_PENDING 게이트용. 평문 아님(has 만). */
  secrets?: SecretsProbe;
  /** HTTP 실행 표면(app.network.http) — api 실행타입용. 미주입 + api 면 NO_RUNTIME. */
  network?: NetworkApi;
}

/** 모든 CRUD + 실행 커맨드를 등록한다. dispose 들은 호출자(activate)가 subscriptions 에 담는다. */
export function registerCommands(
  data: DataApi,
  cmds: CommandsApi,
  sub: (d: Disposable) => void,
  runtime: RuntimeApis = {},
): void {
  const reg = (
    name: string,
    spec: Parameters<CommandsApi["register"]>[1],
  ): void => sub(cmds.register(name, spec));

  // ── 명령(command) CRUD ──

  reg("command.add", {
    description:
      "런북 명령 추가. label·command(템플릿)·executionType(terminal|script|background|schedule|api) 필수. groupId 생략 시 기본 그룹. command 템플릿의 Reference 메타는 parse 로 추출·저장(검증용).",
    params: {
      label: { type: "string", required: true },
      command: { type: "string", description: "실행 템플릿(셸 타입 — Reference 토큰 가능). api 는 url 사용" },
      executionType: { type: "string", required: true },
      groupId: { type: "string", description: "생략 시 기본 그룹" },
      favorite: { type: "boolean" },
      url: { type: "string", description: "api: 요청 URL(Reference 토큰 가능)" },
      httpMethod: { type: "string", description: "api: GET|POST|PUT|DELETE|PATCH(생략 GET)" },
      headers: { type: "object", description: "api: 요청 헤더 맵(값에 Reference·시크릿 토큰 가능)" },
      queryParams: { type: "object", description: "api: 쿼리 파라미터 맵" },
      bodyType: { type: "string", description: "api: none|json|form(multipart 후속)" },
      bodyData: { type: "string", description: "api: 요청 바디(Reference 토큰 가능)" },
      scheduleAt: { type: "number", description: "schedule: 첫 발화 시각(epoch ms)" },
      repeatType: { type: "string", description: "schedule: none|daily|weekly|monthly(생략 none)" },
      intervalSec: { type: "number", description: "schedule: 주기(초) — repeat 대신 주기 실행, 우선" },
      reminderSecs: { type: "number[]", description: "schedule: 발화 N초 전 리마인더(notify.show)" },
      scope: { type: "string", description: "프로젝트 파티션(생략=전역)" },
    },
    returns: "{ commandId, refs }",
    examples: [
      'sok plugin.soksak-plugin-runbook.command.add \'{"label":"배포","command":"make deploy {env:dev|prod}","executionType":"script"}\'',
      'sok plugin.soksak-plugin-runbook.command.add \'{"label":"핑","executionType":"api","httpMethod":"GET","url":"https://api.example.com/v1/ping"}\'',
    ],
    handler: async (p) => {
      const invalid = validateCommandInput(p);
      if (invalid) return err("INVALID_PARAMS", invalid);
      const scope = scopeOf(p);
      const groupId =
        typeof p.groupId === "string" && p.groupId
          ? p.groupId
          : await ensureDefaultGroup(data, scope);
      const order = await nextCommandOrder(data, scope);
      const rec = makeCommand(p, { groupId, order });
      // refs 메타는 실행 대상 텍스트(api=url/headers/query/body, 그 외=command)에서 추출(단일 진실).
      const refs = extractRefs(commandRefText(rec));
      if (refs.length > 0) rec.refs = refs;
      const commandId = await data.put(COMMANDS, rec, { scope });
      return ok({ commandId, refs });
    },
  });

  reg("command.get", {
    description: "명령 1건 조회(Reference 메타 포함). 없으면 TARGET_NOT_FOUND.",
    params: { commandId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ command }",
    handler: async (p) => {
      if (typeof p.commandId !== "string") return err("INVALID_PARAMS", "commandId 필요");
      const rec = await data.get(COMMANDS, p.commandId, { scope: scopeOf(p) });
      if (!rec) return err("TARGET_NOT_FOUND", "명령 없음");
      return ok({ command: rec });
    },
  });

  reg("command.refs", {
    description: "명령의 command 템플릿을 parse 해 Reference 메타를 반환(검증·표시용 — 실행 아님).",
    params: { commandId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ refs }",
    handler: async (p) => {
      if (typeof p.commandId !== "string") return err("INVALID_PARAMS", "commandId 필요");
      const rec = (await data.get(COMMANDS, p.commandId, {
        scope: scopeOf(p),
      })) as CommandRecord | null;
      if (!rec) return err("TARGET_NOT_FOUND", "명령 없음");
      return ok({ refs: extractRefs(commandRefText(rec)) });
    },
  });

  reg("command.update", {
    description:
      "명령 갱신(전체교체 — 누락 필드는 기존 보존). command 변경 시 Reference 메타 재추출.",
    params: {
      commandId: { type: "string", required: true },
      label: { type: "string" },
      command: { type: "string" },
      executionType: { type: "string" },
      favorite: { type: "boolean" },
      groupId: { type: "string" },
      url: { type: "string", description: "api: 요청 URL" },
      httpMethod: { type: "string", description: "api: GET|POST|PUT|DELETE|PATCH" },
      headers: { type: "object", description: "api: 요청 헤더 맵" },
      queryParams: { type: "object", description: "api: 쿼리 파라미터 맵" },
      bodyType: { type: "string", description: "api: none|json|form" },
      bodyData: { type: "string", description: "api: 요청 바디" },
      scheduleAt: { type: "number", description: "schedule: 첫 발화 시각(epoch ms)" },
      repeatType: { type: "string", description: "schedule: none|daily|weekly|monthly" },
      intervalSec: { type: "number", description: "schedule: 주기(초)" },
      reminderSecs: { type: "number[]", description: "schedule: 발화 N초 전 리마인더" },
      scope: { type: "string" },
    },
    returns: "{ commandId, refs }",
    handler: async (p) => {
      if (typeof p.commandId !== "string") return err("INVALID_PARAMS", "commandId 필요");
      const scope = scopeOf(p);
      const rec = (await data.get(COMMANDS, p.commandId, {
        scope,
      })) as CommandRecord | null;
      if (!rec) return err("TARGET_NOT_FOUND", "명령 없음");
      const next = mergeCommand(rec, p);
      // 갱신 후 실행 대상 텍스트(api=url/headers/query/body, 그 외=command)에서 refs 재추출 —
      // command 뿐 아니라 url/headers 변경도 반영(단일 진실).
      const refs = extractRefs(commandRefText(next));
      next.refs = refs;
      await data.put(COMMANDS, next, { scope, id: p.commandId });
      return ok({ commandId: p.commandId, refs });
    },
  });

  reg("command.delete", {
    description: "명령 휴지통으로(소프트 삭제 — boolean deleted). 복원 가능.",
    params: { commandId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ commandId }",
    handler: async (p) => {
      if (typeof p.commandId !== "string") return err("INVALID_PARAMS", "commandId 필요");
      const scope = scopeOf(p);
      const rec = (await data.get(COMMANDS, p.commandId, {
        scope,
      })) as CommandRecord | null;
      if (!rec) return err("TARGET_NOT_FOUND", "명령 없음");
      await data.put(COMMANDS, { ...rec, deleted: true }, { scope, id: p.commandId });
      // schedule 이면 코어 등록 취소(휴지통 명령이 발화하지 않게).
      if (rec.executionType === "schedule") {
        await cancelSchedule({ execute: runtime.execute?.execute }, rec);
      }
      return ok({ commandId: p.commandId });
    },
  });

  reg("command.restore", {
    description: "휴지통의 명령 복원(deleted=false).",
    params: { commandId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ commandId }",
    handler: async (p) => {
      if (typeof p.commandId !== "string") return err("INVALID_PARAMS", "commandId 필요");
      const scope = scopeOf(p);
      const rec = (await data.get(COMMANDS, p.commandId, {
        scope,
      })) as CommandRecord | null;
      if (!rec) return err("TARGET_NOT_FOUND", "명령 없음");
      const restored = { ...rec, deleted: false };
      await data.put(COMMANDS, restored, { scope, id: p.commandId });
      // schedule 이면 코어에 재등록(복원 즉시 다시 예약).
      if (rec.executionType === "schedule") {
        await armSchedule({ execute: runtime.execute?.execute }, restored, scope, Date.now());
      }
      return ok({ commandId: p.commandId });
    },
  });

  reg("command.duplicate", {
    description: "명령 복제(새 id, label 에 ' (복사)' 접미, 비휴지통·order 맨 뒤).",
    params: { commandId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ commandId }",
    handler: async (p) => {
      if (typeof p.commandId !== "string") return err("INVALID_PARAMS", "commandId 필요");
      const scope = scopeOf(p);
      const rec = (await data.get(COMMANDS, p.commandId, {
        scope,
      })) as CommandRecord | null;
      if (!rec) return err("TARGET_NOT_FOUND", "명령 없음");
      const order = await nextCommandOrder(data, scope);
      const { id: _drop, ...rest } = rec;
      const copy: CommandRecord = {
        ...rest,
        label: rec.label + " (복사)",
        deleted: false,
        order,
      };
      const commandId = await data.put(COMMANDS, copy, { scope });
      return ok({ commandId });
    },
  });

  reg("command.list", {
    description:
      "명령 목록(order 순). trash=true 휴지통만, favorite=true 즐겨찾기만, groupId 지정 시 해당 그룹.",
    params: {
      trash: { type: "boolean" },
      favorite: { type: "boolean" },
      groupId: { type: "string" },
      limit: { type: "number" },
      offset: { type: "number" },
      scope: { type: "string" },
    },
    returns: "{ commands }",
    handler: async (p) => {
      const commands = await listCommands(data, {
        scope: scopeOf(p),
        trash: p.trash === true,
        favorite: p.favorite === true,
        groupId: typeof p.groupId === "string" ? p.groupId : undefined,
        limit: typeof p.limit === "number" ? p.limit : undefined,
        offset: typeof p.offset === "number" ? p.offset : undefined,
      });
      return ok({ commands });
    },
  });

  reg("command.search", {
    description: "명령 CJK 전문검색(label·command). 휴지통 제외.",
    params: {
      query: { type: "string", required: true },
      limit: { type: "number" },
      scope: { type: "string" },
    },
    returns: "{ commands }",
    handler: async (p) => {
      if (typeof p.query !== "string") return err("INVALID_PARAMS", "query 필요");
      const hits = (await data.search(COMMANDS, p.query, {
        scope: scopeOf(p),
        limit: typeof p.limit === "number" ? p.limit : 100,
      })) as CommandRecord[];
      return ok({ commands: hits.filter((c) => !c.deleted) });
    },
  });

  reg("command.set-group", {
    description: "명령을 다른 그룹으로 이동.",
    params: {
      commandId: { type: "string", required: true },
      groupId: { type: "string", required: true },
      scope: { type: "string" },
    },
    returns: "{ commandId, groupId }",
    handler: async (p) => {
      if (typeof p.commandId !== "string" || typeof p.groupId !== "string")
        return err("INVALID_PARAMS", "commandId·groupId 필요");
      const scope = scopeOf(p);
      const rec = (await data.get(COMMANDS, p.commandId, {
        scope,
      })) as CommandRecord | null;
      if (!rec) return err("TARGET_NOT_FOUND", "명령 없음");
      await data.put(COMMANDS, { ...rec, groupId: p.groupId }, { scope, id: p.commandId });
      return ok({ commandId: p.commandId, groupId: p.groupId });
    },
  });

  reg("command.favorite", {
    description: "즐겨찾기 토글(있으면 해제, 없으면 설정).",
    params: { commandId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ commandId, favorite }",
    handler: async (p) => {
      if (typeof p.commandId !== "string") return err("INVALID_PARAMS", "commandId 필요");
      const scope = scopeOf(p);
      const rec = (await data.get(COMMANDS, p.commandId, {
        scope,
      })) as CommandRecord | null;
      if (!rec) return err("TARGET_NOT_FOUND", "명령 없음");
      const favorite = !rec.favorite;
      await data.put(COMMANDS, { ...rec, favorite }, { scope, id: p.commandId });
      return ok({ commandId: p.commandId, favorite });
    },
  });

  // ── 실행(run) — 링킹 + 셸/터미널 ──

  reg("command.run", {
    description:
      "런북 명령 실행. command 참조는 위상순으로 먼저 실행→출력을 다음 입력으로 되먹임(링킹). 순환=CYCLE, 미해소 참조=UNRESOLVED. script/background=셸 실행(stdout/stderr·exitCode 캡처) — secret 참조는 자식 env 주입($SOKSAK_SECRET_N, 평문은 Rust 경계에서만·history/lastOutput 엔 플레이스홀더). terminal=코어 term.exec(포커스 pane) — secret 동반 시 SECRET_PENDING(ps 노출 위험으로 미지원). 결과는 lastOutput/lastStatusCode/lastExecutedAt 갱신 + 히스토리 자동 기록.",
    params: {
      commandId: { type: "string", required: true },
      inputs: { type: "object", description: "파라미터 치환 맵({name}→값)" },
      env: { type: "object", description: "환경변수 치환 맵({{var}}→값)" },
      scope: { type: "string" },
    },
    returns:
      "{ ok, output, exitCode, historyId } | { ok:false, code:CYCLE|UNRESOLVED|SECRET_PENDING|TARGET_NOT_FOUND|NO_RUNTIME|EXEC_ERROR }",
    examples: [
      'sok plugin.soksak-plugin-runbook.command.run \'{"commandId":"abc"}\'',
      'sok plugin.soksak-plugin-runbook.command.run \'{"commandId":"abc","inputs":{"env":"prod"}}\'',
    ],
    handler: async (p) => {
      if (typeof p.commandId !== "string") return err("INVALID_PARAMS", "commandId 필요");
      const scope = scopeOf(p);
      // schedule 타입은 즉시 실행이 아니라 예약(arm) — 코어 스케줄러에 등록한다(발화 시 schedule.fire→action).
      const rec = (await data.get(COMMANDS, p.commandId, { scope })) as CommandRecord | null;
      if (!rec) return err("TARGET_NOT_FOUND", "명령 없음");
      if (rec.executionType === "schedule") {
        return await armSchedule({ execute: runtime.execute?.execute }, rec, scope, Date.now());
      }
      const inputs =
        p.inputs && typeof p.inputs === "object" && !Array.isArray(p.inputs)
          ? (p.inputs as Record<string, string>)
          : undefined;
      const env =
        p.env && typeof p.env === "object" && !Array.isArray(p.env)
          ? (p.env as Record<string, string>)
          : undefined;
      const result = await runCommand(
        {
          data,
          process: runtime.process,
          commands: runtime.execute,
          secrets: runtime.secrets,
          network: runtime.network,
        },
        { commandId: p.commandId, scope, inputs, env, secretNs: runtime.secretNs },
      );
      // RunResult 는 이미 {ok,...} 형태 — 그대로 반환(code 명시 전파 R4).
      return result;
    },
  });

  // ── schedule 발화(fire) — 코어 스케줄러가 due 시각에 호출. 사용자 직접 대상 아님(arm=command.run). ──
  reg("schedule.fire", {
    description:
      "코어 스케줄러가 due 시각에 호출 — schedule 명령의 action(command 필드, 셸)을 실행하고 다음 occurrence 를 재무장한다(반복/간격). deleted 면 발화·재무장 0. 사용자 직접 호출 대상 아님.",
    params: { commandId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ ok, output, exitCode, historyId, nextAt? } | { ok:false, code }",
    handler: async (p) => {
      if (typeof p.commandId !== "string") return err("INVALID_PARAMS", "commandId 필요");
      const scope = scopeOf(p);
      const rec = (await data.get(COMMANDS, p.commandId, { scope })) as CommandRecord | null;
      if (!rec || rec.deleted) return err("TARGET_NOT_FOUND", "명령 없음/삭제됨");
      // action 실행(executeNode schedule = 셸). 링킹·시크릿·환경은 일반 경로와 동일.
      const result = await runCommand(
        {
          data,
          process: runtime.process,
          commands: runtime.execute,
          secrets: runtime.secrets,
          network: runtime.network,
        },
        { commandId: p.commandId, scope, secretNs: runtime.secretNs },
      );
      // 다음 occurrence 재무장(반복/간격) — 실행 성공 여부와 무관(다음 주기 보장). 단발이면 미재무장.
      const armed = await armSchedule({ execute: runtime.execute?.execute }, rec, scope, Date.now());
      return armed.ok && armed.scheduled ? { ...result, nextAt: armed.nextAt } : result;
    },
  });

  // ── 그룹(group) CRUD ──

  reg("group.add", {
    description: "그룹 추가. name 필수, color(blue|red|green|orange|purple|gray) 생략 시 gray.",
    params: {
      name: { type: "string", required: true },
      color: { type: "string" },
      scope: { type: "string" },
    },
    returns: "{ groupId }",
    handler: async (p) => {
      const scope = scopeOf(p);
      const existing = (await data.query(GROUPS, {
        scope,
        order: "order",
        desc: true,
        limit: 1,
      })) as GroupRecord[];
      const order = existing.length ? (existing[0].order ?? 0) + 1 : 0;
      const rec = makeGroup(p, order);
      if (!rec) return err("INVALID_PARAMS", "name 필요");
      const groupId = await data.put(GROUPS, rec, { scope });
      return ok({ groupId });
    },
  });

  reg("group.update", {
    description: "그룹 갱신(name·color).",
    params: {
      groupId: { type: "string", required: true },
      name: { type: "string" },
      color: { type: "string" },
      scope: { type: "string" },
    },
    returns: "{ groupId }",
    handler: async (p) => {
      if (typeof p.groupId !== "string") return err("INVALID_PARAMS", "groupId 필요");
      const scope = scopeOf(p);
      const rec = (await data.get(GROUPS, p.groupId, { scope })) as GroupRecord | null;
      if (!rec) return err("TARGET_NOT_FOUND", "그룹 없음");
      const next: GroupRecord = { ...rec };
      if (typeof p.name === "string" && p.name.trim() !== "") next.name = p.name;
      const merged = makeGroup({ ...next, color: p.color ?? rec.color }, rec.order);
      if (merged) next.color = merged.color;
      await data.put(GROUPS, next, { scope, id: p.groupId });
      return ok({ groupId: p.groupId });
    },
  });

  reg("group.delete", {
    description:
      "그룹 삭제(하드). 소속 명령은 기본 그룹으로 재배치(고아 방지). 기본 그룹은 보장 후 재생성.",
    params: { groupId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ groupId, reassigned }",
    handler: async (p) => {
      if (typeof p.groupId !== "string") return err("INVALID_PARAMS", "groupId 필요");
      const scope = scopeOf(p);
      const rec = await data.get(GROUPS, p.groupId, { scope });
      if (!rec) return err("TARGET_NOT_FOUND", "그룹 없음");
      // 삭제 대상이 유일 그룹일 수 있으므로, 먼저 삭제 후 기본 그룹 보장(재생성)해 재배치 타깃 확보.
      await data.delete(GROUPS, p.groupId, { scope });
      const fallback = await ensureDefaultGroup(data, scope);
      const orphans = (await data.query(COMMANDS, {
        scope,
        where: { groupId: p.groupId },
        limit: 100000,
      })) as CommandRecord[];
      for (const c of orphans)
        await data.put(COMMANDS, { ...c, groupId: fallback }, { scope, id: c.id });
      return ok({ groupId: p.groupId, reassigned: orphans.length });
    },
  });

  reg("group.list", {
    description: "그룹 목록(order 순). 기본 그룹을 보장(없으면 생성).",
    params: { scope: { type: "string" } },
    returns: "{ groups }",
    handler: async (p) => {
      const scope = scopeOf(p);
      await ensureDefaultGroup(data, scope);
      const groups = (await data.query(GROUPS, {
        scope,
        order: "order",
        desc: false,
        limit: 1000,
      })) as GroupRecord[];
      return ok({ groups });
    },
  });

  // ── 히스토리(history) ──

  reg("history.add", {
    description:
      "실행 히스토리 1건 기록(label·command·type 필수, output·statusCode·commandId 선택). 실행기가 후속에 호출하나, 헤드리스 검증용으로도 노출.",
    params: {
      label: { type: "string", required: true },
      command: { type: "string", required: true },
      type: { type: "string", required: true },
      output: { type: "string" },
      statusCode: { type: "number" },
      commandId: { type: "string" },
      scope: { type: "string" },
    },
    returns: "{ historyId }",
    handler: async (p) => {
      if (
        typeof p.label !== "string" ||
        typeof p.command !== "string" ||
        typeof p.type !== "string"
      )
        return err("INVALID_PARAMS", "label·command·type 필요");
      const rec = makeHistory({
        label: p.label,
        command: p.command,
        type: p.type as HistoryRecord["type"],
        output: typeof p.output === "string" ? p.output : undefined,
        statusCode: typeof p.statusCode === "number" ? p.statusCode : undefined,
        commandId: typeof p.commandId === "string" ? p.commandId : undefined,
      });
      const historyId = await data.put(HISTORY, rec, { scope: scopeOf(p) });
      return ok({ historyId });
    },
  });

  reg("history.list", {
    description: "히스토리 목록(최신순). trash=true 휴지통만, type 지정 시 해당 실행타입만.",
    params: {
      trash: { type: "boolean" },
      type: { type: "string" },
      limit: { type: "number" },
      scope: { type: "string" },
    },
    returns: "{ history }",
    handler: async (p) => {
      const history = await listHistory(data, {
        scope: scopeOf(p),
        trash: p.trash === true,
        type: typeof p.type === "string" ? p.type : undefined,
        limit: typeof p.limit === "number" ? p.limit : undefined,
      });
      return ok({ history });
    },
  });

  reg("history.search", {
    description: "히스토리 CJK 전문검색(label·command·output). 휴지통 제외.",
    params: {
      query: { type: "string", required: true },
      limit: { type: "number" },
      scope: { type: "string" },
    },
    returns: "{ history }",
    handler: async (p) => {
      if (typeof p.query !== "string") return err("INVALID_PARAMS", "query 필요");
      const hits = (await data.search(HISTORY, p.query, {
        scope: scopeOf(p),
        limit: typeof p.limit === "number" ? p.limit : 100,
      })) as HistoryRecord[];
      return ok({ history: hits.filter((h) => !h.deleted) });
    },
  });

  reg("history.delete", {
    description: "히스토리 1건 휴지통으로(소프트 삭제).",
    params: { historyId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ historyId }",
    handler: async (p) => {
      if (typeof p.historyId !== "string") return err("INVALID_PARAMS", "historyId 필요");
      const scope = scopeOf(p);
      const rec = (await data.get(HISTORY, p.historyId, {
        scope,
      })) as HistoryRecord | null;
      if (!rec) return err("TARGET_NOT_FOUND", "히스토리 없음");
      await data.put(HISTORY, { ...rec, deleted: true }, { scope, id: p.historyId });
      return ok({ historyId: p.historyId });
    },
  });

  reg("history.restore", {
    description: "휴지통의 히스토리 복원.",
    params: { historyId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ historyId }",
    handler: async (p) => {
      if (typeof p.historyId !== "string") return err("INVALID_PARAMS", "historyId 필요");
      const scope = scopeOf(p);
      const rec = (await data.get(HISTORY, p.historyId, {
        scope,
      })) as HistoryRecord | null;
      if (!rec) return err("TARGET_NOT_FOUND", "히스토리 없음");
      await data.put(HISTORY, { ...rec, deleted: false }, { scope, id: p.historyId });
      return ok({ historyId: p.historyId });
    },
  });

  reg("history.clear", {
    description: "히스토리 전체 삭제(하드). trashOnly=true 면 휴지통만.",
    params: { trashOnly: { type: "boolean" }, scope: { type: "string" } },
    returns: "{ deleted }",
    handler: async (p) => {
      const scope = scopeOf(p);
      const all = (await data.query(HISTORY, { scope, limit: 100000 })) as HistoryRecord[];
      const targets = p.trashOnly === true ? all.filter((h) => h.deleted) : all;
      for (const h of targets) if (h.id) await data.delete(HISTORY, h.id, { scope });
      return ok({ deleted: targets.length });
    },
  });

  // ── export / import (JSONL 왕복) ──

  reg("export", {
    description:
      "런북 전체(그룹·명령·히스토리) JSONL 내보내기. 각 줄 = { kind, doc }. 평문 시크릿은 저장하지 않으므로 export 에도 등장하지 않는다(R2).",
    params: { scope: { type: "string" } },
    returns: "{ jsonl, counts }",
    handler: async (p) => {
      const scope = scopeOf(p);
      const groups = (await data.query(GROUPS, { scope, limit: 100000 })) as GroupRecord[];
      const commands = (await data.query(COMMANDS, {
        scope,
        limit: 100000,
      })) as CommandRecord[];
      const history = (await data.query(HISTORY, {
        scope,
        limit: 100000,
      })) as HistoryRecord[];
      const lines: string[] = [];
      for (const g of groups) lines.push(JSON.stringify({ kind: "group", doc: g }));
      for (const c of commands) lines.push(JSON.stringify({ kind: "command", doc: c }));
      for (const h of history) lines.push(JSON.stringify({ kind: "history", doc: h }));
      return ok({
        jsonl: lines.join("\n"),
        counts: { groups: groups.length, commands: commands.length, history: history.length },
      });
    },
  });

  reg("import", {
    description:
      "JSONL 가져오기(export 역). 각 줄 { kind, doc } 를 컬렉션에 put(id 보존 = 멱등 upsert).",
    params: { jsonl: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ imported }",
    handler: async (p) => {
      if (typeof p.jsonl !== "string") return err("INVALID_PARAMS", "jsonl 필요");
      const scope = scopeOf(p);
      const coll: Record<string, string> = {
        group: GROUPS,
        command: COMMANDS,
        history: HISTORY,
      };
      let imported = 0;
      for (const line of p.jsonl.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        let parsed: { kind?: string; doc?: Record<string, unknown> };
        try {
          parsed = JSON.parse(t);
        } catch {
          return err("INVALID_PARAMS", "JSONL 파싱 실패");
        }
        const c = parsed.kind ? coll[parsed.kind] : undefined;
        if (!c || !parsed.doc) continue;
        const id = typeof parsed.doc.id === "string" ? parsed.doc.id : undefined;
        await data.put(c, parsed.doc, { scope, id });
        imported++;
      }
      return ok({ imported });
    },
  });
}
