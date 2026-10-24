import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "@/components/ui/Icon";
import { useUi, type View } from "@/store/UiContext";
import s from "./Titlebar.module.css";

const TITLES: Record<View, string> = { home: "Home", profiles: "Profiles", instances: "Instances", modpacks: "Modpacks", mods: "Mods", console: "Console", settings: "Settings" };

// Window has `decorations: false`; drag and buttons are ours (needs core:window:* permissions).
const appWindow = getCurrentWindow();

export function Titlebar() {
  const { view } = useUi();
  return (
    <header className={s.titlebar} data-tauri-drag-region>
      <span className={s.title} data-tauri-drag-region>
        TNLauncher <span data-tauri-drag-region>{TITLES[view]}</span>
      </span>
      <div className={s.winBtns}>
        <button aria-label="Minimize" onClick={() => appWindow.minimize()}>
          <Icon name="minimize" />
        </button>
        <button aria-label="Maximize" onClick={() => appWindow.toggleMaximize()}>
          <Icon name="crop_square" />
        </button>
        <button className={s.close} aria-label="Close" onClick={() => appWindow.close()}>
          <Icon name="close" />
        </button>
      </div>
    </header>
  );
}
