import { Icon } from "@/components/ui/Icon";
import { STAGE_LABEL } from "@/lib/format";
import { useLauncher, useRecentInstances } from "@/store/LauncherContext";

export function LaunchDock() {
  const { selected: inst, select, launch, busy, error, isRunning, snapshot } = useLauncher();
  const instances = useRecentInstances();
  const running = !!inst && isRunning(inst.id);
  const preparing = !!inst && busy?.id === inst.id;
  const ramGb = ((snapshot?.settings.ramMb ?? 4096) / 1024).toFixed(1);

  let [status, dot] = ["Ready", "green"];
  if (!inst) [status, dot] = ["Create an instance to play", ""];
  else if (error?.id === inst.id) [status, dot] = [error.message, "red"];
  else if (running) [status, dot] = [`Playing ${inst.name}`, "blue"];
  else if (preparing) [status, dot] = [`${STAGE_LABEL[busy.stage]}…`, "orange"];
  else if (busy) [status, dot] = ["Another instance is starting", "orange"];

  const known = !!busy && busy.total > 0;
  const pct = known ? (busy.done / busy.total) * 100 : 0;

  return (
    <footer className="dock">
      <div className="dock-left">
        <select className="select" aria-label="Instance" value={inst?.id ?? ""} disabled={!inst} onChange={(e) => select(e.target.value)}>
          {instances.length ? instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>) : <option>No instances</option>}
        </select>
        <span className="chip"><Icon name="memory" />{ramGb} GB</span>
      </div>

      <div className="status">
        <span className={`dot ${dot}`} />
        <span title={status}>{status}</span>
      </div>

      <div className="dock-right">
        {preparing && (
          <div className="progress">
            <div className="progress-top mono">
              <span>{STAGE_LABEL[busy.stage]}</span>
              <span>{known ? `${Math.floor(pct)}%` : ""}</span>
            </div>
            <div className={`bar ${known ? "" : "indeterminate"}`}>
              <div style={known ? { transform: `scaleX(${pct / 100})` } : undefined} />
            </div>
          </div>
        )}
        <button className="btn primary play" disabled={!inst || running || !!busy} onClick={() => inst && launch(inst.id)}>
          <Icon name="play_arrow" fill />
          <span>{running ? "IN GAME" : preparing ? "PREPARING" : "PLAY"}</span>
        </button>
      </div>
    </footer>
  );
}
