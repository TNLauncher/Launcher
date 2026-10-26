// Modpack installs in a Zustand store: a download reports every file, and only the row
// showing that pack's progress re-renders via its selector.
import { create } from "zustand";
import type { ManualDownload } from "@/api/ipc";
import type { Hit, Version } from "@/api/sources";
import type { ImportProgress } from "@/types";

export type PackHit = Pick<Hit, "id" | "title" | "iconUrl">;

/** A modpack download that has not become an instance yet. */
export interface PendingImport {
  source: string;
  projectId: string;
  title: string;
  iconUrl: string | null;
  /** Chosen pack version; undefined = newest. */
  version?: Version;
  error: string;
  /** Files to download by hand before a retry can succeed. */
  manual?: ManualDownload[];
}

const NONE: ImportProgress = { done: 0, total: 0 };

interface ImportsState {
  list: PendingImport[];
  progress: Record<string, ImportProgress>;
}

const useImportsStore = create<ImportsState>(() => ({
  list: [],
  progress: {},
}));

const pendingProgress = new Map<string, ImportProgress>();
let frame = 0;

export const imports = {
  has: (projectId: string) => useImportsStore.getState().list.some((p) => p.projectId === projectId && !p.error),

  start(pending: PendingImport) {
    pendingProgress.delete(pending.projectId);
    useImportsStore.setState((s) => {
      const { [pending.projectId]: _, ...rest } = s.progress;
      return {
        list: [pending, ...s.list.filter((p) => p.projectId !== pending.projectId)],
        progress: rest,
      };
    });
  },

  /** Per-file ticks: committed at most once per frame. */
  progress(projectId: string, p: ImportProgress) {
    pendingProgress.set(projectId, p);
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      const patch = Object.fromEntries(pendingProgress);
      pendingProgress.clear();
      useImportsStore.setState((s) => ({ progress: { ...s.progress, ...patch } }));
    });
  },

  fail: (projectId: string, error: string, manual?: ManualDownload[]) =>
    useImportsStore.setState((s) => ({
      list: s.list.map((p) => (p.projectId === projectId ? { ...p, error, manual } : p)),
    })),

  dismiss(projectId: string) {
    pendingProgress.delete(projectId);
    useImportsStore.setState((s) => {
      const { [projectId]: _, ...rest } = s.progress;
      return {
        list: s.list.filter((p) => p.projectId !== projectId),
        progress: rest,
      };
    });
  },
};

/** Installs in flight (or failed, until dismissed). Changes on start, failure and finish only. */
export const useImports = () => useImportsStore((s) => s.list);

/** Re-renders only when this pack's install starts, fails or finishes. */
export const useInstalling = (projectId: string) =>
  useImportsStore((s) => s.list.some((p) => p.projectId === projectId && !p.error));

export const useImportProgress = (projectId: string) =>
  useImportsStore((s) => s.progress[projectId] ?? NONE);
