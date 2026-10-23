import { launcher } from "./launcher";
import type { ContentKind, ImportProgress, Instance } from "@/types";

const API = "https://api.modrinth.com/v2";

export interface ModHit {
  project_id: string;
  title: string;
  author: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  categories: string[];
  /** Supported Minecraft versions, oldest first. */
  versions: string[];
}

interface ModVersion {
  files: { url: string; filename: string; primary: boolean }[];
  dependencies: { project_id: string | null; dependency_type: "required" | "optional" | "incompatible" | "embedded" }[];
}

async function search(query: string, facets: string[][], limit = 20): Promise<ModHit[]> {
  const params = new URLSearchParams({ limit: String(limit), index: "relevance", query, facets: JSON.stringify(facets) });
  const res = await launcher.fetchJson<{ hits: ModHit[] }>(`${API}/search?${params}`);
  return res.hits;
}

/** Version loaders each kind is published under on Modrinth. */
const contentLoaders = (kind: ContentKind, inst: Pick<Instance, "loader">) =>
  kind === "mod" ? [inst.loader] : kind === "shader" ? ["iris", "optifine"] : ["minecraft"];

/** Mods, resource packs or shaders that fit an instance. */
export function searchContent(inst: Pick<Instance, "version" | "loader">, kind: ContentKind, query: string, category: string): Promise<ModHit[]> {
  const facets = [[`project_type:${kind}`], [`versions:${inst.version}`]];
  if (kind !== "resourcepack") facets.push(contentLoaders(kind, inst).map((l) => `categories:${l}`));
  if (category) facets.push([`categories:${category}`]);
  return search(query, facets, 30);
}

/** Modrinth versions matching file SHA-1s; files Modrinth does not know are missing from the map. */
export const identifyFiles = (hashes: string[]) =>
  launcher.fetchJson<Record<string, { id: string; project_id: string; version_number: string }>>(`${API}/version_files`, { hashes, algorithm: "sha1" });

const IDS_PER_REQUEST = 100;

/** `getProjects` for any number of ids, sorted by title. */
export async function getProjectsChunked(ids: string[]): Promise<ProjectSummary[]> {
  const chunks = Array.from({ length: Math.ceil(ids.length / IDS_PER_REQUEST) }, (_, i) => ids.slice(i * IDS_PER_REQUEST, (i + 1) * IDS_PER_REQUEST));
  const lists = await Promise.all(chunks.map(getProjects));
  return lists.flat().sort((a, b) => a.title.localeCompare(b.title));
}

/** Only loaders the launcher can run. */
export const PACK_LOADERS = ["fabric", "quilt"] as const;
export type PackLoader = (typeof PACK_LOADERS)[number];

/** Modrinth's modpack categories, in its own order. */
export const PACK_CATEGORIES: [string, string][] = [
  ["adventure", "Adventure"],
  ["challenging", "Challenging"],
  ["combat", "Combat"],
  ["kitchen-sink", "Kitchen sink"],
  ["lightweight", "Lightweight"],
  ["magic", "Magic"],
  ["multiplayer", "Multiplayer"],
  ["optimization", "Optimization"],
  ["quests", "Quests"],
  ["technology", "Technology"],
];

export type PackSort = "relevance" | "downloads" | "follows" | "newest" | "updated";

export interface PackHit extends ModHit {
  slug: string;
  follows: number;
  date_modified: string;
  featured_gallery: string | null;
  /** Brand color as 0xRRGGBB, or null. */
  color: number | null;
}

export interface PackFilters {
  query: string;
  gameVersion: string;
  loader: PackLoader | "";
  categories: string[];
  sort: PackSort;
}

export const PACK_PAGE = 20;

export interface PackPage {
  hits: PackHit[];
  offset: number;
  total_hits: number;
}

export function searchPacks(f: PackFilters, offset: number): Promise<PackPage> {
  const facets = [
    ["project_type:modpack"],
    f.loader ? [`categories:${f.loader}`] : PACK_LOADERS.map((l) => `categories:${l}`),
    ...f.categories.map((c) => [`categories:${c}`]),
  ];
  if (f.gameVersion) facets.push([`versions:${f.gameVersion}`]);
  const params = new URLSearchParams({
    query: f.query,
    index: f.sort,
    limit: String(PACK_PAGE),
    offset: String(offset),
    facets: JSON.stringify(facets),
  });
  return launcher.fetchJson<PackPage>(`${API}/search?${params}`);
}

