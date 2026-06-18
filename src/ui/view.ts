// 런북 뷰 — vanilla DOM(React 비요구). 명령 목록 + 추가/편집 폼 + 인라인 배지 입력 에디터.
//
// [핵심 = 인라인 배지 입력 에디터] 명령 템플릿 입력을 contenteditable div 로 짓는다. 저장형 토큰은
//   비편집 inline span(rb-badge, contenteditable=false)으로 그려 원자성을 준다(화살표 건너뛰기·
//   Backspace 통째 삭제·클릭 전체선택). 시크릿 배지는 라벨만 — value 미보유(R2). 토큰↔배지 변환은
//   src/ui/tokens 의 단일 파서(parse) 재사용(중복 0, R8). 저장은 직렬화 문자열을 runbook.command.update.
//
// [스타일] 색 토큰만(--fg/--fg2/--fg3·--bg·--acc·--bd/--bd-soft) — 하드코딩 색 0. 배지 type 색은
//   color-mix 로 앱 토큰에서 파생(테마 자동 적응 — 슬롯 추가 0).
//
// [동기화] app.data.watch(전 창 브로드캐스트, 폴링 0) → mounts 라우팅 refresh.
// [노출 R7] contributes.nodes 선언 + data-node 인스턴스 부여 → ui.tree/ui.measure/ui.input.click E2E.

import {
  badgeLabel,
  deserialize,
  detectTrigger,
  filterCandidates,
  serialize,
  tokenToRaw,
  type BadgeProvider,
  type BadgeToken,
  type Segment,
} from "./tokens";

const COMMANDS = "commands";
const GROUPS = "groups";

