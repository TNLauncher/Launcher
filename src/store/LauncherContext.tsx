import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { launcher } from "@/api/launcher";
import { BackendError } from "@/api/ipc";
import { toast } from "@/components/ui/Toast";
import { broadcast } from "@/plugins/bridge";
import { gameLogs } from "./gameLogs";
import { imports, type PackHit, type PendingImport } from "./imports";
import { sources, type Version } from "@/api/sources";
import { errorMessage, recency } from "@/lib/format";
import type { ImportProgress, Instance, Settings, Snapshot, Stage } from "@/types";

export interface Progress {
  stage: Stage;
  done: number;
  total: number;
}

export interface LaunchError {
  id: string;
  message: string;
}

export interface LauncherState {
  snapshot: Snapshot | null;
  initError: unknown;
  selectedId: string;
  /** Id of the instance installing/starting; its progress is in `useProgress()`. */
  busyId: string | null;
  progress: Progress | null;
  error: LaunchError | null;
  select(id: string): void;
  refresh(): Promise<void>;
  /** `world`: a `saves/` folder to open straight away. */
  launch(id: string, world?: string): Promise<void>;
  clearError(): void;
  saveSettings(settings: Settings): Promise<void>;
  isRunning(id: string): boolean;
  /** Starts a background install (state in `@/store/imports`); a pack already installing is ignored. */
  startImport(source: string, pack: PackHit, version?: Version): void;
  /** Same for a modpack archive on disk; keyed by its path. */
  startFileImport(path: string): void;
}

const STARTING: Progress = { stage: "resolving", done: 0, total: 0 };
const SELECTED_KEY = "selected";

function readSelected(): string {
  try {
    return localStorage.getItem(SELECTED_KEY) ?? "";
  } catch {
    return "";
  }
}

let frame = 0;

export const useLauncher = create<LauncherState>((set, get) => ({
  snapshot: null,
  initError: null,
  selectedId: readSelected(),
  busyId: null,
  progress: null,
  error: null,

  refresh: async () => {
    const snapshot = await launcher.getState();
    set({ snapshot, initError: null });
  },

  select: (id: string) => {
    set({ selectedId: id });
    try {
      localStorage.setItem(SELECTED_KEY, id);
    } catch {
      /* storage unavailable: selection just won't persist */
    }
  },

  launch: async (id: string, world?: string) => {
    const { select, refresh } = get();
    select(id);
    set({ error: null, busyId: id, progress: STARTING });
    broadcast("game-launching", { instanceId: id });
    gameLogs.reset(id);
    // Backend reports every downloaded file (thousands for assets): commit at most once per frame.
    let latest = STARTING;
    try {
      await launcher.launch(id, (e) => {
        if (e.event !== "progress") return;
        latest = e.data;
        frame ||= requestAnimationFrame(() => {
          frame = 0;
          set({ progress: latest });
        });
      }, world);
      broadcast("game-started", { instanceId: id });
    } catch (e) {
      broadcast("game-exited", { instanceId: id, code: null });
      set({ error: { id, message: errorMessage(e) } });
    } finally {
      cancelAnimationFrame(frame);
      frame = 0;
      set({ busyId: null, progress: null });
      await refresh();
    }
  },

  saveSettings: async (settings: Settings) => {
    set((s) => (s.snapshot ? { snapshot: { ...s.snapshot, settings } } : s));
    await launcher.saveSettings(settings);
  },

  clearError: () => set({ error: null }),

  isRunning: (id: string) => get().snapshot?.running.includes(id) ?? false,

  startImport: (source: string, pack: PackHit, version?: Version) =>
    runImport({ source, projectId: pack.id, title: pack.title, iconUrl: pack.iconUrl, version, error: "" }, (onProgress) =>
      sources.importModpack(source, pack.id, version?.id, onProgress)
    ),

  startFileImport: (path: string) =>
    runImport({ source: "", projectId: path, title: path.split(/[\\/]/).pop() ?? path, iconUrl: null, file: true, error: "" }, (onProgress) =>
      launcher.importModpackFile(path, onProgress)
    ),
}));

/** Runs an install in the background, its state in `@/store/imports`; one already running for the same key is ignored. */
async function runImport(pending: PendingImport, run: (onProgress: (p: ImportProgress) => void) => Promise<Instance>) {
  const id = pending.projectId;
  if (imports.has(id)) return;
  imports.start(pending);
  try {
    const inst = await run((p) => imports.progress(id, p));
    const { select, refresh } = useLauncher.getState();
    select(inst.id);
    await refresh();
    imports.dismiss(id);
    toast(`${inst.name} is ready to play`);
  } catch (e) {
    if (e instanceof BackendError && e.kind === "cancelled") imports.dismiss(id);
    else imports.fail(id, errorMessage(e));
  }
}

/** Boots the initial snapshot and game listeners once at the app shell level. */
export function useLauncherInit() {
  const initError = useLauncher((s) => s.initError);
  if (initError) throw initError;

  useEffect(() => {
    const { refresh } = useLauncher.getState();
    // Without the first snapshot there is nothing to show: rethrow into render so the app-level boundary offers a retry.
    refresh().catch((e) => useLauncher.setState({ initError: e }));
    const unlisten = [
      gameLogs.listen(),
      launcher.onGameExit(({ id, code }) => {
        broadcast("game-exited", { instanceId: id, code });
        if (!gameLogs.exited(id, code) && code) {
          useLauncher.setState({ error: { id, message: `Game crashed with exit code ${code}. Its log is in Console.` } });
        }
        void refresh();
      }),
    ];
    return () => unlisten.forEach((u) => void u.then((f) => f()));
  }, []);
}

/** Progress of the running install/launch, null when idle. */
export const useProgress = () => useLauncher((s) => s.progress);

/** The instance the Play button targets. Re-evaluates only when instances or selectedId change. */
export function useSelectedInstance(): Instance | undefined {
  const instances = useLauncher((s) => s.snapshot?.instances);
  const selectedId = useLauncher((s) => s.selectedId);
  return useMemo(() => {
    if (!instances?.length) return undefined;
    return instances.find((i) => i.id === selectedId) ?? [...instances].sort((a, b) => recency(b) - recency(a))[0];
  }, [instances, selectedId]);
}

/** Instances sorted by most recently played. */
export function useRecentInstances(): Instance[] {
  const instances = useLauncher((s) => s.snapshot?.instances);
  return useMemo(() => [...(instances ?? [])].sort((a, b) => recency(b) - recency(a)), [instances]);
}
