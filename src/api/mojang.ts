import { launcher } from "./launcher";

export interface ManifestVersion {
  id: string;
  type: "release" | "snapshot" | "old_beta" | "old_alpha";
}

export interface PatchNote {
  title: string;
  version: string;
  date: string;
}

let manifest: Promise<ManifestVersion[]> | null = null;

/** Cached for the session; versions don't change often enough to refetch. */
export function getVersions(): Promise<ManifestVersion[]> {
  manifest ??= launcher
    .fetchJson<{ versions: ManifestVersion[] }>("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
    .then((m) => m.versions)
    .catch((e) => {
      manifest = null;
      throw e;
    });
  return manifest;
}

export async function getPatchNotes(limit = 3): Promise<PatchNote[]> {
  const data = await launcher.fetchJson<{ entries: PatchNote[] }>("https://launchercontent.mojang.com/v2/javaPatchNotes.json");
  return data.entries.slice(0, limit);
}
