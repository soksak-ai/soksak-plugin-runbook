// 인라인 배지 에디터의 순수 로직(I/O 0) — 토큰↔배지 직렬화·트리거 감지·후보 필터.
//
// [단일 파서 재사용 R8] 저장형 토큰 문자열의 해석은 항상 src/refs parse 를 탄다 — 정규식·해석
// 규칙을 여기서 재발명하지 않는다(중복 0). 이 모듈은 그 parse 결과를 "배지 모델"로 투영하고,
// 거꾸로 배지 모델을 저장형 토큰 문자열로 되돌린다(왕복 항등).
//
// [저장형 토큰 형식(patterns.ts 의 단일 진실)]
//   {name}            param(자유)
//   {name:a|b}        param(옵션)
//   {{var}}           env
//   `secret@key`      secret(백틱 배지)
//   `command@id|path` command(jsonPath 체이닝)
//   `clipboard@id`    clipboard
//   `var@id|path`     var
//
// [표시 idiom] 배지 라벨 = "<type>#<label>" (예: secret#token, command#fetch). 색은 type 으로 결정.
// 시크릿은 라벨만 표시한다 — value 를 보유하지 않는다(secretRef 키 핸들만, R2). param/env 도 key 만.

import { parse } from "../refs/index";
import type { Reference, RefProvider } from "../refs/types";

/** 에디터가 다루는 토큰 종류(저장형 provider 와 동기). param/env 는 인라인 텍스트가 아니라
 *  배지로도 보일 수 있으나(현대적 이식), 직렬화는 항상 저장형 문자열로 되돌린다. */
export type BadgeProvider = RefProvider;

/** 배지 모델 — DOM span 에 1:1 대응. raw 는 저장형 원문(왕복의 단일 진실). */
export interface BadgeToken {
  provider: BadgeProvider;
  key: string;
  jsonPath?: string;
  options?: string[];
  /** 저장형 원문 토큰(예: "`secret@token`", "{env:dev|prod}", "{{HOME}}"). */
  raw: string;
}

/** 에디터 콘텐츠의 평탄 세그먼트 — 순수 텍스트 또는 배지. DOM 직렬화/역직렬화의 중간 표현. */
export type Segment =
  | { kind: "text"; value: string }
  | { kind: "badge"; token: BadgeToken };

/** type → 색 토큰(앱 토큰만 — 하드코딩 색 0). secret=핑크, command=파랑, var=초록,
 *  param=주황, env/clipboard=중립. 색은 var(--rb-badge-*) CSS 변수로 매핑(view 가 정의). */
export const BADGE_TYPE_CLASS: Record<BadgeProvider, string> = {
  secret: "secret",
  command: "command",
  var: "var",
  param: "param",
  env: "env",
  clipboard: "clipboard",
};

/** 배지 표시 라벨 = "<type>#<key>". 시크릿도 key 만(평문 미보유 — R2). jsonPath 가 있으면 "·path" 부기. */
export function badgeLabel(t: BadgeToken): string {
  const base = `${t.provider}#${t.key}`;
  return t.jsonPath ? `${base}·${t.jsonPath}` : base;
}

/** Reference → 저장형 원문 토큰 문자열로 직렬화(단일 진실). raw 가 있으면 그대로 신뢰(parse 산출).
 *  raw 가 없으면(후보 선택으로 새로 만든 배지) provider 별 규약으로 합성한다. */
export function tokenToRaw(t: {
  provider: BadgeProvider;
  key: string;
  jsonPath?: string;
  options?: string[];
}): string {
  switch (t.provider) {
    case "param": {
      const opts = t.options && t.options.length > 0 ? `:${t.options.join("|")}` : "";
      return `{${t.key}${opts}}`;
    }
    case "env":
      return `{{${t.key}}}`;
    case "secret":
    case "command":
    case "clipboard":
    case "var": {
      const path = t.jsonPath ? `|${t.jsonPath}` : "";
      return `\`${t.provider}@${t.key}${path}\``;
    }
    default:
      return "";
  }
}

/** Reference → BadgeToken(raw 보존). parse 산출 Reference 의 raw 는 원문 그대로다. */
function refToToken(ref: Reference): BadgeToken {
  const t: BadgeToken = { provider: ref.provider, key: ref.key, raw: ref.raw };
  if (ref.jsonPath !== undefined) t.jsonPath = ref.jsonPath;
  if (ref.options !== undefined) t.options = ref.options;
  return t;
}

/** 저장형 토큰 문자열 → 세그먼트 시퀀스(역직렬화). 단일 파서(parse) 재사용 — 텍스트 조각은 그대로,
 *  ref 노드는 배지로 투영한다. 이게 "저장형 → 배지 span" 의 단일 경로다. */
export function deserialize(template: string): Segment[] {
  const { nodes } = parse(template);
  const segs: Segment[] = [];
  for (const n of nodes) {
    if (n.kind === "text") segs.push({ kind: "text", value: n.value });
    else segs.push({ kind: "badge", token: refToToken(n.ref) });
  }
  return segs;
}

/** 세그먼트 시퀀스 → 저장형 토큰 문자열(직렬화). 배지는 raw(있으면) 또는 합성, 텍스트는 그대로.
 *  deserialize 와 왕복 항등이어야 한다(badge.test 가 강제). */
