import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { launcher } from "@/api/launcher";
import { BackendError } from "@/api/ipc";
import { toast } from "@/components/ui/Toast";
import { broadcast } from "@/plugins/bridge";
import { gameLogs } from "./gameLogs";
import { imports, type PackHit } from "./imports";
import { sources, type Version } from "@/api/sources";
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
  launch(id: string): Promise<void>;
  clearError(): void;
  saveSettings(settings: Settings): Promise<void>;
  isRunning(id: string): boolean;
  /** Starts a background install (state in `@/store/imports`); a pack already installing is ignored. */
  startImport(source: string, pack: PackHit, version?: Version): void;
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

  launch: async (id: string) => {
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
      });
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

  startImport: async (source: string, pack: PackHit, version?: Version) => {
    const id = pack.id;
    if (imports.has(id)) return;
    imports.start({ source, projectId: id, title: pack.title, iconUrl: pack.iconUrl, version, error: "" });
    try {
      const inst = await sources.importModpack(source, id, version?.id, (p) => imports.progress(id, p));
      get().select(inst.id);
      await get().refresh();
      imports.dismiss(id);
      toast(`${pack.title} is ready to play`);
    } catch (e) {
      if (e instanceof BackendError && e.kind === "cancelled") imports.dismiss(id);
      else imports.fail(id, errorMessage(e));
    }
  },
}));

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
