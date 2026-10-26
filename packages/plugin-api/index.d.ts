// TNLauncher plugin API, version 1. Mirrors src-tauri/src/plugins/{mod,api}.rs: keep them in sync.
//
// A plugin is a folder with `manifest.json` and an ES module (`main`, default `main.js`) exporting
// `activate(tn)`. It runs in a sandboxed iframe: no Tauri, no network except `tn.net.fetch` to the
// hosts its manifest lists. Pages it contributes are HTML files in the same folder, given the same
// `tn` global plus the launcher's CSS variables and base styles.
//
// Pages are sandboxed with an opaque origin, so loading the plugin's own files is cross-origin:
// use `<script type="module">` (or `crossorigin` on classic scripts), and `crossorigin` on
// `<link rel="stylesheet">` and `<img>` pointing into the plugin folder. Inline scripts and styles work.

export type ContentKind = "mod" | "resourcepack" | "shader";
export type ProjectKind = ContentKind | "modpack";

export interface Choice {
  id: string;
  label: string;
}

export interface Manifest {
  /** `[a-z0-9-]`, unique. */
  id: string;
  name: string;
  version: string;
  /** Must be 1. */
  api: 1;
  description?: string;
  /** ES module with `activate(tn)`; default `main.js`. */
  main?: string;
  contributes?: {
    /** Makes the plugin a content source: `activate` must call `tn.sources.register`. */
    source?: {
      /** Search sort orders, first = default. */
      sorts: Choice[];
      /** Browse categories per kind; a kind missing here is not offered. */
      categories: Partial<Record<ProjectKind, Choice[]>>;
    };
    /** Sidebar pages. */
    pages?: View[];
    /** Tabs on every instance page; `tn.context.instance` is that instance's id. */
    instanceTabs?: (View & {
      /** Also a button in the instance header that opens the tab. */
      header?: boolean;
      /** Offered next to the error when the game crashes or fails to start. */
      crash?: boolean;
    })[];
    /** Makes the plugin an account provider: these fields make up its sign-in form. `activate` must call `tn.accounts.register`. */
    account?: { fields: { key: string; label: string; hint?: string; type: "text" | "secret" }[] };
    /** Options the user fills in Settings; read them with `tn.settings.get()`. */
    settings?: {
      /** `[A-Za-z0-9_-]`. */
      key: string;
      label: string;
      hint?: string;
      type: "text" | "secret" | "toggle" | "select";
      default?: string | boolean;
      /** Required when `type` is `select`. */
      options?: Choice[];
    }[];
  };
  permissions?: {
    /** Hosts `tn.net.fetch` may reach and pages may show images from; `*.example.com` allowed. HTTPS only. */
    hosts?: string[];
    /** URL prefixes the launcher may download files from on the plugin's behalf. */
    downloads?: string[];
    /** Read instances (`tn.instances`) and receive `game-started` / `game-exited`. */
    instances?: boolean;
    /** Change instances (`tn.content`, `tn.instances.repair` / `restoreFiles` / `change`); needs `instances` too. */
    content?: boolean;
    /** Set the Discord status (`tn.presence`). */
    presence?: boolean;
    /** Load a Java agent into the game (`AccountSession.javaAgent`); it runs code in the game. */
    jvm?: boolean;
  };
}

export interface View {
  id: string;
  title: string;
  /** Material Symbols name. */
  icon: string;
  /** HTML file in the plugin folder. */
  entry: string;
}

export interface Instance {
  id: string;
  name: string;
  /** Minecraft version. */
  version: string;
  loader: "vanilla" | "fabric" | "quilt" | "forge" | "neoforge" | "liteloader";
  loaderVersion: string;
  /** Unix seconds, 0 = never. */
  lastPlayed: number;
  playSeconds: number;
  created: number;
  /** `data:image/...` URL or "". */
  icon: string;
  /** Modpack it was installed from. */
  pack: { source: string; project: string; version: string } | null;
  /** Enabled mod jars. */
  mods: number;
}

/** A version requirement as a mod wrote it. */
export type Range = { kind: "any" } | { /** Any of these; each is space-separated ANDs (`>=1.2 <2`). */ kind: "fabric"; value: string[] } | { /** `[1.2,2)`; a bare version only recommends. */ kind: "maven"; value: string };

export interface ModMeta {
  id: string;
  name: string;
  version: string;
  /** Other ids it answers to, with versions: `provides` and the jars bundled inside it. */
  provides: [string, string][];
  depends: { id: string; range: Range }[];
  breaks: { id: string; range: Range }[];
  /** Mixin config files at the jar root. */
  mixins: string[];
}

export interface ModEntry {
  file: string;
  enabled: boolean;
  /** Set for a mod of the instance's loader. */
  meta: ModMeta | null;
  /** The loader a jar for another loader is made for. */
  foreign: "Fabric" | "Quilt" | "Forge" | "NeoForge" | null;
  /** Not a readable archive. */
  broken: boolean;
}

