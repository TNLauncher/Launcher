// Modpack installs in a Zustand store: a download reports every file, and only the row
// showing that pack's progress re-renders via its selector.
import { create } from "zustand";
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
}

const NONE: ImportProgress = { done: 0, total: 0, manual: [] };

interface ImportsState {
  list: PendingImport[];
  progress: Record<string, ImportProgress>;
  /** The pack whose hand-download list is shown. */
  manualOpen: string | null;
}

const useImportsStore = create<ImportsState>(() => ({
  list: [],
  progress: {},
  manualOpen: null,
}));

const pendingProgress = new Map<string, ImportProgress>();
/** Packs whose hand-download list already popped up once; later it opens only on request. */
const prompted = new Set<string>();
let frame = 0;

const missing = (p: ImportProgress | undefined) => p?.manual.filter((f) => !f.done).length ?? 0;

export const imports = {
  has: (projectId: string) => useImportsStore.getState().list.some((p) => p.projectId === projectId && !p.error),

  start(pending: PendingImport) {
    pendingProgress.delete(pending.projectId);
    prompted.delete(pending.projectId);
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
      useImportsStore.setState((s) => {
        let manualOpen = s.manualOpen;
        for (const [id, p] of Object.entries(patch)) {
          if (missing(p) && !prompted.has(id)) {
            prompted.add(id);
            manualOpen ??= id;
          }
          // Everything arrived: the list has nothing left to ask for.
          if (manualOpen === id && !missing(p)) manualOpen = null;
        }
        return { progress: { ...s.progress, ...patch }, manualOpen };
      });
    });
  },

  fail: (projectId: string, error: string) =>
    useImportsStore.setState((s) => ({
      list: s.list.map((p) => (p.projectId === projectId ? { ...p, error } : p)),
      manualOpen: s.manualOpen === projectId ? null : s.manualOpen,
    })),

  showManual: (projectId: string) => useImportsStore.setState({ manualOpen: projectId }),
  hideManual: () => useImportsStore.setState({ manualOpen: null }),

  dismiss(projectId: string) {
    pendingProgress.delete(projectId);
    useImportsStore.setState((s) => {
      const { [projectId]: _, ...rest } = s.progress;
      return {
        list: s.list.filter((p) => p.projectId !== projectId),
        progress: rest,
        manualOpen: s.manualOpen === projectId ? null : s.manualOpen,
      };
    });
  },
};

/** The import whose hand-download list is open, if any. */
export const useManualOpen = () => useImportsStore((s) => s.list.find((p) => p.projectId === s.manualOpen));

/** Installs in flight (or failed, until dismissed). Changes on start, failure and finish only. */
export const useImports = () => useImportsStore((s) => s.list);

/** Re-renders only when this pack's install starts, fails or finishes. */
export const useInstalling = (projectId: string) =>
  useImportsStore((s) => s.list.some((p) => p.projectId === projectId && !p.error));

export const useImportProgress = (projectId: string) =>
  useImportsStore((s) => s.progress[projectId] ?? NONE);