// 색 토큰만 — 배지 type 색은 var(--acc)·var(--fg) 에서 color-mix 파생(하드코딩 색 0, 테마 적응).
const CSS = [
  ".rb-root{display:flex;flex-direction:column;height:100%;font-size:12px;color:var(--fg);}",
  ".rb-head{display:flex;flex-direction:column;gap:6px;padding:6px 8px;border-bottom:1px solid var(--bd-soft);}",
  ".rb-row1{display:flex;gap:6px;align-items:center;}",
  ".rb-search{flex:1;box-sizing:border-box;padding:4px 8px;border-radius:6px;border:1px solid var(--bd-soft);background:var(--bg);color:var(--fg);font-size:12px;}",
  ".rb-search::placeholder{color:var(--fg3);}",
  ".rb-group{box-sizing:border-box;padding:4px 6px;border-radius:6px;border:1px solid var(--bd-soft);background:var(--bg);color:var(--fg2);font-size:11px;max-width:120px;}",
  ".rb-add{flex:none;border:1px solid var(--bd-soft);background:var(--bg);color:var(--fg2);border-radius:6px;padding:3px 8px;cursor:pointer;font-size:13px;line-height:1;}",
  ".rb-add:hover{color:var(--fg);border-color:var(--bd);}",
  ".rb-list{flex:1;overflow-y:auto;padding:4px;}",
  ".rb-empty{color:var(--fg2);padding:14px;text-align:center;}",
  ".rb-item{display:flex;gap:6px;align-items:center;padding:6px;border-radius:6px;}",
  ".rb-item:hover{background:var(--bg);}",
  ".rb-main{flex:1;min-width:0;}",
  ".rb-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
  ".rb-meta{font-size:10.5px;color:var(--fg3);margin-top:1px;display:flex;gap:5px;align-items:center;}",
  ".rb-exec{font-size:9.5px;padding:1px 5px;border-radius:8px;border:1px solid var(--bd-soft);color:var(--fg2);}",
  // 실행타입별 색(배지와 같은 색 언어) — script=청록, terminal=청, background=중립, schedule=보라, api=시안.
  ".rb-exec-script{color:color-mix(in srgb,#46d3a3 82%,var(--fg));border-color:color-mix(in srgb,#46d3a3 40%,transparent);}",
  ".rb-exec-terminal{color:color-mix(in srgb,#6aa8ff 82%,var(--fg));border-color:color-mix(in srgb,#6aa8ff 40%,transparent);}",
  ".rb-exec-schedule{color:color-mix(in srgb,#c08cff 82%,var(--fg));border-color:color-mix(in srgb,#c08cff 40%,transparent);}",
  ".rb-exec-api{color:color-mix(in srgb,#52cfe6 82%,var(--fg));border-color:color-mix(in srgb,#52cfe6 40%,transparent);}",
  ".rb-btn{flex:none;border:0;background:none;padding:2px 5px;border-radius:4px;color:var(--fg3);cursor:pointer;}",
  ".rb-btn:hover{color:var(--fg);background:var(--bd);}",
  ".rb-btn.fav.on{color:var(--acc);}",
  ".rb-btn.run{color:var(--acc);}",
  // ── 폼 ──
  ".rb-form{display:flex;flex-direction:column;gap:8px;padding:10px 8px;border-bottom:1px solid var(--bd-soft);}",
  ".rb-field{display:flex;flex-direction:column;gap:3px;}",
  ".rb-flabel{font-size:10.5px;color:var(--fg3);}",
  ".rb-input{box-sizing:border-box;padding:4px 8px;border-radius:6px;border:1px solid var(--bd-soft);background:var(--bg);color:var(--fg);font-size:12px;}",
  ".rb-input::placeholder{color:var(--fg3);}",
  ".rb-formbtns{display:flex;gap:6px;justify-content:flex-end;}",
  ".rb-fbtn{border:1px solid var(--bd-soft);background:var(--bg);color:var(--fg2);border-radius:6px;padding:4px 12px;cursor:pointer;font-size:12px;}",
  ".rb-fbtn:hover{color:var(--fg);border-color:var(--bd);}",
  ".rb-fbtn.primary{background:var(--acc);border-color:var(--acc);color:var(--bg);}",
  // ── 인라인 배지 에디터 ──
  ".rb-editor-wrap{position:relative;}",
  ".rb-editor{box-sizing:border-box;min-height:34px;padding:6px 8px;border-radius:6px;border:1px solid var(--bd-soft);background:var(--bg);color:var(--fg);font-size:12px;line-height:1.7;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;outline:none;}",
  ".rb-editor:focus{border-color:var(--acc);}",
  ".rb-editor:empty::before{content:attr(data-ph);color:var(--fg3);}",
  ".rb-badge{display:inline;padding:1px 7px;margin:0 1px;border-radius:5px;font-size:11px;font-weight:500;white-space:nowrap;border:1px solid color-mix(in srgb,var(--fg3) 50%,transparent);background:color-mix(in srgb,var(--fg) 8%,var(--bg));color:var(--fg2);cursor:default;user-select:all;}",
  // provider 6색 토큰맵 — 색이 곧 타입(시크릿=호박/민감, command=청/링킹, param=보라, env=청록, var=시안, clipboard=주황).
  // color-mix 로 테마 적응(라이트=fg 어두워 텍스트 진해지고, 다크=fg 밝아 텍스트 밝아짐).
  ".rb-badge.secret{color:color-mix(in srgb,#e6b450 80%,var(--fg));border-color:color-mix(in srgb,#e6b450 48%,transparent);background:color-mix(in srgb,#e6b450 17%,var(--bg));}",
  ".rb-badge.command{color:color-mix(in srgb,#6aa8ff 80%,var(--fg));border-color:color-mix(in srgb,#6aa8ff 48%,transparent);background:color-mix(in srgb,#6aa8ff 17%,var(--bg));}",
  ".rb-badge.param{color:color-mix(in srgb,#c08cff 80%,var(--fg));border-color:color-mix(in srgb,#c08cff 48%,transparent);background:color-mix(in srgb,#c08cff 17%,var(--bg));}",
  ".rb-badge.env{color:color-mix(in srgb,#46d3a3 80%,var(--fg));border-color:color-mix(in srgb,#46d3a3 48%,transparent);background:color-mix(in srgb,#46d3a3 17%,var(--bg));}",
  ".rb-badge.var{color:color-mix(in srgb,#52cfe6 80%,var(--fg));border-color:color-mix(in srgb,#52cfe6 48%,transparent);background:color-mix(in srgb,#52cfe6 17%,var(--bg));}",
  ".rb-badge.clipboard{color:color-mix(in srgb,#f2945c 80%,var(--fg));border-color:color-mix(in srgb,#f2945c 48%,transparent);background:color-mix(in srgb,#f2945c 17%,var(--bg));}",
  ".rb-badge.selected{outline:2px solid var(--acc);outline-offset:0;}",
  // 테마 셀렉트 — 네이티브 3D 베벨 제거(appearance:none) + 커스텀 chevron(인라인 SVG).
  ".rb-select{box-sizing:border-box;appearance:none;-webkit-appearance:none;padding:4px 26px 4px 8px;border-radius:6px;border:1px solid var(--bd-soft);background-color:var(--bg);color:var(--fg);font-size:12px;cursor:pointer;background-image:url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M1 1l4 4 4-4' fill='none' stroke='%23888' stroke-width='1.4' stroke-linecap='round'/></svg>\");background-repeat:no-repeat;background-position:right 9px center;}",
  ".rb-select:hover{border-color:var(--bd);}",
  ".rb-select:focus{border-color:var(--acc);outline:none;}",
  // ── 자동완성 드롭다운 ──
  ".rb-suggest{position:absolute;left:8px;right:8px;z-index:20;margin-top:2px;max-height:160px;overflow-y:auto;background:var(--bg);border:1px solid var(--bd);border-radius:6px;box-shadow:0 4px 14px color-mix(in srgb,var(--fg) 18%,transparent);}",
  ".rb-sg-item{padding:4px 8px;font-size:11.5px;color:var(--fg2);cursor:pointer;display:flex;justify-content:space-between;gap:8px;}",
  ".rb-sg-item:hover,.rb-sg-item.active{background:color-mix(in srgb,var(--acc) 16%,var(--bg));color:var(--fg);}",
  ".rb-sg-kind{color:var(--fg3);font-size:10px;}",
].join("");

