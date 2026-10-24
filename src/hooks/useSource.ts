import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { sources, type Hit, type ProjectKind, type SourceInfo } from "@/api/sources";

export const usePlugins = () => useQuery({ queryKey: ["plugins"], queryFn: sources.listPlugins, staleTime: Infinity });

const CHOICE_KEY = "source";
/** Used until the user picks one; any other enabled source otherwise. */
const DEFAULT_SOURCE = "modrinth";
const listeners = new Set<() => void>();

function readChoice(): string {
  try {
    return localStorage.getItem(CHOICE_KEY) ?? DEFAULT_SOURCE;
  } catch {
    return DEFAULT_SOURCE;
  }
}

/** Makes `id` the source catalogs browse, remembered across starts. */
export function chooseSource(id: string) {
  try {
    localStorage.setItem(CHOICE_KEY, id);
  } catch {
    /* storage unavailable: the choice lasts this session only */
  }
  listeners.forEach((f) => f());
}

/** Enabled content sources. */
export function useSources(): SourceInfo[] {
  return (usePlugins().data ?? []).flatMap((p) => (p.enabled && p.source ? [p.source] : []));
}

/** The content source catalogs browse; null while loading or when every source is turned off. */
export function useSource(): SourceInfo | null {
  const list = useSources();
  const chosen = useSyncExternalStore((f) => (listeners.add(f), () => listeners.delete(f)), readChoice);
  return list.find((s) => s.id === chosen) ?? list.find((s) => s.id === DEFAULT_SOURCE) ?? list[0] ?? null;
}

/** Whether source `id` is installed and turned on. */
export function useSourceEnabled(id: string | undefined): boolean {
  return !!id && !!usePlugins().data?.some((p) => p.id === id && p.enabled);
}

/** Starred projects of one source and kind, newest first; `toggle` is stable. */
export function useFavorites(source: string, kind: ProjectKind) {
  const qc = useQueryClient();
  const all = useQuery({ queryKey: ["favorites"], queryFn: sources.listFavorites, staleTime: Infinity }).data;
  const hits = useMemo(() => (all ?? []).filter((f) => f.source === source && f.kind === kind).map((f) => f.hit), [all, source, kind]);
  const ids = useMemo(() => new Set(hits.map((h) => h.id)), [hits]);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const toggle = useCallback(
    (hit: Hit) => sources.setFavorite({ source, kind, hit }, !idsRef.current.has(hit.id)).then((list) => qc.setQueryData(["favorites"], list)),
    [qc, source, kind]
  );
  return { hits, ids, toggle };
}
