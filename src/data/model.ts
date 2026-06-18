// 런북 데이터 모델 — 컬렉션 스키마 + 순수 매퍼(I/O 0). app.data 위 CRUD 가 이 매퍼로
// 레코드를 정규화한다. 레거시 CommandBar Command(SELECT * + 컬럼 인덱스 0~29)의 현대화:
// JSON 문서 + 이름 필드만, enum 은 영문 안정키(enums.ts), 소프트삭제는 boolean `deleted`.
//
// [소프트삭제 모델] clipboard 선례를 따른다 — `deleted`(false/true) 를 인덱스 boolean 으로
// 둔다. `deletedAt`(ms|null) 은 표시·정렬 메타로만 — SQL json_extract=NULL 은 항상 거짓이라
// null 필드로는 where 필터가 안 된다(null-필터 안티패턴 금지·band-aid 금지, 구조로 해결).

import {
  BODY_TYPES,
  EXECUTION_TYPES,
  GROUP_COLORS,
  HTTP_METHODS,
  REPEAT_TYPES,
  isOneOf,
  type BodyType,
  type ExecutionType,
  type GroupColor,
  type HttpMethod,
  type RepeatType,
} from "./enums";

// ── 컬렉션 이름(단일 진실) ──
export const COMMANDS = "commands";
export const GROUPS = "groups";
export const HISTORY = "history";

// ── define 스펙(멱등). 선언 필드만 where/order 가능(DB-메뉴얼 §4). ──
export const COMMANDS_SCHEMA = {
  indexes: ["groupId", "favorite", "deleted", "executionType", "order"],
  fts: ["label", "command"],
};
export const GROUPS_SCHEMA = {
  indexes: ["order"],
  fts: [],
};
export const HISTORY_SCHEMA = {
  indexes: ["deleted", "type", "at"],
  fts: ["label", "command", "output"],
};

// ── 레코드 형태(저장 doc — 코어가 id/created/updated 를 주입) ──
// 인덱스 시그니처를 둔다 — app.data 표면은 Record<string,unknown> doc 을 받고/주므로 레코드는
// 그 구조적 부분형이어야 한다(put 인자 호환 + query 결과 캐스트). created/updated 등 코어 주입
// 필드도 이 시그니처로 흡수된다.
export interface CommandRecord {
  [k: string]: unknown;
  id?: string;
  label: string;
  command: string; // 템플릿 문자열(Reference 토큰 포함 가능)
  executionType: ExecutionType;
  terminalApp?: string;
  intervalSec?: number; // background 반복초
  scheduleAt?: number; // ms
  repeatType?: RepeatType;
  reminderSecs?: number[];
  url?: string;
  httpMethod?: HttpMethod;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  bodyType?: BodyType;
  bodyData?: string;
  fileParams?: Record<string, string>;
  groupId: string;
  favorite: boolean;
  deleted: boolean;
  order: number;
  lastOutput?: string;
  lastStatusCode?: number;
  lastExecutedAt?: number;
  // Reference 메타(command.add/update 시 src/refs.parse 로 추출 — 검증·표시용, 실행 아님).
  refs?: RefMeta[];
}

export interface GroupRecord {
  [k: string]: unknown;
  id?: string;
  name: string;
  color: GroupColor;
  order: number;
}

export interface HistoryRecord {
  [k: string]: unknown;
  id?: string;
  at: number;
  label: string;
  command: string;
  type: ExecutionType;
  output?: string;
  statusCode?: number;
  deleted: boolean;
  commandId?: string;
}

/** parse 결과를 저장형으로 줄인 Reference 메타(provider/key/jsonPath/options). */
export interface RefMeta {
  provider: string;
  key: string;
  jsonPath?: string;
  options?: string[];
}

// ── 순수 매퍼: 입력 patch → 정규화 레코드(필드 기본값·enum 검증·옵셔널 정리). ──

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const strMap = (v: unknown): Record<string, string> | undefined => {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
  }
  return out;
};
const numArr = (v: unknown): number[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is number => typeof x === "number");
  return out.length ? out : undefined;
};

