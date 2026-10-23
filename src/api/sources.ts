// Content sources (Modrinth...) behind the plugin API. Mirrors src-tauri/src/plugins/api.rs.
import { Channel } from "@tauri-apps/api/core";
import { call } from "./ipc";
import type { ContentKind, ImportProgress, Instance } from "@/types";

export type ProjectKind = ContentKind | "modpack";

export interface Choice {
  id: string;
  label: string;
}

export interface SourceInfo {
  id: string;
  name: string;
  /** First = default. */
  sorts: Choice[];
  /** A kind missing here is not offered by the source. */
  categories: Partial<Record<ProjectKind, Choice[]>>;
}

export interface PluginEntry {
  id: string;
  name: string;
  enabled: boolean;
  source: SourceInfo | null;
}

export interface SearchQuery {
  kind: ProjectKind;
  query: string;
  gameVersion?: string;
  /** Content: the instance loader. Modpacks: a filter, omitted = any the launcher runs. */
  loader?: string;
  categories: string[];
  sort?: string;
  offset?: number;
  limit: number;
}

export interface Hit {
  id: string;
  slug: string;
  title: string;
  author: string;
  description: string;
  iconUrl: string | null;
  downloads: number;
  follows: number;
  categories: string[];
  /** Oldest first. */
  gameVersions: string[];
  updated: string;
  bannerUrl: string | null;
  /** 0xRRGGBB. */
  color: number | null;
}

export interface Page {
  hits: Hit[];
  offset: number;
  total: number;
}

export interface GalleryImage {
  url: string;
  rawUrl: string;
  featured: boolean;
  title: string | null;
  description: string | null;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  /** Markdown. */
  body: string;
  iconUrl: string | null;
  color: number | null;
  published: string;
  license: string | null;
  /** The project's page on the source first. */
  links: { label: string; icon: string; url: string }[];
  gallery: GalleryImage[];
}

export interface ProjectSummary {
  id: string;
  title: string;
  description: string;
  iconUrl: string | null;
  kind: string;
  url: string;
}

export interface Version {
  id: string;
  name: string;
  number: string;
  channel: "release" | "beta" | "alpha";
  gameVersions: string[];
  loaders: string[];
  published: string;
  changelog: string | null;
  files: { url: string; filename: string; primary: boolean; size: number }[];
  dependencies: { projectId: string | null; fileName: string | null; kind: "required" | "optional" | "incompatible" | "embedded" }[];
}

export interface IdentifiedFile {
  project: ProjectSummary;
  versionNumber: string;
}

export const primaryFile = (v: Pick<Version, "files">) => v.files.find((f) => f.primary) ?? v.files[0];

export const sources = {
  listPlugins: () => call<PluginEntry[]>("list_plugins"),
  setPluginEnabled: (id: string, enabled: boolean) => call<void>("set_plugin_enabled", { id, enabled }),

  search: (source: string, query: SearchQuery) => call<Page>("source_search", { source, query }),
  project: (source: string, id: string) => call<Project>("source_project", { source, id }),
  projects: (source: string, ids: string[]) => call<ProjectSummary[]>("source_projects", { source, ids }),
  /** Newest first. */
  versions: (source: string, project: string, filter: { kind: ProjectKind; gameVersion?: string; loader?: string }) =>
    call<Version[]>("source_versions", { source, project, filter }),

  /** Installed files of one kind the source recognises, by file name. */
  identifyContent: (source: string, id: string, kind: ContentKind) => call<Record<string, IdentifiedFile>>("identify_content", { source, id, kind }),
  /** Newest fitting build, plus required dependencies for mods; `skip` = projects already installed. */
  installContent: (source: string, id: string, kind: ContentKind, project: string, skip: string[] = []) =>
    call<void>("install_content", { source, id, kind, project, skip }),
  /** New instance from a modpack; `version` is a version id, omitted = newest. */
  importModpack: (source: string, project: string, version: string | undefined, onProgress: (p: ImportProgress) => void) => {
    const channel = new Channel<ImportProgress>();
    channel.onmessage = onProgress;
    return call<Instance>("import_modpack", { source, project, version, onProgress: channel });
  },
};