export interface MissingFile {
  path: string;
  name: string;
  /** The launcher may download it; otherwise only by hand from `page`. */
  downloadable: boolean;
  page: string | null;
}

export interface RepairProgress {
  step: "game" | "pack" | "mods";
  /** Install stage while `step` is "game". */
  stage: "resolving" | "java" | "loader" | "libraries" | "assets" | "starting" | null;
  done: number;
  total: number;
}

export interface RepairReport {
  /** Game, loader, library and asset files downloaded again. */
  gameFiles: number;
  packFiles: number;
  /** Half-downloaded leftovers removed. */
  partials: number;
  /** Unreadable jars the pack cannot restore. */
  broken: string[];
  /** Why pack files could not be checked. */
  packError: string | null;
}

export interface GameEvents {
  /** Play was pressed; downloads may follow. */
  "game-launching": { instanceId: string };
  "game-started": { instanceId: string };
  /** One line of game stdout/stderr (`err` = stderr). Needs `permissions.instances`. */
  "game-log": { instanceId: string; line: string; err: boolean };
  /** The game stopped, or failed to start (`code` null). */
  "game-exited": { instanceId: string; code: number | null };
  /** Progress of a `tn.instances.repair` this plugin started. */
  "repair-progress": { instance: string; progress: RepairProgress };
  /** Fired in every frame of this plugin when `tn.storage.set` writes or removes a key. */
  "storage-changed": { key: string; value: unknown };
  /** Fired in every frame of this plugin when the user changes a setting in Settings. */
  "settings-changed": { key: string; value: string | boolean };
}

/** What Discord shows (`tn.presence.set`); each line 2–128 characters. */
export interface Presence {
  details: string;
  state: string;
  /** Unix seconds: shows elapsed time, and `details` replaces the app name in the member list. */
  startedAt?: number;
  /** Hover text of the logo. */
  tooltip?: string;
}

