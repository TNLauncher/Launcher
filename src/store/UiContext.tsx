import { createContext, startTransition, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { preloadView } from "@/views";

/** `plugin:<plugin id>:<page id>` = a page a plugin contributes. */
export type View = "home" | "profiles" | "instances" | "modpacks" | "mods" | "console" | "settings" | `plugin:${string}:${string}`;

interface UiValue {
  view: View;
  navigate(view: View): void;
  /** Opens the "New instance" dialog from anywhere. */
  openNewInstance(): void;
  newInstanceOpen: boolean;
  closeNewInstance(): void;
}

const UiContext = createContext<UiValue | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>("home");
  const [newInstanceOpen, setNewInstanceOpen] = useState(false);
  const current = useRef(view);
  current.current = view;
  const target = useRef(view);

  // Load the next view's chunk first, then swap: the old view stays up until the new one can render,
  // never an empty Suspense frame in between.
  const navigate = useCallback((next: View) => {
    target.current = next;
    if (next === current.current) return;
    const swap = () => {
      if (target.current !== next) return; // a later click won the race
      startTransition(() => setView(next));
    };
    preloadView(next).then(swap, swap);
  }, []);

  const value = useMemo(
    () => ({
      view,
      navigate,
      newInstanceOpen,
      openNewInstance: () => setNewInstanceOpen(true),
      closeNewInstance: () => setNewInstanceOpen(false),
    }),
    [view, navigate, newInstanceOpen]
  );
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiValue {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi must be used inside <UiProvider>");
  return ctx;
}
