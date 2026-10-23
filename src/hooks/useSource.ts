import { useQuery } from "@tanstack/react-query";
import { sources, type SourceInfo } from "@/api/sources";

export const usePlugins = () => useQuery({ queryKey: ["plugins"], queryFn: sources.listPlugins, staleTime: Infinity });

/** The content source catalogs browse; null while loading or when every source is turned off. */
// ponytail: first enabled source wins; add a source picker once a second one exists.
export function useSource(): SourceInfo | null {
  return usePlugins().data?.find((p) => p.enabled && p.source)?.source ?? null;
}

/** Whether source `id` is installed and turned on. */
export function useSourceEnabled(id: string | undefined): boolean {
  return !!id && !!usePlugins().data?.some((p) => p.id === id && p.enabled);
}
