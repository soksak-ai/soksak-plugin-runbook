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
import { parse, resolve, type ResolveContext, type SecretHandle } from "../refs/index";
import { planLink } from "./link";
import { runShell, type ProcessApi } from "./spawn";

/** secret 핸들 목록 → env 플레이스홀더 치환 + secretEnv 맵. 평문 0 — 키 이름만 흐른다(R2).
 *  resolve 가 텍스트에 남긴 인라인 마커(" secret:<key> ")를 $SOKSAK_SECRET_<i> 로 바꾸고,
 *  {SOKSAK_SECRET_<i>: key} 를 누적한다. 같은 key 는 같은 env 로 재사용(중복 주입 0). 순수. */
export function applySecretEnv(
  text: string,
  handles: SecretHandle[],
): { text: string; secretEnv: Record<string, string> } {
  const secretEnv: Record<string, string> = {};
  const envForKey = new Map<string, string>();
  let next = text;
  for (const h of handles) {
    let envVar = envForKey.get(h.key);
    if (!envVar) {
      envVar = `SOKSAK_SECRET_${envForKey.size}`;
      envForKey.set(h.key, envVar);
      secretEnv[envVar] = h.key;
    }
    // resolve 의 NUL 감싼 인라인 마커(\0secret:<key>\0)를 $envVar 로 치환(첫 출현만 — 핸들 1:1).
    // NUL 래핑이라 사용자 텍스트와 충돌 0. 평문은 들어가지 않는다 — env 참조만.
    const marker = `\0secret:${h.key}\0`;
    next = next.replace(marker, `$${envVar}`);
  }
  return { text: next, secretEnv };
}

/** term.exec 등 코어 명령 실행 표면(app.commands.execute). terminal 실행 경로용. */
export interface ExecuteApi {
  execute: (
    name: string,
    params?: Record<string, unknown>,
  ) => Promise<{ ok: boolean; code?: string; message?: string; [k: string]: unknown }>;
}

/** secret 가용성 프로브 — 해당 ns(이 플러그인)에 key 가 실제로 있고 볼트가 언락됐는지(boolean).
 *  평문 0 — has 는 존재 여부만 반환한다(R2). app.secrets.has 가 그대로 들어온다. 볼트 잠김이면 reject. */
export interface SecretsProbe {
  has: (key: string) => Promise<boolean>;
}

export interface RunDeps {
  data: DataApi;
  process?: ProcessApi;
  commands?: ExecuteApi;
  /** 미주입(권한 없음) + secret 참조면 SECRET_PENDING. 셸 실행 전 가용성 게이트에만 쓴다. */
  secrets?: SecretsProbe;
}

export interface RunInput {
  commandId: string;
  scope?: string;
  /** 사용자 입력 파라미터({name} 치환). */
  inputs?: Record<string, string>;
  /** 환경변수 맵({{var}} 치환). 미지정 시 빈 맵(미정의는 LinkError). */
  env?: Record<string, string>;
  /** 시크릿 네임스페이스(보통 이 플러그인 id). secret 참조 해소 시 핸들 ns 가 된다 — 평문 아님.
   *  미지정이면 secret 참조는 resolve 단계에서 미해소(UNRESOLVED). */
  secretNs?: string;
}

export type RunResult =
  | { ok: true; output: string; exitCode: number; historyId?: string }
  | { ok: false; code: "TARGET_NOT_FOUND"; message: string }
  | { ok: false; code: "CYCLE"; cycle: string[] }
  | { ok: false; code: "UNRESOLVED"; unresolved: string[] }
  | { ok: false; code: "SECRET_PENDING"; message: string }
  | { ok: false; code: "NO_RUNTIME"; message: string }
  | { ok: false; code: "EXEC_ERROR"; message: string };

/** 템플릿에 secret 참조가 하나라도 있는가. terminal 실행은 secret 미지원(ps 노출 위험) — 거부 게이트. */
function hasSecretRef(template: string): boolean {
  return parse(template).refs.some((r) => r.provider === "secret");
}

/** 한 command 를 resolve 용 context 로 푼다. 미해소 참조의 raw 토큰 목록 + secret 핸들도 함께.
 *  text 에는 secret 평문이 아니라 인라인 마커만(R2) — 호출자가 applySecretEnv 로 env 치환한다. */