// node path 안정키 정제(세그먼트 형식 ^[a-z0-9][a-z0-9.-]*$) — 동적 목록 키.
function nodeKey(id: unknown): string {
  const s = String(id).toLowerCase().replace(/[^a-z0-9.-]/g, "-");
  return /^[a-z0-9]/.test(s) ? s : "k-" + s;
}

const EXEC_TYPES = ["terminal", "script", "background", "schedule", "api"];

// 자동완성 트리거 종류별 후보 출처(provider → 후보 키 배열). 동기 호출 — 비동기는 view 가 캐시.
interface CandidateSource {
  command: string[]; // 명령 id 목록(다른 작업 출력 참조)
  var: string[];
  clipboard: string[];
  secret: string[]; // app.secrets.keys()
  env: string[]; // 환경변수 prefix(있으면)
  param: string[]; // 보통 빈(자유 입력) — 같은 명령의 기존 param 키 재사용
}

// ── 배지 span 생성(원자) ──────────────────────────────────────────────────
// contenteditable=false 로 통째 원자. data-node=badge/<key>. 시크릿은 라벨만(평문 미보유 R2).
function makeBadgeEl(token: BadgeToken): HTMLElement {
  const span = document.createElement("span");
  span.className = "rb-badge " + (token.provider === "secret" ? "secret" : token.provider);
  span.contentEditable = "false";
  span.dataset.node = "badge/" + nodeKey(token.key);
  span.dataset.raw = token.raw || tokenToRaw(token);
  span.textContent = badgeLabel(token); // 외부 데이터 textContent(XSS 안전)
  span.title = span.dataset.raw;
  return span;
}

// zero-width 텍스트노드(배지 양옆 캐럿 안정화). 빈 사이를 둬 캐럿이 배지 경계에 머물 수 있게 한다.
const ZW = "​";
function zwNode(): Text {
  return document.createTextNode(ZW);
}

