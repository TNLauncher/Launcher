import { Icon } from "@/components/ui/Icon";
import { LOADER_ICON, LOADERS } from "@/lib/format";
import { useLauncher, useRecentInstances } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";

export function InstanceTiles() {
  const { selected, select } = useLauncher();
  const { openNewInstance, navigate } = useUi();
  const recent = useRecentInstances();

  return (
    <div className="home-section">
      <div className="section-head">
        <h2>Instances</h2>
        {recent.length > 0 && (
          <button className="link" onClick={() => navigate("instances")}>
            {recent.length > 3 ? `All ${recent.length} instances` : "Manage"}
          </button>
        )}
      </div>
      <div className="tiles">
        {recent.slice(0, 3).map((i) => (
          <button key={i.id} className="tile" aria-pressed={i.id === selected?.id} onClick={() => select(i.id)}>
            <span className="tile-icon"><Icon name={LOADER_ICON[i.loader]} /></span>
            <span className="tile-text">
              <span className="tile-name">{i.name}</span>
              <span className="tile-sub">{i.version} · {LOADERS[i.loader]}</span>
            </span>
          </button>
        ))}
        <button className="tile add" onClick={openNewInstance}>
          <span className="tile-icon"><Icon name="add" /></span>
          <span className="tile-text">
            <span className="tile-name">Add instance</span>
            <span className="tile-sub">Vanilla, Fabric or Quilt</span>
          </span>
        </button>
      </div>
    </div>
  );
}
