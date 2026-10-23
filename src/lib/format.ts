import type { Instance, Loader, Stage } from "@/types";

export const LOADERS: Record<Loader, string> = { vanilla: "Vanilla", fabric: "Fabric", quilt: "Quilt" };
export const LOADER_ICON: Record<Loader, string> = { vanilla: "deployed_code", fabric: "texture", quilt: "grid_view" };
export const STAGE_LABEL: Record<Stage, string> = {
  resolving: "Resolving version",
  java: "Downloading Java",
  libraries: "Libraries",
  assets: "Assets",
  starting: "Starting",
};

export function lastPlayed(ts: number): string {
  if (!ts) return "Never played";
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "Played just now";
  if (s < 3600) return `Played ${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `Played ${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return "Played yesterday";
  return `Played ${new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export const playTime = (sec: number) =>
  sec < 3600 ? `${Math.round(sec / 60)} min played` : `${(sec / 3600).toFixed(sec < 36000 ? 1 : 0)} h played`;

/** Sort key for "recent": last launch, or creation for never-played instances. */
export const recency = (i: Instance) => Math.max(i.lastPlayed, i.created);

export const loaderLabel = (i: Instance) => (i.loader === "vanilla" ? "Vanilla" : `${LOADERS[i.loader]} ${i.loaderVersion}`);

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(n);

export const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];

/** "3 days ago" for an ISO date. */
export function ago(iso: string): string {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  const [unit, size] = STEPS.find(([, n]) => Math.abs(s) >= n) ?? ["minute", 60];
  return rtf.format(Math.round(s / size), unit);
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
