import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "@/components/ui/Icon";
import { useUi, type View } from "@/store/UiContext";

const TITLES: Record<View, string> = { home: "Home", instances: "Instances", mods: "Mods", console: "Console", settings: "Settings" };

// Window has `decorations: false`; drag and buttons are ours (needs core:window:* permissions).
const appWindow = getCurrentWindow();

export function Titlebar() {
  const { view } = useUi();
  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="titlebar-title" data-tauri-drag-region>
        TNLauncher <span data-tauri-drag-region>{TITLES[view]}</span>
      </span>
      <div className="win-btns">
        <button aria-label="Minimize" onClick={() => appWindow.minimize()}>
          <Icon name="minimize" />
        </button>
        <button aria-label="Maximize" onClick={() => appWindow.toggleMaximize()}>
          <Icon name="crop_square" />
        </button>
        <button className="close" aria-label="Close" onClick={() => appWindow.close()}>
          <Icon name="close" />
        </button>
      </div>
    </header>
  );
}
