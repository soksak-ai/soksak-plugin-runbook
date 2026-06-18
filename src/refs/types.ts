// Reference 해석 엔진 — 타입 (순수 코어, I/O 0).
//
// 레거시 CommandBar 의 저장형 토큰은 4상태(입력/저장/표시/실행)로 흩어진 문자열 치환이었고
// 순환 검출이 없어 command→command 체인이 무한재귀였다(R4). 이 모델은 그 4상태를 단일
// Reference 로 통합한다 — parse 가 텍스트에서 Reference 를 뽑고, resolve 가 context 로 푼다.

/** Reference 의 출처 종류. param 은 사용자 입력, env 는 환경변수, secret 은 봉인값(핸들만),
 *  command 은 다른 작업 출력(체인 — 순환 대상), clipboard 은 클립보드 내용. */
export type RefProvider =
  | "param"
  | "env"
  | "secret"
  | "command"
  | "clipboard"
  | "var";

/** 통합 Reference 모델. key = 해소 키(파라미터명/환경변수명/시크릿키/command id/clipboard id).
 *  jsonPath = command/var 출력에서 뽑을 경로(점표기 + [n]). options = param 의 {name:a|b} 선택지.
 *  raw = 원문 토큰(에러 메시지·미해소 시 안전 표기용). */
export interface Reference {
  provider: RefProvider;
  key: string;
  jsonPath?: string;
  options?: string[];
  raw: string;
}

/** parse 결과 노드 — 순수 텍스트 조각 또는 Reference. */
export type Node =
  | { kind: "text"; value: string }
  | { kind: "ref"; ref: Reference };

export interface Parsed {
  nodes: Node[];
  refs: Reference[];
}

/** 미해소·순환 등 링킹 실패 — 명시 전파(미치환 토큰이 셸/HTTP 로 새지 않게 R4). */
export interface LinkError {
  ref: Reference;
  reason: string;
}

/** secret provider 해석 결과 — 평문이 아니라 핸들 마커(R2). 실제 평문 주입은 Rust 경계. */
export interface SecretHandle {
  __secretRef: true;
  ns: string;
  key: string;
}

/** resolve 의 입력 context — provider 별 해소값 맵. command/var 는 outcome 객체(jsonPath 추출 대상),
 *  param/env/clipboard 는 문자열. secret 은 context 에 평문을 넣지 않는다 — ns 만(핸들 생성용). */
export interface ResolveContext {
  param?: Record<string, string>;
  env?: Record<string, string>;
  clipboard?: Record<string, string>;
  command?: Record<string, unknown>;
  var?: Record<string, unknown>;
  /** 시크릿 네임스페이스(보통 호출 플러그인 id). 핸들 마커에 들어간다 — 평문 아님. */
  secretNs?: string;
}

export interface Resolved {
  /** 치환 완성 텍스트. secret 핸들은 인라인 텍스트로 표현 불가 → handles 로 별도 수집. */
  text: string;
  errors: LinkError[];
  /** 이 템플릿이 참조한 secret 핸들 목록(평문 주입은 Rust 경계에서). */
  handles: SecretHandle[];
}
