import logo from "@/assets/logo.png";
import { Icon } from "@/components/ui/Icon";
import { useLauncher } from "@/store/LauncherContext";
import { useUi, type View } from "@/store/UiContext";

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
    <aside className="sidebar">
      <div>
        <img className="logo" src={logo} alt="TNLauncher" />
        <nav>
          {NAV.map((n) => (
            <button key={n.view} className="nav-btn" aria-current={view === n.view ? "page" : undefined} onClick={() => navigate(n.view)}>
              <Icon name={n.icon} />
              <span className="tip">{n.label}</span>
            </button>
          ))}
        </nav>
      </div>
      <button className="avatar" onClick={() => navigate("settings")} aria-label="Account settings">
        <span>{name[0].toUpperCase()}</span>
        <span className="tip mono">{name} · {snapshot?.account ? "Microsoft" : "Offline"}</span>
      </button>
    </aside>
  );
}
