import { startTransition, useCallback, useEffect, useState, type SetStateAction } from "react";
import { create } from "zustand";
import type { Hit } from "@/api/sources";
import { preloadView } from "@/views";

/** `plugin:<plugin id>:<page id>` = a page a plugin contributes. */
export type View = "home" | "profiles" | "instances" | "modpacks" | "mods" | "console" | "settings" | `plugin:${string}:${string}`;

/** A screen: a section, optionally with one of its detail pages open. */
export interface Route {
  view: View;
  instance?: string;
  pack?: { source: string; hit: Hit };
}

export interface UiState {
  key: string;
  idx: number;
  route: Route;
  /** Pushes a history entry; repeating the current route is a no-op. */
  navigate(view: View, detail?: Omit<Route, "view">): void;
  back(): void;
  forward(): void;
  canBack: boolean;
  canForward: boolean;
  /** The screen Back returns to. */
  previous: Route | undefined;
  /** Opens the "New instance" dialog from anywhere. */
  openNewInstance(): void;
  newInstanceOpen: boolean;
  closeNewInstance(): void;
}

interface Entry {
  route: Route;
  scroll: number;
  /** Per-screen state (filters, tabs) kept by `useRouteState`. */
  ui: Record<string, unknown>;
}

// history.state carries only the key: WebKit throttles replaceState, so filter keystrokes must never touch history.
const entries = new Map<string, Entry>();
let seq = 0;
const newEntry = (route: Route, ui: Entry["ui"] = {}) => {
  const key = `r${seq++}`;
  entries.set(key, { route, scroll: 0, ui });
  return key;
};

const sameRoute = (a: Route, b: Route) =>
  a.view === b.view && a.instance === b.instance && a.pack?.source === b.pack?.source && a.pack?.hit.id === b.pack?.hit.id;

let scroller: HTMLElement | null = null;
/** The element whose scroll position each history entry remembers. */
export const registerScroller = (el: HTMLElement | null) => void (scroller = el);
export const savedScroll = (key: string) => entries.get(key)?.scroll ?? 0;

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

interface At {
  key: string;
  idx: number;
}

const initialRoute: Route = { view: "home" };
const initialKey = newEntry(initialRoute);
history.scrollRestoration = "manual";
history.replaceState({ key: initialKey, idx: 0 }, "");

// Keys by history index; past `at.idx` are the forward entries.
const stack: string[] = [initialKey];
// Where history is now; store state catches up once the target view's chunk has loaded.
let pending: At = { key: initialKey, idx: 0 };
let shown: At = pending;

// Load the next view's chunk first, then swap: the old view stays up until the new one can render,
// never an empty Suspense frame in between.
function go(next: At) {
  const prev = entries.get(shown.key);
  if (prev && scroller) prev.scroll = scroller.scrollTop;
  pending = next;
  const swap = () => {
    if (pending !== next) return; // a later navigation won the race
    shown = next;
    startTransition(() => {
      useUi.setState({
        key: next.key,
        idx: next.idx,
        route: entries.get(next.key)!.route,
        canBack: next.idx > 0,
        canForward: next.idx < stack.length - 1,
        previous: next.idx > 0 ? entries.get(stack[next.idx - 1])?.route : undefined,
      });
    });
  };
  preloadView(entries.get(next.key)!.route.view).then(swap, swap);
}

export const useUi = create<UiState>((set) => ({
  key: initialKey,
  idx: 0,
  route: initialRoute,
  canBack: false,
  canForward: false,
  previous: undefined,
  newInstanceOpen: false,

  navigate: (view: View, detail: Omit<Route, "view"> = {}) => {
    const route = { view, ...detail };
    const cur = entries.get(pending.key)!;
    if (sameRoute(cur.route, route)) return;
    // Within a section the list stays mounted under the detail page, so its filters carry over.
    const key = newEntry(route, view === cur.route.view ? { ...cur.ui } : {});
    const idx = pending.idx + 1;
    for (const dead of stack.splice(idx)) entries.delete(dead);
    stack.push(key);
    history.pushState({ key, idx }, "");
    go({ key, idx });
  },

  // With nothing behind a detail page, Back still leads somewhere: up to its section.
  back: () => {
    if (pending.idx > 0) history.back();
    else useUi.getState().navigate(entries.get(pending.key)!.route.view);
  },

  forward: () => {
    if (pending.idx < stack.length - 1) history.forward();
  },

  openNewInstance: () => set({ newInstanceOpen: true }),
  closeNewInstance: () => set({ newInstanceOpen: false }),
}));

/** Binds global history/keyboard/mouse navigation listeners once at the app shell level. */
export function useUiInit() {
  useEffect(() => {
    const { back, forward } = useUi.getState();
    const onPop = (e: PopStateEvent) => {
      let next = e.state as At | null;
      // An entry from before a reload: its screen is gone, start over at Home.
      if (!next || !entries.has(next.key)) next = { key: newEntry({ view: "home" }), idx: next?.idx ?? 0 };
      stack[next.idx] = next.key;
      go(next);
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) back();
      else if (e.button === 4) forward();
      else return;
      e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      const route = entries.get(pending.key)!.route;
      if (e.altKey && e.key === "ArrowLeft") back();
      else if (e.altKey && e.key === "ArrowRight") forward();
      // Esc leaves a detail page, unless something on it (a field, a dialog, an open select) claims the key.
      else if (e.key === "Escape" && (route.instance || route.pack) && !e.defaultPrevented && !typing(e.target) && !document.querySelector("dialog[open]")) back();
      else return;
      e.preventDefault();
    };
    addEventListener("popstate", onPop);
    addEventListener("mouseup", onMouse);
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("popstate", onPop);
      removeEventListener("mouseup", onMouse);
      removeEventListener("keydown", onKey);
    };
  }, []);
}

/** Key of the history entry on screen; scroll is restored per key. */
export const useRouteKey = () => useUi((s) => s.key);

/** `useState` remembered by the current history entry: Back returns to it as it was left. `key` is unique per screen. */
export function useRouteState<T>(key: string, initial: T): [T, (next: SetStateAction<T>) => void] {
  const entry = useRouteKey();
  const [value, setValue] = useState<T>(() => {
    const ui = entries.get(entry)?.ui;
    return ui && key in ui ? (ui[key] as T) : initial;
  });
  const set = useCallback(
    (next: SetStateAction<T>) =>
      setValue((prev) => {
        const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        const ui = entries.get(entry)?.ui;
        if (ui) ui[key] = v;
        return v;
      }),
    [entry, key]
  );
  return [value, set];
}
