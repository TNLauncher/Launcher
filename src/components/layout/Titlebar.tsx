import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "@/components/ui/Icon";
import { useUi } from "@/store/UiContext";
import { useRouteLabel } from "./Sidebar";
import s from "./Titlebar.module.css";

// Window has `decorations: false`; drag and buttons are ours (needs core:window:* permissions).
const appWindow = getCurrentWindow();

export function Titlebar() {
  const route = useUi((st) => st.route);
  const canBack = useUi((st) => st.canBack);
  const canForward = useUi((st) => st.canForward);
  const navigate = useUi((st) => st.navigate);
  const back = useUi((st) => st.back);
  const forward = useUi((st) => st.forward);
  const { section, detail } = useRouteLabel()(route);
  return (
    <header className={s.titlebar} data-tauri-drag-region>
      <div className={s.lead} data-tauri-drag-region>
        <div className={s.history}>
          <button aria-label="Back" title="Back (Alt+←)" disabled={!canBack && !detail} onClick={back}>
            <Icon name="arrow_back" />
          </button>
          <button aria-label="Forward" title="Forward (Alt+→)" disabled={!canForward} onClick={forward}>
            <Icon name="arrow_forward" />
          </button>
        </div>
        <nav className={s.crumbs} aria-label="Breadcrumb" data-tauri-drag-region>
          {detail ? (
            <>
              <button className={s.crumb} onClick={() => navigate(route.view)}>{section}</button>
              <Icon name="chevron_right" className={s.sep} />
              <span className={s.current} aria-current="page" data-tauri-drag-region>{detail}</span>
            </>
          ) : (
            <span className={s.current} aria-current="page" data-tauri-drag-region>{section}</span>
          )}
        </nav>
      </div>
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
