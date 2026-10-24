import logo from "@/assets/logo.png";
import { Icon } from "@/components/ui/Icon";
import { SkinHead, useSkin } from "@/features/profiles/Skin";
import { usePlugins } from "@/hooks/useSource";
import { useLauncher } from "@/store/LauncherContext";
import { useUi, type View } from "@/store/UiContext";
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

export function Sidebar() {
  const { view, navigate } = useUi();
  const snapshot = useLauncher().snapshot;
  const name = snapshot?.account?.name ?? (snapshot?.settings.username || "Player");
  const skin = useSkin(snapshot?.account);
  const pages: typeof NAV = (usePlugins().data ?? [])
    .filter((p) => p.enabled)
    .flatMap((p) => p.pages.map((pg) => ({ view: `plugin:${p.id}:${pg.id}` as View, icon: pg.icon, label: pg.title })));
  // Plugin pages sit above Settings, which stays last.
  const nav = [...NAV.slice(0, -1), ...pages, NAV[NAV.length - 1]];
  const active = nav.findIndex((n) => n.view === view);

  return (
    <aside className={s.sidebar}>
      <div>
        <img className={s.logo} src={logo} alt="TNLauncher" />
        <nav>
          {/* One shared highlight that travels between items, so the eye follows the move. */}
          <span className={s.indicator} hidden={active < 0} style={{ transform: `translateY(${active * 44}px)` }} />
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
        <span className={`${s.tip} mono`}>{name} · {snapshot?.account?.providerName ?? "Offline"}</span>
      </button>
    </aside>
  );
}
