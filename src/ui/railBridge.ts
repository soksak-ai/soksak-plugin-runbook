// 레일 브리지 — 이 플러그인의 rail 뷰(list/editor)는 컨테이너만 소유·등록하고, 결부된 런북
// 콘텐츠 뷰가 자기 요소(헤더+목록, 폼 호스트)를 그 컨테이너로 옮긴다. 상태·DOM 은 콘텐츠 뷰가
// 계속 소유한다(이중 진실 0). 키 = 결부 콘텐츠 뷰 id(rail ctx.boundViewId ↔ 콘텐츠 ctx.viewId —
// per-view 인스턴스라 1:1). 레일 없는 호스트(구코어·사이드바 배치)는 등록이 없어 콘텐츠 뷰가
// 기존 인라인 배치를 그대로 유지한다.

export type RailSlot = "list" | "editor";

const containers = new Map<string, Partial<Record<RailSlot, HTMLElement>>>();
const subs = new Map<string, Set<() => void>>();

function notify(viewId: string) {
  for (const fn of subs.get(viewId) ?? []) fn();
}

// rail 뷰 마운트가 자기 컨테이너를 등록한다. 반환 = 해제(언마운트 시). 같은 슬롯의 새 등록이
// 이기고, 낡은 해제는 새 컨테이너를 몰아내지 못한다.
export function registerRailContainer(
  viewId: string,
  slot: RailSlot,
  el: HTMLElement,
): () => void {
  const entry = containers.get(viewId) ?? {};
  entry[slot] = el;
  containers.set(viewId, entry);
  notify(viewId);
  return () => {
    const cur = containers.get(viewId);
    if (!cur || cur[slot] !== el) return;
    delete cur[slot];
    if (!cur.list && !cur.editor) containers.delete(viewId);
    notify(viewId);
  };
}

export function railContainer(
  viewId: string | null | undefined,
  slot: RailSlot,
): HTMLElement | null {
  if (!viewId) return null;
  return containers.get(viewId)?.[slot] ?? null;
}

// 콘텐츠 뷰가 등록/해제 턴을 구독한다. 결부 id 가 null(사이드바 배치·구코어)이면 침묵.
export function subscribeRail(viewId: string | null | undefined, fn: () => void): () => void {
  if (!viewId) return () => {};
  let set = subs.get(viewId);
  if (!set) {
    set = new Set();
    subs.set(viewId, set);
  }
  set.add(fn);
  return () => {
    const s = subs.get(viewId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) subs.delete(viewId);
  };
}

// rail 뷰 provider — 컨테이너 등록/해제만 담당한다. 미결부(런북 콘텐츠 뷰 없음)면 정적 안내.
export function createRailView(slot: RailSlot, hint: () => string) {
  const cleanups = new WeakMap<HTMLElement, () => void>();
  return {
    mount(container: HTMLElement, vctx?: unknown) {
      cleanups.get(container)?.();
      container.textContent = "";
      const host = document.createElement("div");
      host.style.cssText =
        "display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden";
      container.append(host);
      const bound = (vctx as { boundViewId?: unknown } | undefined)?.boundViewId;
      if (typeof bound !== "string" || !bound) {
        const note = document.createElement("div");
        note.style.cssText = "padding:10px 12px;font-size:11px;color:var(--fg3)";
        note.textContent = hint();
        host.append(note);
        cleanups.set(container, () => {
          container.textContent = "";
        });
        return;
      }
      const off = registerRailContainer(bound, slot, host);
      cleanups.set(container, () => {
        off();
        container.textContent = "";
      });
    },
    unmount(container: HTMLElement) {
      cleanups.get(container)?.();
      cleanups.delete(container);
    },
  };
}
