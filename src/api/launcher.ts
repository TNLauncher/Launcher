// Typed wrappers for the core commands in src-tauri/src/lib.rs; plugin commands live in ./sources.
import { Channel, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { call } from "./ipc";
import type { Account, ContentKind, DeviceCode, GameExit, GameLog, Instance, InstanceSettings, LaunchEvent, Loader, ModFile, Screenshot, Settings, Skin, Snapshot } from "@/types";

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
  /** null = play offline. */
  selectAccount: (id: string | null) => call<void>("select_account", { id }),
  removeAccount: (id: string) => call<void>("remove_account", { id }),
  /** null = the account has no skin. */
  accountSkin: (id: string) => call<Skin | null>("account_skin", { id }),
  /** Signs in through an account provider plugin; `fields` are its form's values. Resolves with the player name. */
  pluginLogin: (plugin: string, fields: Record<string, string>) => call<string>("plugin_login", { plugin, fields }),

  createInstance: (name: string, version: string, loader: Loader) =>
    call<Instance>("create_instance", { name, version, loader }),
  renameInstance: (id: string, name: string) => call<void>("rename_instance", { id, name }),
  /** `icon` is a `data:image/...` URL, or "" to reset. */
  setInstanceIcon: (id: string, icon: string) => call<void>("set_instance_icon", { id, icon }),
  setInstanceSettings: (id: string, settings: InstanceSettings) => call<void>("set_instance_settings", { id, settings }),
  deleteInstance: (id: string) => call<void>("delete_instance", { id }),
  /** Opens the instance folder, or a folder inside it (`mods`, `screenshots`...). */
  openInstanceDir: (id: string, folder?: string) => call<void>("open_instance_dir", { id, folder }),
  /** Newest first. */
  listScreenshots: (id: string) => call<Screenshot[]>("list_screenshots", { id }),
  deleteScreenshot: (id: string, file: string) => call<void>("delete_screenshot", { id, file }),
  screenshotUrl: (id: string, file: string) => convertFileSrc(`screenshot/${id}/${file}`, "instance"),

  /** Resolves once the game process has started; progress arrives through `onEvent`. */
  launch: (id: string, onEvent: (e: LaunchEvent) => void) => {
    const channel = new Channel<LaunchEvent>();
    channel.onmessage = onEvent;
    return call<void>("launch", { id, onEvent: channel });
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
  /** URL of the icon packed inside a mod jar; 404s when the mod has none. */
  modIconUrl: (id: string, file: string) => convertFileSrc(`modicon/${id}/${file}`, "instance"),

  /** GET a Mojang document through Rust: no CORS in the webview. Content sources go through `sources`. */
  fetchJson: <T>(url: string) => call<T>("fetch_json", { url }),
};
