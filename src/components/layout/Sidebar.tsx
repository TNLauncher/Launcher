import logo from "@/assets/logo.png";
import { Icon } from "@/components/ui/Icon";
import { SkinHead, useSkin } from "@/features/profiles/Skin";
import { usePlugins } from "@/hooks/useSource";
import { useLauncherUpdate, usePluginUpdateCount } from "@/hooks/useUpdates";
import { useLauncher } from "@/store/LauncherContext";
import { arrange, PINNED_VIEWS, useLayout } from "@/store/layout";
import { useUi, type Route, type View } from "@/store/UiContext";
import { preloadView } from "@/views";
import s from "./Sidebar.module.css";

const NAV: { view: View; icon: string; label: string }[] = [
  { view: "home", icon: "sports_esports", label: "Home" },
  { view: "profiles", icon: "badge", label: "Profiles" },
  { view: "instances", icon: "layers", label: "Instances" },
  { view: "modpacks", icon: "inventory_2", label: "Modpacks" },
  { view: "plugins", icon: "extension", label: "Plugins" },
  { view: "settings", icon: "tune", label: "Settings" },
];

/** Every sidebar section, plugin pages included, in the user's order; hidden ones too (Settings lists them). */
export function useNavItems(): typeof NAV {
  const order = useLayout().sidebar.order;
  const pages: typeof NAV = (usePlugins().data ?? [])
    .filter((p) => p.enabled)
    .flatMap((p) => p.pages.map((pg) => ({ view: `plugin:${p.id}:${pg.id}` as View, icon: pg.icon, label: pg.title })));
  // By default plugin pages sit above Plugins and Settings, which stay last.
  return arrange([...NAV.slice(0, -2), ...pages, ...NAV.slice(-2)], order);
}

/** The sections the sidebar shows. */
function useNav(): typeof NAV {
  const hidden = useLayout().sidebar.hidden;
  return useNavItems().filter((n) => PINNED_VIEWS.includes(n.view) || !hidden.includes(n.view));
}

/** Names a screen: its section, and its detail page (or nested sub-detail) if one is open. */
export function useRouteLabel(): (r: Route) => { section: string; detail?: string; subdetail?: string } {
  const nav = useNavItems(); // Hidden sections still open from links (an instance from Home), and keep their names.
  const instances = useLauncher((st) => st.snapshot?.instances);
  return (r) => {
    const instName = r.instance ? (instances?.find((i) => i.id === r.instance)?.name ?? "Instance") : undefined;
    if (r.content && instName) {
      return {
        section: nav.find((n) => n.view === r.view)?.label ?? "Page",
        detail: instName,
        subdetail: r.content.project.title,
      };
    }
    return {
      section: nav.find((n) => n.view === r.view)?.label ?? "Page",
      detail: r.content?.project.title ?? r.pack?.hit.title ?? instName,
    };
  };
}

/** What a detail page's back button returns to. */
export function useBackLabel(): string {
  const route = useUi((st) => st.route);
  const previous = useUi((st) => st.previous);
  const label = useRouteLabel()(previous ?? route);
  return previous ? (label.subdetail ?? label.detail ?? label.section) : (label.detail ?? label.section);
}

export function Sidebar() {
  const view = useUi((st) => st.route.view);
  const navigate = useUi((st) => st.navigate);
  const account = useLauncher((st) => st.snapshot?.account);
  const name = account?.name ?? "?";
  const skin = useSkin(account);
  const nav = useNav();
  const active = nav.findIndex((n) => n.view === view);
  const pluginUpdates = usePluginUpdateCount();
  const launcherUpdate = useLauncherUpdate();
  const badge: Partial<Record<View, string>> = {
    ...(pluginUpdates > 0 && { plugins: `${pluginUpdates} ${pluginUpdates === 1 ? "update" : "updates"}` }),
    ...(launcherUpdate && { settings: "Launcher update" }),
  };

  return (
    <aside className={s.sidebar}>
      <div>
        <img className={s.logo} src={logo} alt="TNLauncher" />
        <nav>
          {/* One shared highlight that travels between items, so the eye follows the move. */}
          <span className={s.indicator} hidden={active < 0} style={{ top: `${active * 44}px` }} />
          {nav.map((n) => (
            <button key={n.view} className={s.navBtn} aria-current={view === n.view ? "page" : undefined} onClick={() => navigate(n.view)}
              onPointerEnter={() => preloadView(n.view)} onFocus={() => preloadView(n.view)}>
              <Icon name={n.icon} fill={view === n.view} />
              {badge[n.view] && view !== n.view && <span className={s.dot} aria-hidden />}
              <span className={s.tip}>{n.label}{badge[n.view] && ` · ${badge[n.view]}`}</span>
            </button>
          ))}
        </nav>
      </div>
      <button className={s.avatar} onClick={() => navigate("profiles")} onPointerEnter={() => preloadView("profiles")} aria-label="Profiles">
        <SkinHead skin={skin} name={name} size={32} className={s.head} />
        <span className={`${s.tip} mono`}>{account ? `${account.name} · ${account.providerName}` : "Not signed in"}</span>
      </button>
    </aside>
  );
}
