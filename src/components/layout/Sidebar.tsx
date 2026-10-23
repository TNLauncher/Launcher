import logo from "@/assets/logo.png";
import { Icon } from "@/components/ui/Icon";
import { useLauncher } from "@/store/LauncherContext";
import { useUi, type View } from "@/store/UiContext";
import s from "./Sidebar.module.css";

const NAV: { view: View; icon: string; label: string }[] = [
  { view: "home", icon: "sports_esports", label: "Home" },
  { view: "instances", icon: "layers", label: "Instances" },
  { view: "modpacks", icon: "inventory_2", label: "Modpacks" },
  { view: "mods", icon: "extension", label: "Mods" },
  { view: "console", icon: "terminal", label: "Console" },
  { view: "settings", icon: "tune", label: "Settings" },
];

export function Sidebar() {
  const { view, navigate } = useUi();
  const snapshot = useLauncher().snapshot;
  const name = snapshot?.account ?? (snapshot?.settings.username || "Player");

  return (
    <aside className={s.sidebar}>
      <div>
        <img className={s.logo} src={logo} alt="TNLauncher" />
        <nav>
          {NAV.map((n) => (
            <button key={n.view} className={s.navBtn} aria-current={view === n.view ? "page" : undefined} onClick={() => navigate(n.view)}>
              <Icon name={n.icon} />
              <span className={s.tip}>{n.label}</span>
            </button>
          ))}
        </nav>
      </div>
      <button className={s.avatar} onClick={() => navigate("settings")} aria-label="Account settings">
        <span>{name[0].toUpperCase()}</span>
        <span className={`${s.tip} mono`}>{name} · {snapshot?.account ? "Microsoft" : "Offline"}</span>
      </button>
    </aside>
  );
}
