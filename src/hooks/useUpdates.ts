import { useQuery } from "@tanstack/react-query";
import { check } from "@tauri-apps/plugin-updater";
import { sources } from "@/api/sources";
import { usePlugins } from "@/hooks/useSource";

/** Whether version `a` is newer than `b`, comparing dot-separated numbers ("1.10.0" > "1.9"); a suffix after `-` or `+` is ignored. */
export function isNewer(a: string, b: string): boolean {
  const parts = (v: string) => v.split(/[-+]/)[0].split(".").map((n) => parseInt(n, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

/** The plugin store's catalog, shared by the Store tab and the sidebar dot. */
export const usePluginStore = () => useQuery({ queryKey: ["plugin-store"], queryFn: sources.pluginStore, staleTime: 5 * 60_000 });

/** How many installed store plugins have a newer version in the store. */
export function usePluginUpdateCount(): number {
  const installed = usePlugins().data ?? [];
  const store = usePluginStore().data ?? [];
  return store.filter((e) => installed.some((p) => p.id === e.manifest.id && !p.bundled && isNewer(e.manifest.version, p.version))).length;
}

/** The launcher's own update check, shared by Settings and the sidebar dot; data is null when up to date. */
export const useLauncherUpdateQuery = () => useQuery({ queryKey: ["launcher-update"], queryFn: () => check(), staleTime: 30 * 60_000, retry: false });

/** Whether a newer launcher build is out; false while checking or when the check fails. */
export const useLauncherUpdate = (): boolean => !!useLauncherUpdateQuery().data;
