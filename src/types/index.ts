// Mirrors of the Rust models (src-tauri/src/models). Keep in sync when those change.

export type Loader = "vanilla" | "fabric" | "quilt" | "forge" | "neoforge" | "liteloader";
export interface LoaderBuild {
  version: string;
  /** Recommended: Forge's promoted build, everyone else's non-beta. */
  stable: boolean;
}
export type AfterLaunch = "hide" | "keep" | "close";

export interface Settings {
  javaPath: string;
  ramMb: number;
  jvmArgs: string;
  width: number;
  height: number;
  fullscreen: boolean;
  afterLaunch: AfterLaunch;
}

export interface Instance {
  id: string;
  name: string;
  version: string;
  loader: Loader;
  loaderVersion: string;
  /** Unix seconds, 0 = never. */
  lastPlayed: number;
  playSeconds: number;
  /** Unix seconds; 0 for old instances. */
  created: number;
  /** `data:image/...` URL; empty = loader icon. */
  icon: string;
  /** Modpack it was created from; null = made by hand. */
  pack: PackRef | null;
  settings: InstanceSettings;
}

/** Overrides of the global Settings; null = use the global value. */
export interface InstanceSettings {
  javaPath: string | null;
  ramMb: number | null;
  jvmArgs: string | null;
  width: number | null;
  height: number | null;
  fullscreen: boolean | null;
  /** Command the game runs through, e.g. `gamemoderun`; "" = none. */
  wrapper: string;
  /** `KEY=VALUE` per line. */
  env: string;
}

export interface PackRef {
  /** Content source plugin id. */
  source: string;
  project: string;
  /** Version number as shown to the user. */
  version: string;
}

/** Folder an instance file lives in: mods/, resourcepacks/, shaderpacks/. */
export type ContentKind = "mod" | "resourcepack" | "shader";

export interface ModFile {
  file: string;
  enabled: boolean;
  size: number;
}

export interface Screenshot {
  file: string;
  size: number;
  /** Unix seconds. */
  taken: number;
}

/** A signed-in account; tokens stay in Rust. */
export interface Account {
  id: string;
  /** `microsoft` or the plugin id that signed it in. */
  provider: string;
  providerName: string;
  name: string;
  /** 32 hex digits. */
  uuid: string;
  selected: boolean;
}

/** A skin; `slim` = Alex model (3px arms). */
export interface Skin {
  /** The PNG as a data URL, fetched and cached by the backend. */
  texture: string;
  slim: boolean;
}

export interface Snapshot {
  settings: Settings;
  /** The active account; null when not signed in. */
  account: Account | null;
  instances: Instance[];
  modCounts: Record<string, number>;
  running: string[];
  dataDir: string;
}

export interface DeviceCode {
  userCode: string;
  verificationUri: string;
}

export type Stage = "resolving" | "java" | "loader" | "libraries" | "assets" | "starting";

export type LaunchEvent =
  | { event: "progress"; data: { stage: Stage; done: number; total: number } }
  | { event: "started" };

export interface ImportProgress {
  done: number;
  total: number;
  /** Files the user downloads by hand; they move into the pack once they land in Downloads. */
  manual: ManualFile[];
}

export interface ManualFile {
  name: string;
  page: string;
  done: boolean;
}

export interface GameExit {
  id: string;
  code: number | null;
}

export interface GameLog {
  id: string;
  line: string;
  /** Came from stderr. */
  err: boolean;
}
