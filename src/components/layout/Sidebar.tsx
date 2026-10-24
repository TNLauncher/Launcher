import logo from "@/assets/logo.png";
import { Icon } from "@/components/ui/Icon";
import { SkinHead, useSkin } from "@/features/profiles/Skin";
import { usePlugins } from "@/hooks/useSource";
import { useLauncher } from "@/store/LauncherContext";
import { useUi, type Route, type View } from "@/store/UiContext";
import { preloadView } from "@/views";
import s from "./Sidebar.module.css";

const NAV: { view: View; icon: string; label: string }[] = [
  { view: "home", icon: "sports_esports", label: "Home" },
  { view: "profiles", icon: "badge", label: "Profiles" },
  { view: "instances", icon: "layers", label: "Instances" },
  { view: "modpacks", icon: "inventory_2", label: "Modpacks" },
  { view: "mods", icon: "extension", label: "Mods" },
  { view: "console", icon: "terminal", label: "Console" },
  { view: "settings", icon: "tune", label: "Settings" },
];

/** Sidebar sections, plugin pages included. */
function useNav(): typeof NAV {
  const pages: typeof NAV = (usePlugins().data ?? [])
    .filter((p) => p.enabled)
    .flatMap((p) => p.pages.map((pg) => ({ view: `plugin:${p.id}:${pg.id}` as View, icon: pg.icon, label: pg.title })));
  // Plugin pages sit above Settings, which stays last.
  return [...NAV.slice(0, -1), ...pages, NAV[NAV.length - 1]];
}

/** Names a screen: its section, and its detail page (or nested sub-detail) if one is open. */
export function useRouteLabel(): (r: Route) => { section: string; detail?: string; subdetail?: string } {
  const nav = useNav();
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
              <span className={s.tip}>{n.label}</span>
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