export interface RunbookApi {
  data: {
    query: (coll: string, opts?: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
    search: (coll: string, q: string, opts?: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
    put: (coll: string, doc: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<string>;
    watch: (coll: string, scope: string | undefined, cb: () => void) => { dispose: () => void };
  };
  // execute(name) — 이미 plugin.<id> 로 정규화된 이름을 호출한다(api.execute 는 prefix 안 함).
  commands: {
    execute: (name: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  secrets?: { keys: () => Promise<string[]> };
  pluginId: string;
}

interface MountEntry {
  refresh: () => void;
}

/** 뷰 등록. registerView 콜백에 그대로 넘긴다. mounts 는 watch 라우팅용 공유 Set. */
export function createRunbookView(app: RunbookApi, mounts: Set<MountEntry>) {
  return {
    mount(container: HTMLElement) {
      // 명령 호출은 정규화된 이름(api.execute 는 prefix 안 함) — plugin.<id>.<name>.
      const cmd = (name: string, params?: Record<string, unknown>) =>
        app.commands.execute(`plugin.${app.pluginId}.${name}`, params);
      container.textContent = "";
      const style = document.createElement("style");
      style.textContent = CSS;
      const root = document.createElement("div");
      root.className = "rb-root";

      // ── 헤더(검색 · 그룹 선택 · 추가) ──
      const head = document.createElement("div");
      head.className = "rb-head";
      const row1 = document.createElement("div");
      row1.className = "rb-row1";
      const searchInput = document.createElement("input");
      searchInput.className = "rb-search";
      searchInput.type = "text";
      searchInput.placeholder = "명령 검색…";
      searchInput.dataset.node = "search-input";
      const addBtn = document.createElement("button");
      addBtn.className = "rb-add";
      addBtn.type = "button";
      addBtn.textContent = "+";
      addBtn.title = "명령 추가";
      addBtn.dataset.node = "command-add";
      row1.append(searchInput, addBtn);

      const groupSel = document.createElement("select");
      groupSel.className = "rb-select rb-group";
      groupSel.dataset.node = "group-select";
      head.append(row1, groupSel);

      const formHost = document.createElement("div"); // 폼이 들어올 자리(추가/편집 시)
      const listEl = document.createElement("div");
      listEl.className = "rb-list";
      root.append(head, formHost, listEl);
      container.append(style, root);

      // ── 상태 ──
      let searchTerm = "";
      let groupFilter = ""; // "" = 전체
      let groups: Record<string, unknown>[] = [];
      let candidates: CandidateSource = {
        command: [],
        var: [],
        clipboard: [],
        secret: [],
        env: [],
        param: [],
      };
      let searchTimer: ReturnType<typeof setTimeout> | null = null;

      // ── 후보 출처 갱신(비동기 — 폼 열 때·갱신 시). app.secrets.keys / 명령 id / 환경변수. ──
      async function refreshCandidates() {
        try {
          const cmds = await app.data.query(COMMANDS, { where: { deleted: false }, limit: 1000 });
          candidates.command = cmds
            .map((c) => (typeof c.id === "string" ? c.id : ""))
            .filter(Boolean);
          candidates.var = candidates.command.slice(); // var 참조도 명령 출력 키 공간 공유
          candidates.clipboard = ["sel"]; // 클립보드는 단일 현재 선택(키 'sel')
        } catch {
          /* 무시 — 후보는 보조 */
        }
        if (app.secrets) {
          try {
            candidates.secret = await app.secrets.keys();
          } catch {
            candidates.secret = [];
          }
        }
      }

      // ── 인라인 배지 에디터 빌더 ──────────────────────────────────────────
      // 반환: { el, getValue(): 저장형 문자열, setValue(저장형) }. el 은 contenteditable div.
      function buildEditor(initial: string) {
        const wrap = document.createElement("div");
        wrap.className = "rb-editor-wrap";
        const ed = document.createElement("div");
        ed.className = "rb-editor";
        ed.contentEditable = "true";
        ed.spellcheck = false;
        ed.dataset.node = "command-input";
        ed.dataset.ph = "실행 템플릿 — {param} {{env}} `secret@key` …";
        wrap.append(ed);

        // 드롭다운(자동완성) — absolute.
        const sugg = document.createElement("div");
        sugg.className = "rb-suggest";
        sugg.dataset.node = "suggestions";
        sugg.style.display = "none";
        sugg.setAttribute("role", "listbox");
        wrap.append(sugg);
        // ARIA combobox
        ed.setAttribute("role", "combobox");
        ed.setAttribute("aria-expanded", "false");
        ed.setAttribute("aria-autocomplete", "list");

        let composing = false; // IME — composition 중 토큰 치환 보류
        let suggestItems: string[] = [];
        let activeIdx = -1;
        let curTrigger: ReturnType<typeof detectTrigger> = null;

        // 저장형 문자열 → 에디터 DOM(배지 span + 텍스트, 양옆 zero-width). 역직렬화 단일 경로.
        function render(template: string) {
          ed.textContent = "";
          const segs: Segment[] = deserialize(template);
          for (const s of segs) {
            if (s.kind === "text") {
              if (s.value) ed.appendChild(document.createTextNode(s.value));
            } else {
              ed.appendChild(zwNode());
              ed.appendChild(makeBadgeEl(s.token));
              ed.appendChild(zwNode());
            }
          }
        }

        // 에디터 DOM → 저장형 문자열(직렬화). 배지 span 은 data-raw, 텍스트노드는 값(zero-width 제거).
        function getValue(): string {
          const segs: Segment[] = [];
          for (const n of Array.from(ed.childNodes)) {
            if (n.nodeType === Node.TEXT_NODE) {
              const v = (n.textContent || "").replace(/​/g, "");
              if (v) segs.push({ kind: "text", value: v });
            } else if (n instanceof HTMLElement && n.classList.contains("rb-badge")) {
              const raw = n.dataset.raw || "";
              // raw 를 다시 파싱해 토큰화 — 단일 파서 재사용(중복 0). 배지 1개를 정확히 담는다.
              const toks = deserialize(raw).filter((s) => s.kind === "badge");
              if (toks[0] && toks[0].kind === "badge") segs.push(toks[0]);
            } else if (n instanceof HTMLElement) {
              // 예기치 않은 엘리먼트(붙여넣기 잔재 등) — textContent 만 흡수.
              const v = (n.textContent || "").replace(/​/g, "");
              if (v) segs.push({ kind: "text", value: v });
            }
          }
          return serialize(segs);
        }

        // ── 캐럿 헬퍼 ──
        function placeCaretAfter(node: Node) {
          const sel = window.getSelection();
          if (!sel) return;
          const r = document.createRange();
          r.setStartAfter(node);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }

        // 캐럿 앞 텍스트(현재 텍스트노드 내 좌측 문맥)를 모은다 — 트리거 감지 입력.
        function caretBeforeText(): { node: Text | null; offset: number; before: string } {
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return { node: null, offset: 0, before: "" };
          const r = sel.getRangeAt(0);
          const node = r.startContainer;
          if (node.nodeType !== Node.TEXT_NODE) return { node: null, offset: 0, before: "" };
          const text = (node.textContent || "");
          const offset = r.startOffset;
          return { node: node as Text, offset, before: text.slice(0, offset).replace(/​/g, "") };
        }

        function hideSuggest() {
          sugg.style.display = "none";
          sugg.textContent = "";
          ed.setAttribute("aria-expanded", "false");
          ed.removeAttribute("aria-activedescendant");
          suggestItems = [];
          activeIdx = -1;
          curTrigger = null;
        }

        function renderSuggest() {
          sugg.textContent = "";
          if (!suggestItems.length) {
            hideSuggest();
            return;
          }
          suggestItems.forEach((key, i) => {
            const item = document.createElement("div");
            item.className = "rb-sg-item" + (i === activeIdx ? " active" : "");
            item.dataset.node = "suggestion-item/" + nodeKey(key);
            item.id = "rb-sg-" + i;
            item.setAttribute("role", "option");
            item.setAttribute("aria-selected", i === activeIdx ? "true" : "false");
            const label = document.createElement("span");
            label.textContent = key; // 외부 데이터 textContent
            const kind = document.createElement("span");
            kind.className = "rb-sg-kind";
            kind.textContent = curTrigger ? curTrigger.provider : "";
            item.append(label, kind);
            item.addEventListener("mousedown", (e) => {
              e.preventDefault(); // 에디터 포커스 유지
              confirmSuggest(i);
            });
            sugg.append(item);
          });
          sugg.style.display = "block";
          ed.setAttribute("aria-expanded", "true");
          if (activeIdx >= 0) ed.setAttribute("aria-activedescendant", "rb-sg-" + activeIdx);
        }

        // 트리거 감지 → 후보 필터 → 드롭다운 표시(IME 중·composing 보류).
        function updateSuggest() {
          if (composing) return;
          const { before } = caretBeforeText();
          const trig = detectTrigger(before);
          curTrigger = trig;
          if (!trig) {
            hideSuggest();
            return;
          }
          const pool = candidates[trig.provider as keyof CandidateSource] ?? [];
          suggestItems = filterCandidates(pool, trig.query).slice(0, 30);
          activeIdx = suggestItems.length ? 0 : -1;
          renderSuggest();
        }

        // 후보 확정 — 트리거 앞까지 자르고 배지 삽입, 캐럿 뒤로.
        function confirmSuggest(idx: number) {
          if (idx < 0 || idx >= suggestItems.length || !curTrigger) return;
          const key = suggestItems[idx];
          const provider = curTrigger.provider as BadgeProvider;
          const { node, offset } = caretBeforeText();
          if (!node) {
            hideSuggest();
            return;
          }
          // 현재 텍스트노드에서 트리거 여는 시퀀스 시작점을 zero-width 보정 없이 다시 찾는다.
          const full = node.textContent || "";
          // 좌측 offset 까지의 실문자에서 trigger.start 는 zero-width 제거 기준이므로,
          // 보수적으로 여는 마커 패턴을 offset 직전에서 역탐색한다.
          const left = full.slice(0, offset);
          const openIdx = findOpenIndex(left, provider);
          if (openIdx < 0) {
            hideSuggest();
            return;
          }
          const rightText = full.slice(offset);
          const beforeText = full.slice(0, openIdx);

          const token: BadgeToken = { provider, key, raw: tokenToRaw({ provider, key }) };
          const badge = makeBadgeEl(token);

          // 텍스트노드를 [before][badge(zw 양옆)][right] 로 분해 재배치.
          const parent = node.parentNode;
          if (!parent) {
            hideSuggest();
            return;
          }
          const frag = document.createDocumentFragment();
          if (beforeText) frag.appendChild(document.createTextNode(beforeText));
          frag.appendChild(zwNode());
          frag.appendChild(badge);
          const tail = zwNode();
          frag.appendChild(tail);
          if (rightText) frag.appendChild(document.createTextNode(rightText));
          parent.replaceChild(frag, node);
          placeCaretAfter(tail);
          hideSuggest();
          onChange();
        }

        // 여는 시퀀스 시작 인덱스(provider 별) — left 텍스트 끝에서 마지막 여는 마커.
        function findOpenIndex(left: string, provider: BadgeProvider): number {
          if (provider === "env") return left.lastIndexOf("{{");
          if (provider === "param") {
            for (let i = left.length - 1; i >= 0; i--) {
              if (left[i] === "{" && left[i - 1] !== "{") return i;
            }
            return -1;
          }
          // 백틱 배지
          return left.lastIndexOf("`");
        }

        function onChange() {
          // 변경 알림 훅(저장은 폼이 getValue 로). 자동완성 갱신.
          updateSuggest();
        }

        // ── 원자 배지 키 처리: 화살표 건너뛰기·Backspace 통째 삭제 ──
        ed.addEventListener("keydown", (e) => {
          // 자동완성 표시 중 키맵(소비) — ↑↓ 순환·Tab/Enter 확정·Esc 닫기.
          if (sugg.style.display !== "none" && suggestItems.length) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              activeIdx = (activeIdx + 1) % suggestItems.length;
              renderSuggest();
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              activeIdx = (activeIdx - 1 + suggestItems.length) % suggestItems.length;
              renderSuggest();
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              confirmSuggest(activeIdx);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              hideSuggest();
              return;
            }
          }
          // 단일행 필드 — Enter 는 개행 차단(자동완성 미표시 시).
          if (e.key === "Enter") {
            e.preventDefault();
            return;
          }
          // Backspace: 캐럿 바로 앞이 배지(또는 zero-width+배지)면 배지 통째 삭제.
          if (e.key === "Backspace") {
            const sel = window.getSelection();
            if (sel && sel.isCollapsed && sel.rangeCount) {
              const prev = badgeBeforeCaret();
              if (prev) {
                e.preventDefault();
                removeBadge(prev);
                onChange();
                return;
              }
            }
          }
          // ArrowLeft/Right: 배지를 통째 건너뛴다(원자). 브라우저 기본이 zero-width 사이로 멈추므로
          // 배지 인접 시 추가로 한 칸 더 이동시켜 배지 안쪽으로 캐럿이 들어가지 않게 한다.
          if (e.key === "ArrowLeft") {
            const prev = badgeBeforeCaret();
            if (prev) {
              e.preventDefault();
              placeCaretBefore(prev.badge);
            }
          } else if (e.key === "ArrowRight") {
            const next = badgeAfterCaret();
            if (next) {
              e.preventDefault();
              placeCaretAfter(next.badge);
            }
          }
        });

        // 캐럿 직전 배지(zero-width 허용) — { badge, zwBefore?, zwAfter? }.
        function badgeBeforeCaret(): { badge: HTMLElement } | null {
          const sel = window.getSelection();
          if (!sel || !sel.rangeCount) return null;
          const r = sel.getRangeAt(0);
          let node: Node | null = r.startContainer;
          let offset = r.startOffset;
          // 텍스트노드 안이면 좌측이 비었거나 zero-width 만일 때 그 이전 형제를 본다.
          if (node.nodeType === Node.TEXT_NODE) {
            const left = (node.textContent || "").slice(0, offset).replace(/​/g, "");
            if (left) return null; // 실문자가 있으면 배지 삭제 아님
            node = node.previousSibling;
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            node = node.childNodes[offset - 1] ?? null;
          }
          // zero-width 텍스트노드를 건너뛴다.
          while (node && node.nodeType === Node.TEXT_NODE && (node.textContent || "").replace(/​/g, "") === "") {
            node = node.previousSibling;
          }
          if (node instanceof HTMLElement && node.classList.contains("rb-badge")) {
            return { badge: node };
          }
          return null;
        }

        function badgeAfterCaret(): { badge: HTMLElement } | null {
          const sel = window.getSelection();
          if (!sel || !sel.rangeCount) return null;
          const r = sel.getRangeAt(0);
          let node: Node | null = r.startContainer;
          const offset = r.startOffset;
          if (node.nodeType === Node.TEXT_NODE) {
            const right = (node.textContent || "").slice(offset).replace(/​/g, "");
            if (right) return null;
            node = node.nextSibling;
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            node = node.childNodes[offset] ?? null;
          }
          while (node && node.nodeType === Node.TEXT_NODE && (node.textContent || "").replace(/​/g, "") === "") {
            node = node.nextSibling;
          }
          if (node instanceof HTMLElement && node.classList.contains("rb-badge")) {
            return { badge: node };
          }
          return null;
        }

        function removeBadge(target: { badge: HTMLElement }) {
          const b = target.badge;
          // 양옆 zero-width 도 함께 정리.
          const prev = b.previousSibling;
          const next = b.nextSibling;
          if (prev && prev.nodeType === Node.TEXT_NODE && (prev.textContent || "").replace(/​/g, "") === "") {
            prev.remove();
          }
          if (next && next.nodeType === Node.TEXT_NODE && (next.textContent || "").replace(/​/g, "") === "") {
            const t = next as Text;
            placeCaretBefore(b); // 삭제 전에 캐럿을 좌측으로
            t.remove();
          }
          b.remove();
        }

        function placeCaretBefore(node: Node) {
          const sel = window.getSelection();
          if (!sel) return;
          const r = document.createRange();
          r.setStartBefore(node);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }

        // 클릭 시 배지 전체선택(user-select:all 이 시각 처리, 여기선 명시 range).
        ed.addEventListener("click", (e) => {
          const t = e.target;
          if (t instanceof HTMLElement && t.classList.contains("rb-badge")) {
            const sel = window.getSelection();
            if (sel) {
              const r = document.createRange();
              r.selectNode(t);
              sel.removeAllRanges();
              sel.addRange(r);
            }
          }
        });

        // 입력 — IME 보류, composition 후 재해석.
        ed.addEventListener("input", () => {
          if (composing) return;
          onChange();
        });
        ed.addEventListener("compositionstart", () => {
          composing = true;
          hideSuggest();
        });
        ed.addEventListener("compositionend", () => {
          composing = false;
          onChange();
        });

        // paste — text/plain 만(HTML·스크립트 차단), 개행 → 공백(단일행).
        ed.addEventListener("paste", (e) => {
          e.preventDefault();
          const text = (e.clipboardData?.getData("text/plain") || "").replace(/[\r\n]+/g, " ");
          if (!text) return;
          document.execCommand("insertText", false, text);
          onChange();
        });

        render(initial);
        return {
          el: wrap,
          editor: ed,
          getValue,
          setValue: (t: string) => render(t),
          focus: () => ed.focus(),
        };
      }

      // ── 추가/편집 폼 ─────────────────────────────────────────────────────
      function openForm(existing?: Record<string, unknown>) {
        void refreshCandidates();
        formHost.textContent = "";
        const form = document.createElement("div");
        form.className = "rb-form";
        form.dataset.node = existing ? "command-edit" : "command-form";

        const labelField = field("라벨", () => {
          const inp = document.createElement("input");
          inp.className = "rb-input";
          inp.type = "text";
          inp.placeholder = "예: 프로덕션 배포";
          inp.dataset.node = "form-label";
          if (existing && typeof existing.label === "string") inp.value = existing.label;
          return inp;
        });

        // 인라인 배지 에디터(템플릿).
        const initialTemplate =
          existing && typeof existing.command === "string" ? existing.command : "";
        const editor = buildEditor(initialTemplate);
        const tmplField = document.createElement("div");
        tmplField.className = "rb-field";
        const tl = document.createElement("div");
        tl.className = "rb-flabel";
        tl.textContent = "명령 템플릿";
        tmplField.append(tl, editor.el);

        // 실행 타입.
        const execField = field("실행 타입", () => {
          const sel = document.createElement("select");
          sel.className = "rb-select";
          sel.dataset.node = "form-exec";
          for (const t of EXEC_TYPES) {
            const o = document.createElement("option");
            o.value = t;
            o.textContent = t;
            sel.append(o);
          }
          if (existing && typeof existing.executionType === "string") {
            sel.value = existing.executionType;
          }
          return sel;
        });

        const btns = document.createElement("div");
        btns.className = "rb-formbtns";
        const cancel = document.createElement("button");
        cancel.className = "rb-fbtn";
        cancel.type = "button";
        cancel.textContent = "취소";
        cancel.dataset.node = "form-cancel";
        cancel.addEventListener("click", () => {
          formHost.textContent = "";
        });
        const save = document.createElement("button");
        save.className = "rb-fbtn primary";
        save.type = "button";
        save.textContent = "저장";
        save.dataset.node = "form-save";
        save.addEventListener("click", async () => {
          const labelInp = labelField.querySelector("input") as HTMLInputElement;
          const execSel = execField.querySelector("select") as HTMLSelectElement;
          const label = labelInp.value.trim();
          const command = editor.getValue(); // 직렬화한 저장형 문자열
          const executionType = execSel.value;
          if (!label) {
            labelInp.focus();
            return;
          }
          try {
            if (existing && typeof existing.id === "string") {
              await cmd("runbook.command.update", {
                commandId: existing.id,
                label,
                command,
                executionType,
              });
            } else {
              await cmd("runbook.command.add", {
                label,
                command,
                executionType,
              });
            }
            formHost.textContent = "";
          } catch (err) {
            console.warn("[runbook] 저장 실패:", err);
          }
        });
        btns.append(cancel, save);

        form.append(labelField, tmplField, execField, btns);
        formHost.append(form);
        const li = labelField.querySelector("input") as HTMLInputElement;
        li.focus();
      }

      function field(labelText: string, make: () => HTMLElement): HTMLElement {
        const f = document.createElement("div");
        f.className = "rb-field";
        const l = document.createElement("div");
        l.className = "rb-flabel";
        l.textContent = labelText;
        f.append(l, make());
        return f;
      }

      // ── 목록 렌더 ────────────────────────────────────────────────────────
      function renderRows(commands: Record<string, unknown>[]) {
        listEl.textContent = "";
        if (!commands.length) {
          const empty = document.createElement("div");
          empty.className = "rb-empty";
          empty.textContent = searchTerm ? "검색 결과가 없습니다" : "명령이 없습니다";
          listEl.append(empty);
          return;
        }
        for (const c of commands) {
          const key = nodeKey(c.id);
          const row = document.createElement("div");
          row.className = "rb-item";
          row.dataset.node = "command-row/" + key;

          const main = document.createElement("div");
          main.className = "rb-main";
          const label = document.createElement("div");
          label.className = "rb-label";
          label.textContent = String(c.label ?? ""); // 외부 데이터 textContent(XSS 안전)
          const meta = document.createElement("div");
          meta.className = "rb-meta";
          const exec = document.createElement("span");
          exec.className = "rb-exec rb-exec-" + String(c.executionType ?? "");
          exec.textContent = String(c.executionType ?? "");
          meta.append(exec);
          main.append(label, meta);

          const runB = iconBtn("▶", "실행", "run-button/" + key, "rb-btn run");
          runB.addEventListener("click", () => {
            void cmd("runbook.command.run", { commandId: c.id });
          });
          const favB = iconBtn(
            c.favorite ? "★" : "☆",
            "즐겨찾기",
            "command-fav/" + key,
            "rb-btn fav" + (c.favorite ? " on" : ""),
          );
          favB.addEventListener("click", () => {
            void cmd("runbook.command.favorite", { commandId: c.id });
          });
          const editB = iconBtn("✎", "편집", "command-edit/" + key, "rb-btn");
          editB.addEventListener("click", () => openForm(c));
          const delB = iconBtn("✕", "삭제", "command-del/" + key, "rb-btn");
          delB.addEventListener("click", () => {
            void cmd("runbook.command.delete", { commandId: c.id });
          });

          row.append(main, runB, favB, editB, delB);
          listEl.append(row);
        }
      }

      function iconBtn(text: string, title: string, node: string, cls: string): HTMLButtonElement {
        const b = document.createElement("button");
        b.className = cls;
        b.type = "button";
        b.textContent = text;
        b.title = title;
        b.dataset.node = node;
        return b;
      }

      function renderGroups() {
        groupSel.textContent = "";
        const all = document.createElement("option");
        all.value = "";
        all.textContent = "전체 그룹";
        groupSel.append(all);
        for (const g of groups) {
          const o = document.createElement("option");
          o.value = String(g.id ?? "");
          o.textContent = String(g.name ?? "");
          groupSel.append(o);
        }
        groupSel.value = groupFilter;
      }

      // ── 갱신(질의 → 렌더) ── 읽기는 app.data 직접(클립보드 idiom) — execute 는 이름 prefix 를
      // 안 하므로 정규화 비용 회피. 쓰기(저장/삭제/실행/즐겨찾기)만 정규화된 명령(refs 추출 경유).
      async function refresh() {
        try {
          groups = await app.data.query(GROUPS, { order: "order", desc: false, limit: 1000 });
          renderGroups();

          let commands: Record<string, unknown>[];
          if (searchTerm) {
            const hits = await app.data.search(COMMANDS, searchTerm, { limit: 200 });
            commands = hits.filter(
              (c) => !c.deleted && (!groupFilter || c.groupId === groupFilter),
            );
          } else {
            const where: Record<string, unknown> = { deleted: false };
            if (groupFilter) where.groupId = groupFilter;
            commands = await app.data.query(COMMANDS, {
              where,
              order: "order",
              desc: false,
              limit: 500,
            });
          }
          renderRows(commands);
        } catch (e) {
          console.warn("[runbook] refresh 실패:", e);
        }
      }

      // ── 이벤트 ──
      searchInput.addEventListener("input", () => {
        searchTerm = searchInput.value.trim();
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => void refresh(), 180);
      });
      groupSel.addEventListener("change", () => {
        groupFilter = groupSel.value;
        void refresh();
      });
      addBtn.addEventListener("click", () => openForm());

      const entry: MountEntry = { refresh: () => void refresh() };
      mounts.add(entry);
      (container as unknown as { __rbEntry?: MountEntry }).__rbEntry = entry;
      void refreshCandidates();
      void refresh();
    },

    unmount(container: HTMLElement) {
      const c = container as unknown as { __rbEntry?: MountEntry };
      if (c.__rbEntry) {
        mounts.delete(c.__rbEntry);
        c.__rbEntry = undefined;
      }
      container.textContent = "";
    },
  };
}

export { COMMANDS, GROUPS };
