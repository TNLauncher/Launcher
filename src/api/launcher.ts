// Typed wrappers for every command registered in src-tauri/src/lib.rs.
import { Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { call } from "./ipc";
import type { DeviceCode, GameExit, Instance, LaunchEvent, Loader, ModFile, Settings, Snapshot } from "@/types";

export const launcher = {
  getState: () => call<Snapshot>("get_state"),
  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),

  /** Resolves with the player name once the user approves the code shown via `onCode`. */
  microsoftLogin: (onCode: (c: DeviceCode) => void) => {
    const channel = new Channel<DeviceCode>();
    channel.onmessage = onCode;
    return call<string>("microsoft_login", { onCode: channel });
  },
  microsoftLogout: () => call<void>("microsoft_logout"),

  createInstance: (name: string, version: string, loader: Loader) =>
    call<Instance>("create_instance", { name, version, loader }),
  /** Downloads a Modrinth `.mrpack` and creates an instance from it. */
  importModpack: (url: string) => call<Instance>("import_modpack", { url }),
  renameInstance: (id: string, name: string) => call<void>("rename_instance", { id, name }),
  deleteInstance: (id: string) => call<void>("delete_instance", { id }),
  openInstanceDir: (id: string, mods = false) => call<void>("open_instance_dir", { id, mods }),

  /** Resolves once the game process has started; progress arrives through `onEvent`. */
  launch: (id: string, onEvent: (e: LaunchEvent) => void) => {
    const channel = new Channel<LaunchEvent>();
    channel.onmessage = onEvent;
    return call<void>("launch", { id, onEvent: channel });
  },
  onGameExit: (cb: (e: GameExit) => void): Promise<UnlistenFn> => listen<GameExit>("game-exit", (e) => cb(e.payload)),

  listMods: (id: string) => call<ModFile[]>("list_mods", { id }),
  toggleMod: (id: string, file: string) => call<void>("toggle_mod", { id, file }),
  deleteMod: (id: string, file: string) => call<void>("delete_mod", { id, file }),
  installMod: (id: string, url: string, file: string) => call<void>("install_mod", { id, url, file }),

  /** GET through Rust: no CORS in the webview. */
  fetchJson: <T>(url: string) => call<T>("fetch_json", { url }),
};