/** 옵셔널 필드만 patch 에서 골라 정규화(실행타입별 부가 필드). undefined 는 제거(전체교체 안전). */
function pickOptional(p: Record<string, unknown>): Partial<CommandRecord> {
  const o: Partial<CommandRecord> = {};
  const assign = <K extends keyof CommandRecord>(
    k: K,
    v: CommandRecord[K] | undefined,
  ) => {
    if (v !== undefined) o[k] = v;
  };
  assign("terminalApp", str(p.terminalApp));
  assign("intervalSec", num(p.intervalSec));
  assign("scheduleAt", num(p.scheduleAt));
  assign(
    "repeatType",
    isOneOf(REPEAT_TYPES, p.repeatType) ? (p.repeatType as RepeatType) : undefined,
  );
  assign("reminderSecs", numArr(p.reminderSecs));
  assign("url", str(p.url));
  assign(
    "httpMethod",
    isOneOf(HTTP_METHODS, p.httpMethod) ? (p.httpMethod as HttpMethod) : undefined,
  );
  assign("headers", strMap(p.headers));
  assign("queryParams", strMap(p.queryParams));
  assign(
    "bodyType",
    isOneOf(BODY_TYPES, p.bodyType) ? (p.bodyType as BodyType) : undefined,
  );
  assign("bodyData", str(p.bodyData));
  assign("fileParams", strMap(p.fileParams));
  assign("lastOutput", str(p.lastOutput));
  assign("lastStatusCode", num(p.lastStatusCode));
  assign("lastExecutedAt", num(p.lastExecutedAt));
  return o;
}

/** 검증 실패 사유(없으면 통과). command.add 의 필수·enum 게이트. */
export function validateCommandInput(p: Record<string, unknown>): string | null {
  if (typeof p.label !== "string" || p.label.trim() === "") return "label 필요";
  if (typeof p.command !== "string") return "command(템플릿) 필요";
  if (!isOneOf(EXECUTION_TYPES, p.executionType))
    return `executionType 영문키 필요(${EXECUTION_TYPES.join("|")})`;
  return null;
}

/** 신규 command 레코드 생성(검증은 호출 전 validateCommandInput). refs 는 호출자가 주입(parse 결과). */
export function makeCommand(
  p: Record<string, unknown>,
  opts: { groupId: string; order: number; refs?: RefMeta[] },
): CommandRecord {
  return {
    label: String(p.label),
    command: String(p.command),
    executionType: p.executionType as ExecutionType,
    groupId: opts.groupId,
    favorite: p.favorite === true,
    deleted: false,
    order: opts.order,
    ...(opts.refs ? { refs: opts.refs } : {}),
    ...pickOptional(p),
  };
}

/** 기존 레코드에 patch 를 병합(put 은 전체교체 — 기존 필드 보존 후 덮어쓴다). label/command/
 *  executionType/favorite/groupId 만 patch 허용. refs 는 호출자가 재-parse 해 주입. */
export function mergeCommand(
  existing: CommandRecord,
  p: Record<string, unknown>,
  refs?: RefMeta[],
): CommandRecord {
  const next: CommandRecord = { ...existing, ...pickOptional(p) };
  if (typeof p.label === "string" && p.label.trim() !== "") next.label = p.label;
  if (typeof p.command === "string") next.command = p.command;
  if (isOneOf(EXECUTION_TYPES, p.executionType))
    next.executionType = p.executionType as ExecutionType;
  if (typeof p.favorite === "boolean") next.favorite = p.favorite;
  if (typeof p.groupId === "string") next.groupId = p.groupId;
  if (refs !== undefined) next.refs = refs;
  return next;
}

/** 그룹 신규 레코드. color 미지정/미지값은 gray 로 정규화(표시 매핑은 뷰). */
export function makeGroup(
  p: Record<string, unknown>,
  order: number,
): GroupRecord | null {
  if (typeof p.name !== "string" || p.name.trim() === "") return null;
  const color: GroupColor = isOneOf(GROUP_COLORS, p.color)
    ? (p.color as GroupColor)
    : "gray";
  return { name: p.name, color, order };
}

/** 히스토리 신규 레코드(command 실행/추가 기록). type 은 영문 enum 키. */
export function makeHistory(p: {
  label: string;
  command: string;
  type: ExecutionType;
  output?: string;
  statusCode?: number;
  commandId?: string;
}): HistoryRecord {
  const rec: HistoryRecord = {
    at: Date.now(),
    label: p.label,
    command: p.command,
    type: p.type,
    deleted: false,
  };
  if (p.output !== undefined) rec.output = p.output;
  if (p.statusCode !== undefined) rec.statusCode = p.statusCode;
  if (p.commandId !== undefined) rec.commandId = p.commandId;
  return rec;
}
