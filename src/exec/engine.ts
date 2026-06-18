// 실행 엔진 — runbook.command.run(commandId, inputs?). 링킹(command 참조 되먹임) + 타입별 실행.
//
// 흐름:
//   1. 루트 command 레코드 로드(app.data.get). 없으면 TARGET_NOT_FOUND.
//   2. planLink — 참조 닫힘의 의존 그래프 + 순환 검출. 순환이면 즉시 {ok:false,code:CYCLE}
//      (레거시 무한재귀 제거 R4).
//   3. secret 참조가 어디든 있으면 {ok:false,code:SECRET_PENDING} — 평문 주입은 Rust 경계(후속)이며
//      이번 범위는 셸/터미널만(R2 평문 미노출).
//   4. 링킹 실행: 위상순으로 참조 command 를 먼저 실행(각 1회 — outcome 맵 캐시, 중복 0) → 그 출력을
//      context.command 에 모음 → 다음 명령 resolve 가 그 context 로 치환. 즉 한 출력이 다음 입력으로 되먹임.
//   5. 루트 resolve — 미해소 참조는 {ok:false,code:UNRESOLVED, unresolved}(미치환 토큰이 셸로 새지 않게).
//   6. 타입별 실행: script/background = runShell(셸 -c), terminal = term.exec 코어 명령.
//   7. 결과를 레코드에 lastOutput/lastStatusCode/lastExecutedAt 갱신(put) + history.add 연동.

import { COMMANDS, HISTORY, makeHistory, type CommandRecord } from "../data/model";
import type { DataApi } from "../data/store";
import { parse, resolve, type ResolveContext } from "../refs/index";
import { planLink } from "./link";
import { runShell, type ProcessApi } from "./spawn";

/** term.exec 등 코어 명령 실행 표면(app.commands.execute). terminal 실행 경로용. */
export interface ExecuteApi {
  execute: (
    name: string,
    params?: Record<string, unknown>,
  ) => Promise<{ ok: boolean; code?: string; message?: string; [k: string]: unknown }>;
}

export interface RunDeps {
  data: DataApi;
  process?: ProcessApi;
  commands?: ExecuteApi;
}

export interface RunInput {
  commandId: string;
  scope?: string;
  /** 사용자 입력 파라미터({name} 치환). */
  inputs?: Record<string, string>;
  /** 환경변수 맵({{var}} 치환). 미지정 시 빈 맵(미정의는 LinkError). */
  env?: Record<string, string>;
}

export type RunResult =
  | { ok: true; output: string; exitCode: number; historyId?: string }
  | { ok: false; code: "TARGET_NOT_FOUND"; message: string }
  | { ok: false; code: "CYCLE"; cycle: string[] }
  | { ok: false; code: "UNRESOLVED"; unresolved: string[] }
  | { ok: false; code: "SECRET_PENDING"; message: string }
  | { ok: false; code: "NO_RUNTIME"; message: string }
  | { ok: false; code: "EXEC_ERROR"; message: string };

/** 템플릿에 secret 참조가 하나라도 있는가(평문 주입 후속 범위 — 이번엔 명시 거부). 순수. */
function hasSecretRef(template: string): boolean {
  return parse(template).refs.some((r) => r.provider === "secret");
}

/** 한 command 를 resolve 용 context 로 푼다. 미해소 참조의 raw 토큰 목록도 함께(UNRESOLVED 보고용). */
function resolveTemplate(
  template: string,
  ctx: ResolveContext,
): { text: string; unresolved: string[] } {
  const r = resolve(parse(template), ctx);
  return { text: r.text, unresolved: r.errors.map((e) => e.ref.raw) };
}

