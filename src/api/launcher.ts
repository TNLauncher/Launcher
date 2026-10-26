// Typed wrappers for the core commands in src-tauri/src/lib.rs; plugin commands live in ./sources.
import { Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { call } from "./ipc";
import type { Account, ContentKind, DeviceCode, GameExit, GameLog, ImportProgress, Instance, InstanceSettings, LaunchEvent, Loader, LoaderBuild, ModFile, Screenshot, Settings, Skin, Snapshot, World } from "@/types";

export const launcher = {
  getState: () => call<Snapshot>("get_state"),
  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),

  /** Resolves with the player name once the user approves the code shown via `onCode`. */
  microsoftLogin: (onCode: (c: DeviceCode) => void) => {
    const channel = new Channel<DeviceCode>();
    channel.onmessage = onCode;
    return call<string>("microsoft_login", { onCode: channel });
  },
  listAccounts: () => call<Account[]>("list_accounts"),
  selectAccount: (id: string) => call<void>("select_account", { id }),
  removeAccount: (id: string) => call<void>("remove_account", { id }),
  /** null = the account has no skin. */
  accountSkin: (id: string) => call<Skin | null>("account_skin", { id }),
  /** Signs in through an account provider plugin; `fields` are its form's values. Resolves with the player name. */
  pluginLogin: (plugin: string, fields: Record<string, string>) => call<string>("plugin_login", { plugin, fields }),

  /** `loaderVersion: null` = the loader's newest stable build. */
  createInstance: (name: string, version: string, loader: Loader, loaderVersion: string | null) =>
    call<Instance>("create_instance", { name, version, loader, loaderVersion }),
  /** Game versions the loader runs; null = all (vanilla). */
  loaderGames: (loader: Loader) => call<string[] | null>("loader_games", { loader }),
  /** Loader builds for a game version, newest first. */
  loaderBuilds: (version: string, loader: Loader) => call<LoaderBuild[]>("loader_builds", { version, loader }),
  renameInstance: (id: string, name: string) => call<void>("rename_instance", { id, name }),
  /** `icon` is a `data:image/...` URL, or "" to reset. */
  setInstanceIcon: (id: string, icon: string) => call<void>("set_instance_icon", { id, icon }),
  setInstanceSettings: (id: string, settings: InstanceSettings) => call<void>("set_instance_settings", { id, settings }),
  deleteInstance: (id: string) => call<void>("delete_instance", { id }),
  /** A copy with all files, named "<name> (copy)". */
  copyInstance: (id: string) => call<Instance>("copy_instance", { id }),
  /** "" = ungrouped. */
  setInstanceGroup: (id: string, group: string) => call<void>("set_instance_group", { id, group }),
  /** A modpack archive on disk; whichever plugin reads its format plans it. Cancel with `sources.cancelImport(path)`. */
  importModpackFile: (path: string, onProgress: (p: ImportProgress) => void) => {
    const channel = new Channel<ImportProgress>();
    channel.onmessage = onProgress;
    return call<Instance>("import_modpack_file", { path, onProgress: channel });
  },
  /** Opens the instance folder, or a folder inside it (`mods`, `screenshots`...). */
  openInstanceDir: (id: string, folder?: string) => call<void>("open_instance_dir", { id, folder }),
  /** Newest first. */
  listScreenshots: (id: string) => call<Screenshot[]>("list_screenshots", { id }),
  deleteScreenshot: (id: string, file: string) => call<void>("delete_screenshot", { id, file }),
  screenshot: (id: string, file: string) => call<ArrayBuffer>("screenshot_bytes", { id, file }),
  /** Last played first. */
  listWorlds: (id: string) => call<World[]>("list_worlds", { id }),
  worldIcon: (id: string, folder: string) => call<ArrayBuffer>("world_icon", { id, folder }),
  deleteWorld: (id: string, folder: string) => call<void>("delete_world", { id, folder }),
  /** Resolves with the copy's folder. */
  copyWorld: (id: string, folder: string) => call<string>("copy_world", { id, folder }),

  /** Resolves once the game process has started; progress arrives through `onEvent`. `world`: a `saves/` folder to open straight away. */
  launch: (id: string, onEvent: (e: LaunchEvent) => void, world?: string) => {
    const channel = new Channel<LaunchEvent>();
    channel.onmessage = onEvent;
    return call<void>("launch", { id, world, onEvent: channel });
  },
  onGameExit: (cb: (e: GameExit) => void): Promise<UnlistenFn> => listen<GameExit>("game-exit", (e) => cb(e.payload)),
  /** Every line the game prints, from any running instance. */
  onGameLog: (cb: (e: GameLog) => void): Promise<UnlistenFn> => listen<GameLog>("game-log", (e) => cb(e.payload)),
  stopGame: (id: string) => call<void>("stop_game", { id }),
  /** The last session's `launcher.log` (its tail if huge); "" if never launched. */
  readGameLog: (id: string) => call<string>("read_game_log", { id }),

  listContent: (id: string, kind: ContentKind) => call<ModFile[]>("list_content", { id, kind }),
  /** Mods are renamed to `.disabled`; packs are switched in `options.txt`, shaders in Iris' config. */
  toggleContent: (id: string, kind: ContentKind, file: string) => call<void>("toggle_content", { id, kind, file }),
  deleteContent: (id: string, kind: ContentKind, file: string) => call<void>("delete_content", { id, kind, file }),
  /** The icon packed inside a mod jar; rejects when the mod has none. */
  modIcon: (id: string, file: string) => call<ArrayBuffer>("mod_icon", { id, file }),

  /** GET a Mojang document through Rust: no CORS in the webview. Content sources go through `sources`. */
  fetchJson: <T>(url: string) => call<T>("fetch_json", { url }),
};