export interface SearchQuery {
  kind: ProjectKind;
  query: string;
  gameVersion?: string | null;
  /** Content: the instance's loader. Modpacks: a filter, missing = any the launcher runs (fabric, quilt). */
  loader?: string | null;
  categories: string[];
  sort: string;
  offset: number;
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
  /** ISO date. */
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
  /** Markdown; HTML inside is sanitized by the launcher. */
  body: string;
  iconUrl: string | null;
  color: number | null;
  published: string;
  license: string | null;
  /** The project's page on the source first. */
  links: { label: string; /** Material Symbols name. */ icon: string; url: string }[];
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

export interface VersionFile {
  url: string;
  filename: string;
  primary: boolean;
  size: number;
}

export interface Dependency {
  projectId: string | null;
  /** Set for files not hosted on the source. */
  fileName: string | null;
  kind: "required" | "optional" | "incompatible" | "embedded";
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
  files: VersionFile[];
  dependencies: Dependency[];
}

export interface VersionFilter {
  kind: ProjectKind;
  gameVersion: string | null;
  loader: string | null;
}

export interface Identified {
  projectId: string;
  versionNumber: string;
}

/** What a modpack archive asks for; the launcher downloads and unpacks it. */
export interface PackPlan {
  name: string;
  gameVersion: string;
  /** `fabric`, `quilt`, or "" for vanilla. */
  loader: string;
  loaderVersion: string;
  files: { /** Relative to the instance. */ path: string; /** Mirrors; the first on an allowed download host is used. */ urls: string[]; size: number | null; /** With empty `urls`: the page the user downloads it from by hand (into Downloads). */ page?: string | null; /** Hex SHA-1: the download is checked against it, and repairs rehash with it. */ sha1?: string | null }[];
  /** Archive folders copied over the instance, later ones win. */
  overrides: string[];
}

/** What `tn.sources.register` takes. Throw to report an error. */
export interface ContentSource {
  search(query: SearchQuery): Promise<Page>;
  project(id: string): Promise<Project>;
  /** Any number of ids, any order. */
  projects(ids: string[]): Promise<ProjectSummary[]>;
  /** Newest first. */
  versions(project: string, filter: VersionFilter): Promise<Version[]>;
  /** Keyed by the given SHA-1; unknown files are left out. */
  identify(sha1: string[]): Promise<Record<string, Identified>>;
  /** `root`: the archive's top-level text files by name. */
  planPack(root: Record<string, string>): Promise<PackPlan>;
}

/** A stored account as `session` receives it. */
export interface StoredAccount {
  name: string;
  /** 32 hex digits. */
  uuid: string;
  /** Whatever `login` or the last `session` returned as `data`. */
  data: unknown;
}

export interface AccountSession {
  /** 1–16 of `[A-Za-z0-9_]`. */
  name: string;
  uuid: string;
  /** Passed to the game as the access token. */
  token: string;
  /** `mojang` for Yggdrasil servers (Ely.by...), `legacy` for none. */
  userType: "mojang" | "legacy";
  /** Replaces the stored data, e.g. after a refresh. */
  data?: unknown;
  /** A jar from `permissions.downloads`, loaded as `-javaagent:<jar>=<options>`; needs `permissions.jvm`. */
  javaAgent?: { url: string; filename: string; options?: string };
}

/** What `tn.accounts.register` takes. Throw to report an error (shown at sign-in or launch). */
export interface AccountProvider {
  /** `fields`: the sign-in form's values by key. */
  login(fields: Record<string, string>): Promise<{ name: string; uuid: string; data?: unknown }>;
  /** Before each launch: validate or refresh, then say how to start the game. */
  session(account: StoredAccount): Promise<AccountSession>;
  /** Optional: the skin shown in Profiles; `slim` = Alex model. The launcher fetches `url` itself, so its host must be in `permissions.hosts`. */
  skin?(account: StoredAccount): Promise<{ url: string; slim?: boolean } | null>;
}

export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface FetchResponse {
  status: number;
  ok: boolean;
  contentType: string;
  /** Response headers with lowercase names. */
  headers: Record<string, string>;
  text(): string;
  json<T = unknown>(): T;
  bytes(): Uint8Array;
  arrayBuffer(): ArrayBuffer;
}

export interface TN {
  apiVersion: 1;
  /** Where this frame is shown. */
  context: { /** Set in instance tabs. */ instance: string | null };
  /** The plugin's own JSON store (1 MiB). */
  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    /** `null`/`undefined` removes the key. */
    set(key: string, value: unknown): Promise<void>;
  };
  /** Values of `contributes.settings`, defaulted (`default` or "" / false). */
  settings: { get(): Promise<Record<string, string | boolean>> };
  /** Needs `permissions.instances`. */
  instances: {
    list(): Promise<Instance[]>;
    get(id: string): Promise<Instance>;
    /** Tail of the instance's last `launcher.log`; "" if never launched. */
    readLog(id: string): Promise<string>;
    /** Every jar in `mods/`, on and off, read the way the instance's loader reads it. */
    mods(id: string): Promise<ModEntry[]>;
    /** Crash report and JVM error file the last session wrote, joined; "" when none. */
    crashReports(id: string): Promise<string>;
    /** Files of the instance's modpack gone from disk; [] when it is not from a pack. */
    missingFiles(id: string): Promise<MissingFile[]>;
    launchSettings(id: string): Promise<{ ramMb: number; /** The user picked their own Java. */ customJava: boolean }>;
    /** Needs `permissions.content`. Rehashes game and pack files and downloads damaged ones; never changes which mods are installed. */
    repair(id: string): Promise<RepairReport>;
    /** Needs `permissions.content`. Downloads the missing pack files the launcher may fetch; resolves with how many. */
    restoreFiles(id: string): Promise<number>;
    /** Needs `permissions.content`. Resolves with what changed, for people. */
    change(id: string, change: { kind: "setRam"; mb: number } | { kind: "autoJava" } | { kind: "updateLoader" }): Promise<string>;
  };
  /** Content of an instance. `identify` needs `permissions.instances`, the rest `permissions.content`; changes fail while the game runs. */
  content: {
    /** Files the source recognises, by file name. */
    identify(instance: string, source: string, kind: ContentKind): Promise<Record<string, { project: ProjectSummary; versionNumber: string }>>;
    /** Installs a fitting build (newest when no `version`) with its required mods; `replace` swaps that file in place. */
    install(p: { instance: string; source: string; kind: ContentKind; project: string; version?: string; replace?: string }): Promise<void>;
    setEnabled(instance: string, kind: ContentKind, file: string, enabled: boolean): Promise<void>;
    delete(instance: string, kind: ContentKind, file: string): Promise<void>;
  };
  /** Needs `permissions.instances` for game events. Returns a function that stops listening. */
  events: {
    on<K extends keyof GameEvents>(name: K, cb: (payload: GameEvents[K]) => void): () => void;
    on<T = unknown>(name: string, cb: (payload: T) => void): () => void;
    /** Sends a custom event to every frame (`main` and open pages) of this plugin. */
    emit(name: string, payload?: unknown): void;
  };
  /** Needs `permissions.presence`. Last call wins among plugins. */
  presence: { set(p: Presence): Promise<void>; clear(): Promise<void> };
  /** Opens an http(s) page in the system browser. */
  open(url: string): Promise<void>;
  sources: {
    register(source: ContentSource): void;
    /** Browse another enabled source. */
    search(source: string, query: SearchQuery): Promise<Page>;
    versions(source: string, project: string, filter: VersionFilter): Promise<Version[]>;
  };
  accounts: { register(provider: AccountProvider): void };
  net: { fetch(url: string, init?: FetchInit): Promise<FetchResponse> };
  /** Printed to the launcher's log. */
  log(...args: unknown[]): Promise<void>;
}

declare global {
  const tn: TN;
}