/** 실행 엔진 단일 진입(R8). 링킹 → resolve → 타입별 실행 → 결과 되먹임. */
export async function runCommand(
  deps: RunDeps,
  input: RunInput,
): Promise<RunResult> {
  const { data } = deps;
  const scope = input.scope;

  // 1. 루트 레코드.
  const root = (await data.get(COMMANDS, input.commandId, { scope })) as CommandRecord | null;
  if (!root) return { ok: false, code: "TARGET_NOT_FOUND", message: "명령 없음" };

  // 본문 로더 — 참조 command 의 템플릿을 동기적으로 줘야 planLink 가 순수하게 돈다. 닫힘을 먼저
  // 비동기로 적재한 뒤 맵에서 꺼낸다(2-pass): pass1 = 참조 id 수집·레코드 적재, pass2 = 순수 plan.
  const templates = new Map<string, string>([[input.commandId, root.command]]);
  const records = new Map<string, CommandRecord>([[input.commandId, root]]);
  // 참조 닫힘 적재(BFS — 중복 로드 0).
  const seen = new Set<string>([input.commandId]);
  const queue: string[] = [input.commandId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const tmpl = templates.get(id);
    if (tmpl == null) continue;
    for (const r of parse(tmpl).refs) {
      if (r.provider !== "command" || seen.has(r.key)) continue;
      seen.add(r.key);
      const rec = (await data.get(COMMANDS, r.key, { scope })) as CommandRecord | null;
      if (!rec) continue; // 미정의 — planLink 의 missing → resolve LinkError
      templates.set(r.key, rec.command);
      records.set(r.key, rec);
      queue.push(r.key);
    }
  }

  // 2. 링킹 계획(순수) — 순환 검출.
  const linked = planLink(input.commandId, root.command, (id) => templates.get(id) ?? null);
  if (!linked.ok) return { ok: false, code: "CYCLE", cycle: linked.cycle };
  const plan = linked.plan;

  // 3. secret 게이트 — 닫힘 내 어떤 템플릿이든 secret 참조면 명시 거부(후속 범위).
  for (const tmpl of templates.values()) {
    if (hasSecretRef(tmpl)) {
      return {
        ok: false,
        code: "SECRET_PENDING",
        message: "secret 참조 — 평문 주입은 후속(Rust 경계). 이번 범위는 셸/터미널 실행만.",
      };
    }
  }

  // 4. 링킹 실행 — 위상순으로 참조 command 출력을 모은다(루트 제외, 각 1회). 셸 실행이 필요하므로
  //    process 표면이 없으면 NO_RUNTIME. 모은 출력은 context.command[id] = stdout(jsonPath 추출 대상).
  const commandCtx: Record<string, unknown> = {};
  const baseCtx = (): ResolveContext => ({
    param: input.inputs ?? {},
    env: input.env ?? {},
    command: commandCtx,
  });

  const proc = deps.process;
  for (const id of plan.order) {
    if (id === input.commandId) continue; // 루트는 마지막에 타입별 실행
    const tmpl = templates.get(id);
    if (tmpl == null) continue;
    const { text, unresolved } = resolveTemplate(tmpl, baseCtx());
    if (unresolved.length > 0) {
      return { ok: false, code: "UNRESOLVED", unresolved };
    }
    if (!proc) {
      return { ok: false, code: "NO_RUNTIME", message: "process 권한/표면 없음 — 셸 실행 불가" };
    }
    let out: string;
    try {
      const r = await runShell(proc, text);
      out = r.stdout;
    } catch (e) {
      return { ok: false, code: "EXEC_ERROR", message: e instanceof Error ? e.message : String(e) };
    }
    // 되먹임 — 출력이 JSON 이면 객체로(jsonPath 추출 가능), 아니면 트림 문자열. 한 번만 파싱(단일 지점).
    commandCtx[id] = coerceOutput(out);
  }

  // 5. 루트 resolve — 미해소면 UNRESOLVED.
  const rootResolved = resolveTemplate(root.command, baseCtx());
  if (rootResolved.unresolved.length > 0) {
    return { ok: false, code: "UNRESOLVED", unresolved: rootResolved.unresolved };
  }
  const finalCmd = rootResolved.text;

  // 6. 타입별 실행.
  const type = root.executionType;
  if (type === "terminal") {
    const cmds = deps.commands;
    if (!cmds) return { ok: false, code: "NO_RUNTIME", message: "commands 표면 없음 — 터미널 실행 불가" };
    // 코어 term.exec(danger:inject) — 포커스 pane 에서 명령+Enter. 인터랙티브(출력 캡처 없음).
    const r = await cmds.execute("term.exec", { cmd: finalCmd });
    if (!r.ok) {
      return { ok: false, code: "EXEC_ERROR", message: r.message ?? `term.exec 실패: ${r.code ?? ""}` };
    }
    const output = `터미널 실행: ${finalCmd}`;
    const historyId = await record(data, root, type, output, undefined, scope);
    return { ok: true, output, exitCode: 0, historyId };
  }

  // script / background / (schedule·api 는 후속 — 여기선 셸로 처리하지 않음).
  if (type !== "script" && type !== "background") {
    return {
      ok: false,
      code: "NO_RUNTIME",
      message: `실행타입 ${type} 은 후속 범위(이번: script·background·terminal).`,
    };
  }
  if (!proc) return { ok: false, code: "NO_RUNTIME", message: "process 권한/표면 없음 — 셸 실행 불가" };

  let shell;
  try {
    shell = await runShell(proc, finalCmd);
  } catch (e) {
    return { ok: false, code: "EXEC_ERROR", message: e instanceof Error ? e.message : String(e) };
  }
  // 7. 결과 되먹임 — 레코드 갱신 + 히스토리.
  const historyId = await record(data, root, type, shell.output, shell.exitCode, scope);
  return { ok: true, output: shell.output, exitCode: shell.exitCode, historyId };
}

/** 출력을 되먹임 값으로 강제 — JSON 파싱 성공 시 객체/배열, 실패 시 트림 문자열. 단일 지점. */
function coerceOutput(out: string): unknown {
  const t = out.trim();
  if (t === "") return "";
  if (t[0] === "{" || t[0] === "[") {
    try {
      return JSON.parse(t);
    } catch {
      /* JSON 아님 — 문자열로 */
    }
  }
  return t;
}

/** 실행 결과를 command 레코드(lastOutput/lastStatusCode/lastExecutedAt)에 갱신 + history.add 연동.
 *  단일 지점(R8) — 모든 실행 경로가 이 함수로 흔적을 남긴다. */
async function record(
  data: DataApi,
  root: CommandRecord,
  type: CommandRecord["executionType"],
  output: string,
  exitCode: number | undefined,
  scope?: string,
): Promise<string> {
  const now = Date.now();
  const next: CommandRecord = {
    ...root,
    lastOutput: output,
    lastExecutedAt: now,
  };
  if (exitCode !== undefined) next.lastStatusCode = exitCode;
  await data.put(COMMANDS, next, { scope, id: root.id });

  const hist = makeHistory({
    label: root.label,
    command: root.command,
    type,
    output,
    statusCode: exitCode,
    commandId: typeof root.id === "string" ? root.id : undefined,
  });
  return data.put(HISTORY, hist, { scope });
}