export interface GalleryImage {
  url: string;
  raw_url: string;
  featured: boolean;
  title: string | null;
  description: string | null;
}

export interface Project {
  id: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  icon_url: string | null;
  color: number | null;
  downloads: number;
  followers: number;
  updated: string;
  published: string;
  categories: string[];
  loaders: string[];
  license: { id: string; name: string; url: string | null } | null;
  source_url: string | null;
  issues_url: string | null;
  wiki_url: string | null;
  discord_url: string | null;
  gallery: GalleryImage[];
}

export interface PackVersion {
  id: string;
  name: string;
  version_number: string;
  version_type: "release" | "beta" | "alpha";
  game_versions: string[];
  loaders: string[];
  date_published: string;
  downloads: number;
  changelog: string | null;
  files: { url: string; filename: string; primary: boolean; size: number }[];
  dependencies: { project_id: string | null; file_name: string | null }[];
}

export interface ProjectSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  project_type: string;
}

const enc = encodeURIComponent;

export const getProject = (id: string) => launcher.fetchJson<Project>(`${API}/project/${enc(id)}`);

/** Fabric/Quilt versions of a pack, newest first. */
export const getPackVersions = (id: string) =>
  launcher.fetchJson<PackVersion[]>(`${API}/project/${enc(id)}/version?${new URLSearchParams({ loaders: JSON.stringify(PACK_LOADERS) })}`);

export const getProjects = (ids: string[]) =>
  launcher.fetchJson<ProjectSummary[]>(`${API}/projects?${new URLSearchParams({ ids: JSON.stringify(ids) })}`);

/** Release Minecraft versions, newest first. */
export async function getGameVersions(): Promise<string[]> {
  const tags = await launcher.fetchJson<{ version: string; version_type: string }[]>(`${API}/tag/game_version`);
  return tags.filter((t) => t.version_type === "release").map((t) => t.version);
}

export const primaryFile = (v: Pick<PackVersion, "files">) => v.files.find((f) => f.primary) ?? v.files[0];

/** Creates a new instance from `version`, or from the newest Fabric/Quilt version when omitted. */
export async function importModpack(projectId: string, version: PackVersion | undefined, onProgress: (p: ImportProgress) => void): Promise<Instance> {
  const v = version ?? (await getPackVersions(projectId))[0];
  if (!v) throw new Error("This modpack has no Fabric or Quilt version");
  return launcher.importModpack(primaryFile(v).url, projectId, v.version_number, onProgress);
}

/** Installs the newest compatible file of a project (plus required dependencies for mods). */
export async function installContent(projectId: string, inst: Instance, kind: ContentKind, seen = new Set<string>()): Promise<void> {
  if (seen.has(projectId)) return;
  seen.add(projectId);
  const url = (versions: boolean) =>
    `${API}/project/${enc(projectId)}/version?${new URLSearchParams({
      loaders: JSON.stringify(contentLoaders(kind, inst)),
      ...(versions && { game_versions: JSON.stringify([inst.version]) }),
    })}`;
  let list = await launcher.fetchJson<ModVersion[]>(url(true));
  // Packs rarely break between versions and authors seldom tag every release: fall back to the newest.
  if (!list.length && kind !== "mod") list = await launcher.fetchJson<ModVersion[]>(url(false));
  const latest = list[0];
  if (!latest) throw new Error(`No ${kind === "mod" ? inst.loader : ""} build for ${inst.version}`.replace("  ", " "));
  const file = latest.files.find((f) => f.primary) ?? latest.files[0];
  await launcher.installContent(inst.id, kind, file.url, file.filename);
  if (kind !== "mod") return;
  for (const dep of latest.dependencies) {
    if (dep.dependency_type === "required" && dep.project_id) await installContent(dep.project_id, inst, kind, seen);
  }
}
