// 런북 store — app.data 위 CRUD 래퍼(순수 매퍼는 model.ts). raw SQL 0(R1) — define/put/
// get/query/search/count/delete/watch 표면만 쓴다. 기본 그룹 보장도 여기 단일 지점(R8).

import { parse } from "../refs/index";
import {
  COMMANDS,
  COMMANDS_SCHEMA,
  GROUPS,
  GROUPS_SCHEMA,
  HISTORY,
  HISTORY_SCHEMA,
  type CommandRecord,
  type GroupRecord,
  type HistoryRecord,
  type RefMeta,
} from "./model";

/** app.data 표면(필요한 메서드만). 코어가 ns=pluginId 를 주입한다(격리). */
export interface DataApi {
  define: (
    coll: string,
    opts: { indexes?: string[]; fts?: string[] },
  ) => Promise<void>;
  put: (
    coll: string,
    doc: Record<string, unknown>,
    opts?: { id?: string; scope?: string },
  ) => Promise<string>;
  get: (
    coll: string,
    id: string,
    opts?: { scope?: string },
  ) => Promise<Record<string, unknown> | null>;
  query: (
    coll: string,
    opts: Record<string, unknown>,
  ) => Promise<Record<string, unknown>[]>;
  search: (
    coll: string,
    q: string,
    opts?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>[]>;
  count: (coll: string, opts?: Record<string, unknown>) => Promise<number>;
  delete: (coll: string, id: string, opts?: { scope?: string }) => Promise<boolean>;
  watch: (
    coll: string,
    opts: { scope?: string } | undefined,
    cb: (e: unknown) => void,
  ) => { dispose: () => void };
}

/** 컬렉션 3종 define(멱등). 1회 호출(activate). */
export async function defineCollections(data: DataApi): Promise<void> {
  await data.define(COMMANDS, COMMANDS_SCHEMA);
  await data.define(GROUPS, GROUPS_SCHEMA);
  await data.define(HISTORY, HISTORY_SCHEMA);
}

/** 템플릿에서 Reference 메타를 추출(parse — 순수). 실행 아님(검증·표시용 저장). */
export function extractRefs(template: string): RefMeta[] {
  const { refs } = parse(template);
  return refs.map((r) => {
    const m: RefMeta = { provider: r.provider, key: r.key };
    if (r.jsonPath !== undefined) m.jsonPath = r.jsonPath;
    if (r.options !== undefined) m.options = r.options;
    return m;
  });
}

/** 기본 그룹 보장 — 없으면 생성하고 그 id 를 반환(단일 지점, 멱등). scope 별로 보장한다. */
export async function ensureDefaultGroup(
  data: DataApi,
  scope?: string,
): Promise<string> {
  const groups = (await data.query(GROUPS, {
    scope,
    order: "order",
    limit: 1,
    offset: 0,
  })) as GroupRecord[];
  if (groups.length > 0 && typeof groups[0].id === "string") return groups[0].id;
  return data.put(
    GROUPS,
    { name: "기본", color: "gray", order: 0 },
    { scope },
  );
}

/** command 목록(비휴지통 기본). trash/favorite/groupId 필터, order 정렬. */
export async function listCommands(
  data: DataApi,
  f: {
    scope?: string;
    trash?: boolean;
    favorite?: boolean;
    groupId?: string;
    limit?: number;
    offset?: number;
  },
): Promise<CommandRecord[]> {
  const where: Record<string, unknown> = { deleted: f.trash === true };
  if (f.favorite === true) where.favorite = true;
  if (typeof f.groupId === "string") where.groupId = f.groupId;
  return (await data.query(COMMANDS, {
    scope: f.scope,
    where,
    order: "order",
    desc: false,
    limit: f.limit ?? 500,
    offset: f.offset,
  })) as CommandRecord[];
}

/** 다음 order 값(현재 비휴지통 최대 + 1). 정렬 안정용 단일 지점. */
export async function nextCommandOrder(
  data: DataApi,
  scope?: string,
): Promise<number> {
  const rows = (await data.query(COMMANDS, {
    scope,
    where: { deleted: false },
    order: "order",
    desc: true,
    limit: 1,
  })) as CommandRecord[];
  return rows.length ? (rows[0].order ?? 0) + 1 : 0;
}

/** 히스토리 목록(비휴지통 기본, 최신순). */
export async function listHistory(
  data: DataApi,
  f: { scope?: string; trash?: boolean; type?: string; limit?: number },
): Promise<HistoryRecord[]> {
  const where: Record<string, unknown> = { deleted: f.trash === true };
  if (typeof f.type === "string") where.type = f.type;
  return (await data.query(HISTORY, {
    scope: f.scope,
    where,
    order: "at",
    desc: true,
    limit: f.limit ?? 200,
  })) as HistoryRecord[];
}
