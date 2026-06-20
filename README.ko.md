# soksak-plugin-runbook

재사용 가능한 작업(런북)을 저장하고 실행하는 soksak 플러그인. 작업은 파라미터·환경변수·시크릿·다른 작업
출력을 Reference 로 엮으며, 링킹은 순수 해석 + 의존 그래프 + 순환 검출로 안전하게 풀린다. 우측 사이드바 탭.

## 실행 타입 (5종)

| 타입 | 동작 |
|---|---|
| `terminal` | 포커스된 터미널 pane 에 명령+Enter(코어 `term.exec`). 시크릿 동반 시 거부(ps 노출 위험). |
| `script` | 셸(`/bin/sh -c`)로 실행 — stdout/stderr·exitCode 캡처. |
| `background` | script 와 동일 경로(반복 실행 의도). |
| `api` | HTTP 요청(method/url/headers/query/body) → status·body 캡처. 코어 `net.http.request`(reqwest+rustls). |
| `schedule` | 코어 스케줄러에 예약 — due 시각에 action(셸) 발화, 반복(daily/weekly/monthly)·간격·리마인더. |

`command.run` 은 schedule 만 예약(arm)하고 나머지는 즉시 실행한다. 코어 타이머가 due 에 `schedule.fire`
를 호출하면 action 실행 + 다음 occurrence 재무장(반복). 영속은 플러그인이 소유 — activate 시 재무장.

## Reference 해석 엔진 (`src/refs/`, 순수 코어)

CommandBar 의 저장형 토큰(문자열 치환·순환검출 0 → 무한재귀)을 순수·순환검출 구조로 재설계했다. I/O 0.

- `parse(template)` — 템플릿을 노드/Reference 로 분해. 토큰:
  - `{name}` / `{name:a|b}` — 파라미터(옵션 목록)
  - `{{var}}` — 환경변수
  - `` `secret@key` `` — 시크릿(핸들 마커로만 — 평문 미보유)
  - `` `command@id|jsonPath` `` — 다른 작업 출력(체인 — 순환 대상)
  - `` `clipboard@id` `` / `` `var@id|jsonPath` `` — 클립보드·명명 변수
- `dependencyGraph` / `topoSort` / `detectCycle` — command 체인 의존 그래프·실행 순서·순환 거부(3색 DFS).
- `resolve(parsed, context)` — context 로 치환. 미해소는 `LinkError` 로 명시 전파(미치환 토큰이 셸/HTTP 로
  새지 않음).
- 토큰 정규식은 `src/refs/patterns.ts` 한 곳(중복 금지). JSONPath 추출도 단일 유틸.

링킹은 api 필드(url/headers/body)를 가로질러 동작한다 — 한 작업의 출력이 다른 작업의 URL·헤더로 되먹임된다.

## 시크릿 (평문 미노출)

시크릿 참조는 해석 단계에서 평문이 아니라 핸들 마커로만 흐른다. 평문 주입은 **Rust 경계에서만** 일어난다:
- script/background — 자식 프로세스 env(`$SOKSAK_SECRET_N`).
- api — 요청 url/headers/body 의 placeholder 를 코어가 볼트에서 해소해 치환(secretSubst).

명령 템플릿·히스토리·lastOutput·응답 어디에도 평문이 남지 않는다. 시크릿이 볼트에 없거나 잠겨 있으면
실행 전에 `SECRET_PENDING` 으로 명시 거부(`secret.set`/`secret.unlock` 안내). 시크릿 자체는 코어
`app.secrets`(암호화 볼트)가 관리한다 — 이 플러그인은 참조만 한다.

## 인라인 배지 입력 UI

명령 템플릿은 `contenteditable` 에디터에서 토큰을 비편집 배지(원자 글리프)로 그린다 — 캐럿/삭제/화살표가
배지를 통째로 건넌다. provider 별 색(시크릿=호박·command=청·param=보라·env=청록·var=시안·clipboard=주황)으로
타입을 구분하고, 자동완성 드롭다운(ARIA combobox)으로 토큰을 채운다. 시크릿은 라벨만 표시(평문 미보유).
토큰↔배지 직렬화·트리거 감지는 `src/ui/tokens` 순수 모듈(단일 파서 재사용).

## 데이터

코어 `app.data`(SQLite, 이 플러그인 전용 네임스페이스)만 — raw SQL 없음. 컬렉션 `commands`/`groups`/
`history`, CJK 전문검색(FTS5 trigram). enum 은 영문 안정키, 소프트삭제는 boolean `deleted`. 그룹·즐겨찾기·
휴지통·히스토리·import/export(JSONL) 지원.

## 커맨드 (전 기능 노출 — CLI/MCP/뷰 무관)

`command.add/get/update/delete/restore/duplicate/list/search/set-group/favorite/run`, `schedule.fire`,
`group.*`, `history.*`, `import`/`export`, 엔진 검증용 `ref.parse`/`ref.resolve`, 에디터 `editor.tokens`/
`editor.serialize`. 예:

```
sok plugin.soksak-plugin-runbook.runbook.command.add '{"label":"배포","command":"make deploy {env:dev|prod}","executionType":"script"}'
sok plugin.soksak-plugin-runbook.runbook.command.run '{"commandId":"<id>","inputs":{"env":"prod"}}'
```

## 빌드 / 테스트

```
npm install
npm run build   # esbuild: src/index.ts → main.js (단일 ESM)
npm test        # vitest run (refs/exec/ui 단위)
# 소켓 E2E(코어 dev 실행 중):
SOKSAK_SOCKET=~/.soksak/com.soksak.dev.sock node e2e/runbook.mjs        # CRUD
SOKSAK_SOCKET=~/.soksak/com.soksak.dev.sock node e2e/runbook-exec.mjs   # 링킹·셸·시크릿 게이트/주입
SOKSAK_SOCKET=~/.soksak/com.soksak.dev.sock node e2e/runbook-api.mjs    # HTTP(로컬서버)
SOKSAK_SOCKET=~/.soksak/com.soksak.dev.sock node e2e/runbook-schedule.mjs  # 타이머 발화·재무장
SOKSAK_SOCKET=~/.soksak/com.soksak.dev.sock node e2e/runbook-ui.mjs     # 배지 에디터(ui.tree/measure)
```

`main.js` 는 entry 산출물(번들)이라 커밋한다.

## 후속 (이번 범위 제외)

- api multipart(파일 업로드) — 현재 none/json/form 바디 지원.
- 딥링크 클릭→명령(데스크톱 알림 per-click 액션 플랫폼 미지원 — 코어 `soksak://run?cmd=` 라우팅은 동작).
- 프로젝트 scope schedule 재무장 — activate 재무장은 전역 scope.

권한: `data`·`commands`(+`inject`)·`ui`·`process`·`network`·`notify`·`programs`·`clipboard:read`·`secrets`.
