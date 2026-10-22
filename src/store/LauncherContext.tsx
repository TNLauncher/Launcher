import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { launcher } from "@/api/launcher";
import { errorMessage } from "@/lib/format";
import type { Instance, Settings, Snapshot, Stage } from "@/types";

export interface Busy {
  id: string;
  stage: Stage;
  done: number;
  total: number;
}

export interface LaunchError {
  id: string;
  message: string;
}

interface LauncherValue {
  snapshot: Snapshot | null;
  /** The instance the Play button targets. */
  selected: Instance | undefined;
  select(id: string): void;
  refresh(): Promise<void>;
  launch(id: string): Promise<void>;
  /** Set while an instance is installing/starting. */
  busy: Busy | null;
  error: LaunchError | null;
  clearError(): void;
  saveSettings(settings: Settings): Promise<void>;
  isRunning(id: string): boolean;
}

const LauncherContext = createContext<LauncherValue | null>(null);
const SELECTED_KEY = "selected";

function readSelected(): string {
  try {
    return localStorage.getItem(SELECTED_KEY) ?? "";
  } catch {
    return "";
  }
}

export function LauncherProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedId, setSelectedId] = useState(readSelected);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<LaunchError | null>(null);

  const refresh = useCallback(async () => setSnapshot(await launcher.getState()), []);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem(SELECTED_KEY, id);
    } catch {
      /* storage unavailable: selection just won't persist */
    }
  }, []);

  const launch = useCallback(
    async (id: string) => {
      setError(null);
      select(id);
      setBusy({ id, stage: "resolving", done: 0, total: 0 });
      try {
        await launcher.launch(id, (e) => {
          if (e.event === "progress") setBusy({ id, ...e.data });
        });
      } catch (e) {
        setError({ id, message: errorMessage(e) });
      } finally {
        setBusy(null);
        await refresh();
      }
    },
    [refresh, select]
  );

  const saveSettings = useCallback(async (settings: Settings) => {
    setSnapshot((s) => (s ? { ...s, settings } : s));
    await launcher.saveSettings(settings);
  }, []);

  useEffect(() => {
    refresh();
    const unlisten = launcher.onGameExit(({ id, code }) => {
      if (code) setError({ id, message: `Game exited with code ${code}. See launcher.log in the instance folder.` });
      refresh();
    });
    return () => void unlisten.then((f) => f());
  }, [refresh]);

  const value = useMemo<LauncherValue>(() => {
    const instances = snapshot?.instances ?? [];
    const selected =
      instances.find((i) => i.id === selectedId) ?? [...instances].sort((a, b) => b.lastPlayed - a.lastPlayed)[0];
    return {
      snapshot,
      selected,
      select,
      refresh,
      launch,
      busy,
      error,
      clearError: () => setError(null),
      saveSettings,
      isRunning: (id) => snapshot?.running.includes(id) ?? false,
    };
  }, [snapshot, selectedId, select, refresh, launch, busy, error, saveSettings]);

  return <LauncherContext.Provider value={value}>{children}</LauncherContext.Provider>;
}

export function useLauncher(): LauncherValue {
  const ctx = useContext(LauncherContext);
  if (!ctx) throw new Error("useLauncher must be used inside <LauncherProvider>");
  return ctx;
}

/** Instances sorted by most recently played. */
export function useRecentInstances(): Instance[] {
  const { snapshot } = useLauncher();
  return useMemo(() => [...(snapshot?.instances ?? [])].sort((a, b) => b.lastPlayed - a.lastPlayed), [snapshot]);
}
