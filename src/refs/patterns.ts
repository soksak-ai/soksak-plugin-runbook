// 토큰 정규식 — 단일 상수 모듈(레거시의 흩어진 중복 정규식 제거 R4).
//
// 토큰 종류:
//   {name}            파라미터(자유 입력)
//   {name:a|b|c}      파라미터(옵션 선택 목록)
//   {{var}}           환경변수
//   `secret@key`      저장형 배지 — 시크릿(백틱으로 감싼다)
//   `command@id|path` 저장형 배지 — 다른 작업 출력(jsonPath 체이닝, 순환 대상)
//   `clipboard@id`    저장형 배지 — 클립보드 내용
//   `var@id|path`     저장형 배지 — 명명 변수
//
// 저장형 배지는 백틱(`)으로 감싼 provider@key[|jsonPath] 형식이다 — 셸 백틱과 충돌하지
// 않도록 항상 provider@ 접두를 요구한다(맨 백틱 코드 인용은 토큰이 아니다).

/** {name} 또는 {name:opt|opt} — 환경변수 {{...}} 와 충돌 안 나게 단일 중괄호만. */
export const PARAM_RE = /\{([A-Za-z0-9_.-]+)(?::([^{}]*))?\}/g;

/** {{var}} — 이중 중괄호. */
export const ENV_RE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

/** `provider@key` 또는 `provider@key|jsonPath` — 백틱으로 감싼 저장형 배지. */
export const BADGE_RE =
  /`(secret|command|clipboard|var)@([A-Za-z0-9_.\-:/]+?)(?:\|([^`]*))?`/g;

/** 배지 provider 화이트리스트(BADGE_RE 와 동기). */
export const BADGE_PROVIDERS = ["secret", "command", "clipboard", "var"] as const;
