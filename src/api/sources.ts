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
  /** Empty for a plugin that failed to load. */
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  /** Shipped with the launcher. */
  bundled: boolean;
  permissions: { hosts: string[]; downloads: string[]; instances: boolean; jvm: boolean; presence: boolean };
  source: SourceInfo | null;
  pages: PluginView[];
  instanceTabs: PluginView[];
  settings: PluginSetting[];
  /** Sign-in form when the plugin provides accounts. */
  account: { fields: PluginSetting[] } | null;
  /** Why the plugin did not load. */
  error: string | null;
}

/** A page or instance tab a plugin contributes. */
export interface PluginView {
  id: string;
  title: string;
  icon: string;
  entry: string;
}

export interface PluginSetting {
  key: string;
  label: string;
  hint: string;
  type: "text" | "secret" | "toggle" | "select";
  default?: string | boolean;
  options?: Choice[];
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

/** A starred catalog project; `hit` is a snapshot from when it was starred. */
export interface Favorite {
  source: string;
  kind: ProjectKind;
  hit: Hit;
}

export const primaryFile = (v: Pick<Version, "files">) => v.files.find((f) => f.primary) ?? v.files[0];

export const sources = {
  listPlugins: () => call<PluginEntry[]>("list_plugins"),
  reloadPlugins: () => call<PluginEntry[]>("reload_plugins"),
  removePlugin: (id: string) => call<PluginEntry[]>("remove_plugin", { id }),
  setPluginEnabled: (id: string, enabled: boolean) => call<void>("set_plugin_enabled", { id, enabled }),
  /** Values of a plugin's declared settings. */
  settings: (id: string) => call<Record<string, string | boolean>>("plugin_settings", { id }),
  setSetting: (id: string, key: string, value: string | boolean) => call<void>("set_plugin_setting", { id, key, value }),
  /** User plugins live there and load on the next start. */
  openPluginsDir: () => call<void>("open_plugins_dir"),

  /** Newest first. */
  listFavorites: () => call<Favorite[]>("list_favorites"),
  /** Stars or unstars; resolves with the new list. */
  setFavorite: (favorite: Favorite, on: boolean) => call<Favorite[]>("set_favorite", { favorite, on }),

  search: (source: string, query: SearchQuery) => call<Page>("source_search", { source, query }),
  project: (source: string, id: string) => call<Project>("source_project", { source, id }),
  projects: (source: string, ids: string[]) => call<ProjectSummary[]>("source_projects", { source, ids }),
  /** Newest first. */
  versions: (source: string, project: string, filter: { kind: ProjectKind; gameVersion?: string; loader?: string }) =>
    call<Version[]>("source_versions", { source, project, filter }),

  /** Installed files of one kind the source recognises, by file name. */
  identifyContent: (source: string, id: string, kind: ContentKind) => call<Record<string, IdentifiedFile>>("identify_content", { source, id, kind }),
  /** Installs a build (`version` id, omitted = newest), plus required dependencies for mods; `replace` swaps an existing file in place; `skip` = projects already installed. */
  installContent: (
    source: string,
    id: string,
    kind: ContentKind,
    project: string,
    skip: string[] = [],
    options?: { version?: string; replace?: string }
  ) => call<void>("install_content", { source, id, kind, project, skip, version: options?.version ?? null, replace: options?.replace ?? null }),
  /** New instance from a modpack; `version` is a version id, omitted = newest. */
  importModpack: (source: string, project: string, version: string | undefined, onProgress: (p: ImportProgress) => void) => {
    const channel = new Channel<ImportProgress>();
    channel.onmessage = onProgress;
    return call<Instance>("import_modpack", { source, project, version, onProgress: channel });
  },
  /** Stops `importModpack` for this project; it then rejects with kind `cancelled`. */
  cancelImport: (project: string) => call<void>("cancel_modpack_import", { project }),
};
