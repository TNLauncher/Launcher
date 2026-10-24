// Modpack installs outside React state: a download reports every file, and only the row
// showing that pack's progress should re-render, not every consumer of the launcher context.
import { useSyncExternalStore } from "react";
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

const NONE: ImportProgress = { done: 0, total: 0 };

let list: PendingImport[] = [];
const progress = new Map<string, ImportProgress>();
const listeners = new Set<() => void>();
let frame = 0;

const emit = () => listeners.forEach((l) => l());
const setList = (next: PendingImport[]) => ((list = next), emit());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

export const imports = {
  has: (projectId: string) => list.some((p) => p.projectId === projectId && !p.error),

  start(pending: PendingImport) {
    progress.delete(pending.projectId);
    setList([pending, ...list.filter((p) => p.projectId !== pending.projectId)]);
  },

  /** Per-file ticks: committed at most once per frame. */
  progress(projectId: string, p: ImportProgress) {
    progress.set(projectId, p);
    frame ||= requestAnimationFrame(() => ((frame = 0), emit()));
  },

  fail: (projectId: string, error: string) => setList(list.map((p) => (p.projectId === projectId ? { ...p, error } : p))),

  dismiss(projectId: string) {
    progress.delete(projectId);
    setList(list.filter((p) => p.projectId !== projectId));
  },
};

/** Installs in flight (or failed, until dismissed). Changes on start, failure and finish only. */
export const useImports = () => useSyncExternalStore(subscribe, () => list);

/** Re-renders only when this pack's install starts, fails or finishes. */
export const useInstalling = (projectId: string) => useSyncExternalStore(subscribe, () => imports.has(projectId));

export const useImportProgress = (projectId: string) => useSyncExternalStore(subscribe, () => progress.get(projectId) ?? NONE);
