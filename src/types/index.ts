// Mirrors of the Rust models (src-tauri/src/models). Keep in sync when those change.

export type Loader = "vanilla" | "fabric" | "quilt";
export type AfterLaunch = "hide" | "keep" | "close";

export interface Settings {
  javaPath: string;
  ramMb: number;
  jvmArgs: string;
  width: number;
  height: number;
  fullscreen: boolean;
  afterLaunch: AfterLaunch;
  username: string;
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

export interface Snapshot {
  settings: Settings;
  /** Signed-in Microsoft player name; null = offline. */
  account: string | null;
  instances: Instance[];
  modCounts: Record<string, number>;
  running: string[];
  dataDir: string;
}

export interface DeviceCode {
  userCode: string;
  verificationUri: string;
}

export type Stage = "resolving" | "java" | "libraries" | "assets" | "starting";

export type LaunchEvent =
  | { event: "progress"; data: { stage: Stage; done: number; total: number } }
  | { event: "started" };

export interface ImportProgress {
  done: number;
  total: number;
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
