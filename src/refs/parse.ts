// parse — 순수(템플릿 → 노드/Reference). 토큰 해석과 실행을 분리(R4): parse 는 해석 계획만 낸다.
//
// 한 패스로 모든 토큰 종류를 위치순으로 스캔한다. 단일 상수 정규식(patterns.ts)만 사용한다.

import { BADGE_RE, ENV_RE, PARAM_RE } from "./patterns";
import type { Node, Parsed, Reference } from "./types";

interface Hit {
  start: number;
  end: number;
  ref: Reference;
}

/** 한 정규식으로 전 매치를 모아 Hit 로 — provider/key/jsonPath/options 추출은 콜백에 위임. */
function scan(
  template: string,
  re: RegExp,
  toRef: (m: RegExpExecArray) => Reference,
): Hit[] {
  const hits: Hit[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    hits.push({ start: m.index, end: m.index + m[0].length, ref: toRef(m) });
  }
  return hits;
}

/** 템플릿을 파싱해 노드 시퀀스와 평탄화된 Reference 목록을 반환. 순수. */
export function parse(template: string): Parsed {
  const hits: Hit[] = [];

  // {{var}} — 환경변수. PARAM_RE 보다 먼저 모으되 위치로 최종 정렬하므로 순서 무관.
  hits.push(
    ...scan(template, ENV_RE, (m) => ({
      provider: "env",
      key: m[1],
      raw: m[0],
    })),
  );

  // `provider@key|path` — 저장형 배지.
  hits.push(
    ...scan(template, BADGE_RE, (m) => {
      const provider = m[1] as Reference["provider"];
      const ref: Reference = { provider, key: m[2], raw: m[0] };
      if (m[3] !== undefined && m[3] !== "") ref.jsonPath = m[3];
      return ref;
    }),
  );

  // {name} / {name:a|b} — 파라미터. {{...}} 가 먼저 잡힌 구간은 겹침 제거에서 걸러진다.
  hits.push(
    ...scan(template, PARAM_RE, (m) => {
      const ref: Reference = { provider: "param", key: m[1], raw: m[0] };
      if (m[2] !== undefined && m[2] !== "") {
        ref.options = m[2].split("|").map((o) => o.trim());
      }
      return ref;
    }),
  );

  // 위치순 정렬 + 겹침 제거(앞선 매치 우선 — {{x}} 가 {x} 보다 우선).
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Hit[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start < cursor) continue; // 이미 소비된 구간과 겹침 → 버림
    kept.push(h);
    cursor = h.end;
  }

  const nodes: Node[] = [];
  const refs: Reference[] = [];
  let pos = 0;
  for (const h of kept) {
    if (h.start > pos) {
      nodes.push({ kind: "text", value: template.slice(pos, h.start) });
    }
    nodes.push({ kind: "ref", ref: h.ref });
    refs.push(h.ref);
    pos = h.end;
  }
  if (pos < template.length) {
    nodes.push({ kind: "text", value: template.slice(pos) });
  }

  return { nodes, refs };
}