export function serialize(segs: Segment[]): string {
  let out = "";
  for (const s of segs) {
    if (s.kind === "text") out += s.value;
    else out += s.token.raw || tokenToRaw(s.token);
  }
  return out;
}

/** 편의: 저장형 문자열 → 토큰 배열(텍스트 제외). 헤드리스 검증용(runbook.editor.tokens). */
export function tokensOf(template: string): BadgeToken[] {
  return deserialize(template)
    .filter((s): s is { kind: "badge"; token: BadgeToken } => s.kind === "badge")
    .map((s) => s.token);
}

// ── 자동완성 트리거 감지(순수) ──────────────────────────────────────────────
//
// 캐럿 앞 텍스트(좌측 문맥)만 본다. 미완성 토큰의 시작을 감지해 종류·쿼리·치환구간을 낸다.
// 트리거 종류와 그 여는 시퀀스(patterns.ts 의 토큰 여는 형태와 동기):
//   "{{"      → env      (쿼리 = 변수명 prefix)
//   "`secret@"→ secret
//   "`command@"→ command
//   "`clipboard@"→ clipboard
//   "`var@"   → var
//   "{"       → param    (단, "{{" 가 아닐 때만; 콜론 전까지가 key)
//
// 완성된 토큰(닫는 } 또는 닫는 백틱)을 지나면 트리거가 아니다 — 여는 구간이 아직 열려 있을 때만.

/** 트리거 감지 결과. start = 여는 시퀀스의 시작 인덱스(치환 시 여기부터 캐럿까지를 배지로 교체). */
export interface Trigger {
  provider: BadgeProvider;
  /** 사용자가 친 부분 키(필터 쿼리). */
  query: string;
  /** 좌측 문맥에서 여는 시퀀스가 시작된 인덱스(치환 구간의 좌단). */
  start: number;
}

/** 백틱 배지 여는 시퀀스 — provider 화이트리스트와 동기. 가장 구체적(긴) 것부터. */
const BADGE_OPENERS: { provider: BadgeProvider; open: string }[] = [
  { provider: "clipboard", open: "`clipboard@" },
  { provider: "command", open: "`command@" },
  { provider: "secret", open: "`secret@" },
  { provider: "var", open: "`var@" },
];

/** 캐럿 앞 텍스트에서 미완성 토큰 트리거를 감지. 없으면 null. 순수. */
export function detectTrigger(before: string): Trigger | null {
  // 1) 백틱 배지: 마지막 여는 백틱 이후에 닫는 백틱이 없어야 "열림". provider@ 까지 입력됐는지 확인.
  const lastTick = before.lastIndexOf("`");
  if (lastTick >= 0 && before.indexOf("`", lastTick + 1) === -1) {
    const tail = before.slice(lastTick); // "`secret@ap" 같은 미완성
    for (const { provider, open } of BADGE_OPENERS) {
      if (tail.startsWith(open)) {
        const query = tail.slice(open.length);
        // 키 문자만 허용(공백·백틱 들어오면 트리거 종료).
        if (/^[A-Za-z0-9_.\-:/]*$/.test(query)) {
          return { provider, query, start: lastTick };
        }
      }
    }
    // 백틱은 열렸지만 아직 provider@ 미완성(예: "`sec") — provider 미확정이라 트리거 아님.
  }

  // 2) env "{{var": 마지막 "{{" 이후 닫힘(}})이 없어야 열림.
  const lastEnv = before.lastIndexOf("{{");
  if (lastEnv >= 0 && before.indexOf("}}", lastEnv + 2) === -1) {
    const query = before.slice(lastEnv + 2);
    if (/^[A-Za-z0-9_.\-\s]*$/.test(query)) {
      return { provider: "env", query: query.trim(), start: lastEnv };
    }
  }

  // 3) param "{name": 마지막 단일 "{"(바로 앞이 "{" 가 아닌 — {{ 제외) 이후 닫힘 } 이 없어야 열림.
  for (let i = before.length - 1; i >= 0; i--) {
    if (before[i] !== "{") continue;
    if (before[i - 1] === "{" || before[i + 1] === "{") break; // {{ 는 env 가 처리 — param 아님
    if (before.indexOf("}", i + 1) !== -1) break; // 이미 닫힘
    const query = before.slice(i + 1);
    // param key 부분(콜론 전까지). 콜론 이후(옵션)는 자동완성 대상 아님.
    if (query.includes(":")) return null;
    if (/^[A-Za-z0-9_.-]*$/.test(query)) {
      return { provider: "param", query, start: i };
    }
    break;
  }

  return null;
}

// ── 후보 필터(순수) ────────────────────────────────────────────────────────

/** 후보 목록을 query 로 필터. 대소문자 무시 부분일치, prefix 일치를 앞으로 정렬(안정). 순수. */
export function filterCandidates(candidates: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q === "") return candidates.slice();
  const matched = candidates.filter((c) => c.toLowerCase().includes(q));
  return matched.sort((a, b) => {
    const ap = a.toLowerCase().startsWith(q) ? 0 : 1;
    const bp = b.toLowerCase().startsWith(q) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.localeCompare(b);
  });
}
