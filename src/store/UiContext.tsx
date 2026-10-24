import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type SetStateAction } from "react";
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

interface UiValue {
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
// ponytail: entries are never evicted; a session navigates a few hundred times at most.
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

const UiContext = createContext<UiValue | null>(null);
const KeyContext = createContext("");

export function UiProvider({ children }: { children: ReactNode }) {
  const [at, setAt] = useState<At>(() => {
    const key = newEntry({ view: "home" });
    history.scrollRestoration = "manual";
    history.replaceState({ key, idx: 0 }, "");
    return { key, idx: 0 };
  });
  const [newInstanceOpen, setNewInstanceOpen] = useState(false);
  // Keys by history index; past `at.idx` are the forward entries.
  const stack = useRef([at.key]);
  // Where history is now; `at` catches up once the target view's chunk has loaded.
  const pending = useRef(at);
  const shown = useRef(at);
  shown.current = at;

  // Load the next view's chunk first, then swap: the old view stays up until the new one can render,
  // never an empty Suspense frame in between.
  const go = useCallback((next: At) => {
    const prev = entries.get(shown.current.key);
    if (prev && scroller) prev.scroll = scroller.scrollTop;
    pending.current = next;
    const swap = () => {
      if (pending.current !== next) return; // a later navigation won the race
      startTransition(() => setAt(next));
    };
    preloadView(entries.get(next.key)!.route.view).then(swap, swap);
  }, []);

  const navigate = useCallback(
    (view: View, detail: Omit<Route, "view"> = {}) => {
      const route = { view, ...detail };
      const cur = entries.get(pending.current.key)!;
      if (sameRoute(cur.route, route)) return;
      // Within a section the list stays mounted under the detail page, so its filters carry over.
      const key = newEntry(route, view === cur.route.view ? { ...cur.ui } : {});
      const idx = pending.current.idx + 1;
      stack.current.length = idx;
      stack.current.push(key);
      history.pushState({ key, idx }, "");
      go({ key, idx });
    },
    [go]
  );

  // With nothing behind a detail page, Back still leads somewhere: up to its section.
  const back = useCallback(() => {
    if (pending.current.idx > 0) history.back();
    else navigate(entries.get(pending.current.key)!.route.view);
  }, [navigate]);
  const forward = useCallback(() => void (pending.current.idx < stack.current.length - 1 && history.forward()), []);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      let next = e.state as At | null;
      // An entry from before a reload: its screen is gone, start over at Home.
      if (!next || !entries.has(next.key)) next = { key: newEntry({ view: "home" }), idx: next?.idx ?? 0 };
      stack.current[next.idx] = next.key;
      go(next);
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) back();
      else if (e.button === 4) forward();
      else return;
      e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      const route = entries.get(pending.current.key)!.route;
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
  }, [go, back, forward]);

  const value = useMemo<UiValue>(
    () => ({
      route: entries.get(at.key)!.route,
      navigate,
      back,
      forward,
      canBack: at.idx > 0,
      canForward: at.idx < stack.current.length - 1,
      previous: at.idx > 0 ? entries.get(stack.current[at.idx - 1])?.route : undefined,
      newInstanceOpen,
      openNewInstance: () => setNewInstanceOpen(true),
      closeNewInstance: () => setNewInstanceOpen(false),
    }),
    [at, navigate, back, forward, newInstanceOpen]
  );
  return (
    <UiContext.Provider value={value}>
      <KeyContext.Provider value={at.key}>{children}</KeyContext.Provider>
    </UiContext.Provider>
  );
}

export function useUi(): UiValue {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi must be used inside <UiProvider>");
  return ctx;
}

/** Key of the history entry on screen; scroll is restored per key. */
export const useRouteKey = () => useContext(KeyContext);

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
