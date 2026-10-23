import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type View = "home" | "instances" | "modpacks" | "mods" | "console" | "settings";

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
  const [view, navigate] = useState<View>("home");
  const [newInstanceOpen, setNewInstanceOpen] = useState(false);
  const value = useMemo(
    () => ({
      view,
      navigate,
      newInstanceOpen,
      openNewInstance: () => setNewInstanceOpen(true),
      closeNewInstance: () => setNewInstanceOpen(false),
    }),
    [view, newInstanceOpen]
  );
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiValue {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi must be used inside <UiProvider>");
  return ctx;
}
