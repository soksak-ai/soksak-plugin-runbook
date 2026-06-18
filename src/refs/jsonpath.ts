// JSONPath 추출 — 단일 유틸(레거시의 3중복 통합 R4). 점표기 + [n] 인덱스만(미니멀·예측 가능).
//   예) "data.token"   → obj.data.token
//       "items[0].x"   → obj.items[0].x
//       ""             → obj 자체

/** 경로를 세그먼트로 분해 — 키(문자열) 또는 인덱스(숫자). 빈 경로는 []. */
export function parseJsonPath(path: string): (string | number)[] {
  const segs: (string | number)[] = [];
  const trimmed = path.trim();
  if (trimmed === "") return segs;
  // a.b[0].c → ["a","b","[0]","c"] 토큰화. [n] 은 점 없이 바로 붙는다.
  const re = /[^.[\]]+|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    if (m[1] !== undefined) segs.push(Number(m[1]));
    else segs.push(m[0]);
  }
  return segs;
}

/** value 에서 path 를 따라 추출. 미존재/타입불일치는 undefined. */
export function extractJsonPath(value: unknown, path: string): unknown {
  const segs = parseJsonPath(path);
  let cur: unknown = value;
  for (const seg of segs) {
    if (cur == null) return undefined;
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg];
    } else {
      if (typeof cur !== "object" || Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

/** 해소값을 텍스트로 — 단일 stringify 유틸(이스케이프/치환 단일 지점 R4). 객체/배열은 JSON,
 *  원시값은 String. undefined/null 은 호출자가 미해소로 처리하므로 여기선 빈 문자열. */
export function stringifyValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}