function resolveTemplate(
  template: string,
  ctx: ResolveContext,
): { text: string; unresolved: string[]; handles: SecretHandle[] } {
  const r = resolve(parse(template), ctx);
  return {
    text: r.text,
    unresolved: r.errors.map((e) => e.ref.raw),
    handles: r.handles,
  };
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

  // 3. secret 게이트 — terminal 실행은 secret 미지원(term.exec 가 셸에 raw 명령을 타이핑 → ps/스크롤백
  //    노출 위험). 루트가 terminal 이고 닫힘 어디든 secret 참조면 SECRET_PENDING. script/background 는
  //    자식 env 주입(Rust 경계)이라 평문 노출 없음 → 허용(아래에서 secretEnv 로 실행).
  const type = root.executionType;
  if (type === "terminal") {
    for (const tmpl of templates.values()) {
      if (hasSecretRef(tmpl)) {
        return {
          ok: false,
          code: "SECRET_PENDING",
          message: "terminal+secret 미지원(ps 노출 위험) — script/background 로 실행하세요.",
        };
      }
    }
  }

  // 3b. secret 가용성 게이트(script/background) — 자식 env 주입을 시도하기 전에, 참조된 모든 secret 이
  //     볼트에 실제로 있는지(언락+존재) 확인한다. 하나라도 미가용(미설정 또는 볼트 잠김)이면 SECRET_PENDING —
  //     "set/unlock 먼저" 를 명시한다(Rust 경계의 미가용 실패를 generic EXEC_ERROR 로 뭉뚱그리지 않음). secretNs
  //     미설정이면 secret 참조는 resolve 단계에서 UNRESOLVED 로 처리되므로 여기선 건드리지 않는다. has 는 boolean
  //     만 반환 → 평문 0(R2). 프로브가 throw(볼트 잠김)면 미가용으로 본다.
  if ((type === "script" || type === "background") && input.secretNs) {
    const secretKeys = new Set<string>();
    for (const tmpl of templates.values()) {
      for (const r of parse(tmpl).refs) {
        if (r.provider === "secret") secretKeys.add(r.key);
      }
    }
    if (secretKeys.size > 0) {
      const probe = deps.secrets;
      if (!probe) {
        return {
          ok: false,
          code: "SECRET_PENDING",
          message: `secret 참조(${[...secretKeys].join(", ")}) — secrets 표면 없음(권한/언락 필요).`,
        };
      }
      const pending: string[] = [];
      for (const key of secretKeys) {
        let present = false;
        try {
          present = await probe.has(key);
        } catch {
          present = false; // 볼트 잠김 등 — 미가용으로 취급.
        }
        if (!present) pending.push(key);
      }
      if (pending.length > 0) {
        return {
          ok: false,
          code: "SECRET_PENDING",
          message: `secret 미가용: ${pending.join(", ")} — secret.set/secret.unlock 먼저.`,
        };
      }
    }
  }

  // 4. 링킹 실행 — 위상순으로 참조 command 출력을 모은다(루트 제외, 각 1회). 셸 실행이 필요하므로
  //    process 표면이 없으면 NO_RUNTIME. 모은 출력은 context.command[id] = stdout(jsonPath 추출 대상).
  //    secret 참조는 인라인 마커로 resolve → applySecretEnv 로 $SOKSAK_SECRET_N + secretEnv 맵 치환.
  const commandCtx: Record<string, unknown> = {};
  const baseCtx = (): ResolveContext => ({
    param: input.inputs ?? {},
    env: input.env ?? {},
    command: commandCtx,
    secretNs: input.secretNs,
  });

  const proc = deps.process;
  for (const id of plan.order) {
    if (id === input.commandId) continue; // 루트는 마지막에 타입별 실행
    const tmpl = templates.get(id);
    if (tmpl == null) continue;
    const { text, unresolved, handles } = resolveTemplate(tmpl, baseCtx());
    if (unresolved.length > 0) {
      return { ok: false, code: "UNRESOLVED", unresolved };
    }
    if (!proc) {
      return { ok: false, code: "NO_RUNTIME", message: "process 권한/표면 없음 — 셸 실행 불가" };
    }
    // secret 핸들 → env 플레이스홀더 + secretEnv 맵(평문 0 — Rust 경계가 주입).
    const sub = applySecretEnv(text, handles);
    let out: string;
    try {
      const r = await runShell(proc, sub.text, { secretEnv: sub.secretEnv });
      out = r.stdout;
    } catch (e) {
      return { ok: false, code: "EXEC_ERROR", message: e instanceof Error ? e.message : String(e) };
    }
    // 되먹임 — 출력이 JSON 이면 객체로(jsonPath 추출 가능), 아니면 트림 문자열. 한 번만 파싱(단일 지점).
    commandCtx[id] = coerceOutput(out);
  }

  // 5. 루트 resolve — 미해소면 UNRESOLVED. secret 은 인라인 마커(평문 0) → applySecretEnv 로 env 치환.
  const rootResolved = resolveTemplate(root.command, baseCtx());
  if (rootResolved.unresolved.length > 0) {
    return { ok: false, code: "UNRESOLVED", unresolved: rootResolved.unresolved };
  }
  // finalCmd 에는 평문 시크릿이 절대 없다 — $SOKSAK_SECRET_N 플레이스홀더만(lastOutput·history 도 동일).
  const rootSub = applySecretEnv(rootResolved.text, rootResolved.handles);
  const finalCmd = rootSub.text;
  const rootSecretEnv = rootSub.secretEnv;

  // 6. 타입별 실행.
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
    // 평문 시크릿은 secretEnv 키 이름만 넘어가고 Rust 경계가 자식 env 로 주입($SOKSAK_SECRET_N 가 셸에서 확장).
    shell = await runShell(proc, finalCmd, { secretEnv: rootSecretEnv });
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
