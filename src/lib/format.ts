import type { ContentKind, Instance, Loader, Stage } from "@/types";

export const LOADERS: Record<Loader, string> = { vanilla: "Vanilla", fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge", liteloader: "LiteLoader" };
/** Loader ids from a content source, which may name ones the launcher does not know. */
export const loaderList = (ids: string[]) => ids.map((l) => (LOADERS as Record<string, string>)[l] ?? l).join(", ");
export const LOADER_ICON: Record<Loader, string> = { vanilla: "deployed_code", fabric: "texture", quilt: "grid_view", forge: "construction", neoforge: "hardware", liteloader: "lightbulb" };
export const STAGE_LABEL: Record<Stage, string> = {
  resolving: "Resolving version",
  java: "Downloading Java",
  loader: "Installing mod loader",
  libraries: "Libraries",
  assets: "Assets",
  runtime: "Installing game",
  preparing: "Preparing game",
  starting: "Starting",
};

/** The stages a launch downloads through, with each one's share of the whole bar. */
const GAME_STAGES: [Stage, number][] = [["java", 0.15], ["loader", 0.1], ["libraries", 0.25], ["assets", 0.5]];
const RUNTIME_STAGES: [Stage, number][] = [["runtime", 0.3], ["java", 0.1], ["libraries", 0.15], ["assets", 0.3], ["preparing", 0.15]];
export const launchStages = (runtime: boolean) => (runtime ? RUNTIME_STAGES : GAME_STAGES);

export interface LaunchProgress {
  stage: Stage;
  done: number;
  total: number;
  /** The whole launch in 0..1; never goes back. */
  overall: number;
  /** Index in `launchStages` of the furthest stage reached; -1 before the first. */
  step: number;
}

/** Folds one backend tick into the launch's overall progress. Stages outside the list (resolving) keep the last value. */
export function advance(prev: LaunchProgress, tick: { stage: Stage; done: number; total: number }, stages: [Stage, number][]): LaunchProgress {
  if (tick.stage === "starting") return { ...tick, overall: 1, step: stages.length };
  const i = stages.findIndex(([st]) => st === tick.stage);
  if (i < 0) return { ...tick, overall: prev.overall, step: prev.step };
  const from = stages.slice(0, i).reduce((sum, [, w]) => sum + w, 0);
  const part = tick.total ? Math.min(tick.done / tick.total, 1) : 0;
  return { ...tick, overall: Math.max(prev.overall, from + stages[i][1] * part), step: Math.max(prev.step, i) };
}

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

export const loaderLabel = (i: Instance) => (i.runtime ? `${i.runtime.name} ${i.runtime.version}` : i.loader === "vanilla" ? "Vanilla" : `${LOADERS[i.loader]} ${i.loaderVersion}`);
/** The loader's name, or the runtime's for instances a plugin's game runs. */
export const loaderName = (i: Instance) => i.runtime?.name ?? LOADERS[i.loader];
/** Icon of an instance without its own: its loader's, or a runtime's. */
export const loaderIcon = (i: Instance) => (i.runtime ? "rocket_launch" : LOADER_ICON[i.loader]);

export const CONTENT_KINDS: Record<ContentKind, { label: string; one: string; noun: string; icon: string; folder: string }> = {
  mod: { label: "Mods", one: "mod", noun: "mods", icon: "extension", folder: "mods" },
  resourcepack: { label: "Resource packs", one: "resource pack", noun: "resource packs", icon: "texture", folder: "resourcepacks" },
  shader: { label: "Shaders", one: "shader", noun: "shaders", icon: "wb_twilight", folder: "shaderpacks" },
};

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(n);

export const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];

export const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });

/** "3 days ago" for an ISO date. */
export function ago(iso: string): string {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  const [unit, size] = STEPS.find(([, n]) => Math.abs(s) >= n) ?? ["minute", 60];
  return rtf.format(Math.round(s / size), unit);
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
