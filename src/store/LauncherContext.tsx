import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { launcher } from "@/api/launcher";
import { gameLogs } from "./gameLogs";
import { errorMessage } from "@/lib/format";
import type { Instance, Settings, Snapshot, Stage } from "@/types";

export interface Progress {
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
  /** Id of the instance installing/starting; its progress is in `useProgress()`. */
  busyId: string | null;
  error: LaunchError | null;
  clearError(): void;
  saveSettings(settings: Settings): Promise<void>;
  isRunning(id: string): boolean;
}

const LauncherContext = createContext<LauncherValue | null>(null);
// Separate so per-file download ticks re-render only progress consumers, not the whole app.
const ProgressContext = createContext<Progress | null>(null);
const STARTING: Progress = { stage: "resolving", done: 0, total: 0 };
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const frame = useRef(0);
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
      setBusyId(id);
      setProgress(STARTING);
      gameLogs.reset(id);
      // Backend reports every downloaded file (thousands for assets): commit at most once per frame.
      let latest = STARTING;
      try {
        await launcher.launch(id, (e) => {
          if (e.event !== "progress") return;
          latest = e.data;
          frame.current ||= requestAnimationFrame(() => {
            frame.current = 0;
            setProgress(latest);
          });
        });
      } catch (e) {
        setError({ id, message: errorMessage(e) });
      } finally {
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        setBusyId(null);
        setProgress(null);
        await refresh();
      }
    },
    [refresh, select]
  );

  const saveSettings = useCallback(async (settings: Settings) => {
    setSnapshot((s) => (s ? { ...s, settings } : s));
    await launcher.saveSettings(settings);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    refresh();
    const unlisten = [
      gameLogs.listen(),
      launcher.onGameExit(({ id, code }) => {
        if (!gameLogs.exited(id, code) && code) setError({ id, message: `Game crashed with exit code ${code}. Its log is in Console.` });
        refresh();
      }),
    ];
    return () => unlisten.forEach((u) => void u.then((f) => f()));
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
      busyId,
      error,
      clearError,
      saveSettings,
      isRunning: (id) => snapshot?.running.includes(id) ?? false,
    };
  }, [snapshot, selectedId, select, refresh, launch, busyId, error, clearError, saveSettings]);

  return (
    <LauncherContext.Provider value={value}>
      <ProgressContext.Provider value={progress}>{children}</ProgressContext.Provider>
    </LauncherContext.Provider>
  );
}

export function useLauncher(): LauncherValue {
  const ctx = useContext(LauncherContext);
  if (!ctx) throw new Error("useLauncher must be used inside <LauncherProvider>");
  return ctx;
}

/** Progress of the running install/launch, null when idle. */
export const useProgress = () => useContext(ProgressContext);

/** Instances sorted by most recently played. */
export function useRecentInstances(): Instance[] {
  const { snapshot } = useLauncher();
  return useMemo(() => [...(snapshot?.instances ?? [])].sort((a, b) => b.lastPlayed - a.lastPlayed), [snapshot]);
}
