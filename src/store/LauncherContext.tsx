import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { launcher } from "@/api/launcher";
import { broadcast } from "@/plugins/bridge";
import { gameLogs } from "./gameLogs";
import { sources, type Hit, type Version } from "@/api/sources";
import { errorMessage, recency } from "@/lib/format";
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

type PackHit = Pick<Hit, "id" | "title" | "iconUrl">;

/** A modpack download that has not become an instance yet. */
export interface PendingImport {
  source: string;
  projectId: string;
  title: string;
  iconUrl: string | null;
  /** Chosen pack version; undefined = newest. */
  version?: Version;
  done: number;
  total: number;
  error: string;
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
  /** Modpack installs in flight (or failed, until dismissed). */
  imports: PendingImport[];
  /** Starts a background install; a pack already installing is ignored. */
  startImport(source: string, pack: PackHit, version?: Version): void;
  dismissImport(projectId: string): void;
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
  const [imports, setImports] = useState<PendingImport[]>([]);
  const inFlight = useRef(new Set<string>());

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
      broadcast("game-launching", { instanceId: id });
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
        broadcast("game-started", { instanceId: id });
      } catch (e) {
        broadcast("game-exited", { instanceId: id, code: null });
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

  const patchImport = (projectId: string, patch: Partial<PendingImport>) =>
    setImports((list) => list.map((p) => (p.projectId === projectId ? { ...p, ...patch } : p)));

  const startImport = useCallback(
    async (source: string, pack: PackHit, version?: Version) => {
      const id = pack.id;
      if (inFlight.current.has(id)) return;
      inFlight.current.add(id);
      const pending: PendingImport = { source, projectId: id, title: pack.title, iconUrl: pack.iconUrl, version, done: 0, total: 0, error: "" };
      setImports((list) => [pending, ...list.filter((p) => p.projectId !== id)]);
      try {
        const inst = await sources.importModpack(source, id, version?.id, ({ done, total }) => patchImport(id, { done, total }));
        select(inst.id);
        await refresh();
        setImports((list) => list.filter((p) => p.projectId !== id));
      } catch (e) {
        patchImport(id, { error: errorMessage(e) });
      } finally {
        inFlight.current.delete(id);
      }
    },
    [refresh, select]
  );

  const dismissImport = useCallback((projectId: string) => setImports((list) => list.filter((p) => p.projectId !== projectId)), []);

  useEffect(() => {
    refresh();
    const unlisten = [
      gameLogs.listen(),
      launcher.onGameExit(({ id, code }) => {
        broadcast("game-exited", { instanceId: id, code });
        if (!gameLogs.exited(id, code) && code) setError({ id, message: `Game crashed with exit code ${code}. Its log is in Console.` });
        refresh();
      }),
    ];
    return () => unlisten.forEach((u) => void u.then((f) => f()));
  }, [refresh]);

  const value = useMemo<LauncherValue>(() => {
    const instances = snapshot?.instances ?? [];
    const selected =
      instances.find((i) => i.id === selectedId) ?? [...instances].sort((a, b) => recency(b) - recency(a))[0];
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
      imports,
      startImport,
      dismissImport,
    };
  }, [snapshot, selectedId, select, refresh, launch, busyId, error, clearError, saveSettings, imports, startImport, dismissImport]);

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
  return useMemo(() => [...(snapshot?.instances ?? [])].sort((a, b) => recency(b) - recency(a)), [snapshot]);
}
