// 런북 데이터 enum — 영문 안정키만(R1·DB-메뉴얼 §12). 표시 문자열(한국어 등)은 호스트/뷰 i18n
// 레이어로 분리한다 — 저장 raw value 에는 영문 키만 들어간다(레거시 한국어 enum 저장 금지).

/** 실행 종류. terminal=터미널 실행, script=쉘 스크립트, background=반복 백그라운드,
 *  schedule=예약, api=HTTP 호출. (실제 실행기는 후속 범위 — 여기서는 데이터 분류만.) */
export const EXECUTION_TYPES = [
  "terminal",
  "script",
  "background",
  "schedule",
  "api",
] as const;
export type ExecutionType = (typeof EXECUTION_TYPES)[number];

/** schedule 반복 종류. */
export const REPEAT_TYPES = ["none", "daily", "weekly", "monthly"] as const;
export type RepeatType = (typeof REPEAT_TYPES)[number];

/** api 실행의 HTTP 메서드. */
export const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** api 본문 인코딩 종류. */
export const BODY_TYPES = ["none", "json", "form", "multipart"] as const;
export type BodyType = (typeof BODY_TYPES)[number];

/** 그룹 색상 — 영문 안정키(표시 색 매핑은 뷰 레이어). */
export const GROUP_COLORS = [
  "blue",
  "red",
  "green",
  "orange",
  "purple",
  "gray",
] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

/** 멤버십 검사 — 미지 enum 값을 INVALID_PARAMS 로 거르기 위한 단일 유틸(R8). */
export function isOneOf<T extends readonly string[]>(
  vals: T,
  v: unknown,
): v is T[number] {
  return typeof v === "string" && (vals as readonly string[]).includes(v);
}
