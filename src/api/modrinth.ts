import { launcher } from "./launcher";
import type { Instance } from "@/types";

const API = "https://api.modrinth.com/v2";

export interface ModHit {
  project_id: string;
  title: string;
  author: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  categories: string[];
}

interface ModVersion {
  files: { url: string; filename: string; primary: boolean }[];
  dependencies: { project_id: string | null; dependency_type: "required" | "optional" | "incompatible" | "embedded" }[];
}

async function search(query: string, facets: string[][]): Promise<ModHit[]> {
  const params = new URLSearchParams({ limit: "20", index: "relevance", query, facets: JSON.stringify(facets) });
  const res = await launcher.fetchJson<{ hits: ModHit[] }>(`${API}/search?${params}`);
  return res.hits;
}

export function searchMods(inst: Pick<Instance, "version" | "loader">, query: string, category: string): Promise<ModHit[]> {
  const facets = [["project_type:mod"], [`versions:${inst.version}`], [`categories:${inst.loader}`]];
  if (category) facets.push([`categories:${category}`]);
  return search(query, facets);
}

/** Only loaders the launcher can run. */
const PACK_LOADERS = ["fabric", "quilt"];

export const searchModpacks = (query: string) =>
  search(query, [["project_type:modpack"], PACK_LOADERS.map((l) => `categories:${l}`)]);

/** Creates a new instance from the newest Fabric/Quilt version of a modpack. */
export async function importModpack(projectId: string): Promise<Instance> {
  const params = new URLSearchParams({ loaders: JSON.stringify(PACK_LOADERS) });
  const versions = await launcher.fetchJson<ModVersion[]>(`${API}/project/${encodeURIComponent(projectId)}/version?${params}`);
  const latest = versions[0];
  if (!latest) throw new Error("This modpack has no Fabric or Quilt version");
  const file = latest.files.find((f) => f.primary) ?? latest.files[0];
  return launcher.importModpack(file.url);
}

/** Installs the newest compatible file of a project plus its required dependencies. */
export async function installWithDependencies(projectId: string, inst: Instance, seen = new Set<string>()): Promise<void> {
  if (seen.has(projectId)) return;
  seen.add(projectId);
  const params = new URLSearchParams({ loaders: JSON.stringify([inst.loader]), game_versions: JSON.stringify([inst.version]) });
  const versions = await launcher.fetchJson<ModVersion[]>(`${API}/project/${encodeURIComponent(projectId)}/version?${params}`);
  const latest = versions[0];
  if (!latest) throw new Error(`No ${inst.loader} build for ${inst.version}`);
  const file = latest.files.find((f) => f.primary) ?? latest.files[0];
  await launcher.installMod(inst.id, file.url, file.filename);
  for (const dep of latest.dependencies) {
    if (dep.dependency_type === "required" && dep.project_id) await installWithDependencies(dep.project_id, inst, seen);
  }
}
