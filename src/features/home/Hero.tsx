import { Icon } from "@/components/ui/Icon";
import { lastPlayed, loaderLabel, plural } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";

export function Hero() {
  const { selected: inst, snapshot } = useLauncher();
  const { openNewInstance } = useUi();

  return (
    <div className="hero">
      <div className="hero-bg" />
      <div className="hero-body">
        {!inst ? (
          <>
            <h1>No instances yet</h1>
            <div className="meta">Create one to download Minecraft and start playing.</div>
            <div className="hero-cta">
              <button className="btn primary" onClick={openNewInstance}>
                <Icon name="add" />
                Create instance
              </button>
            </div>
          </>
        ) : (
          <>
            <h1>{inst.name}</h1>
            <div className="meta">
              <span>{inst.version} · {loaderLabel(inst)}</span>
              {inst.loader !== "vanilla" && (
                <>
                  <span className="sep">•</span>
                  <span>{plural(snapshot?.modCounts[inst.id] ?? 0, "mod")}</span>
                </>
              )}
              <span className="sep">•</span>
              <span>{lastPlayed(inst.lastPlayed)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
