import { Button, Chip, Dot, IconButton, Select, type Tone } from "@/components/ui";
import { cx } from "@/lib/cx";
import { STAGE_LABEL } from "@/lib/format";
import { useLauncher, useProgress, useRecentInstances } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import s from "./home.module.css";

export function LaunchDock() {
  const { selected: inst, select, launch, busyId, error, isRunning, snapshot } = useLauncher();
  const progress = useProgress();
  const { navigate } = useUi();
  const instances = useRecentInstances();
  const running = !!inst && isRunning(inst.id);
  const preparing = !!inst && !!progress && busyId === inst.id;
  const ramGb = ((snapshot?.settings.ramMb ?? 4096) / 1024).toFixed(1);

  let [status, dot]: [string, Tone] = ["Ready", "green"];
  if (!inst) [status, dot] = ["Create an instance to play", "neutral"];
  else if (error?.id === inst.id) [status, dot] = [error.message, "red"];
  else if (running) [status, dot] = [`Playing ${inst.name}`, "blue"];
  else if (preparing) [status, dot] = [`${STAGE_LABEL[progress.stage]}…`, "orange"];
  else if (busyId) [status, dot] = ["Another instance is starting", "orange"];

  const known = !!progress && progress.total > 0;
  const pct = known ? (progress.done / progress.total) * 100 : 0;

  return (
    <footer className={s.dock}>
      <div className={s.dockLeft}>
        <Select label="Instance" variant="pill" value={inst?.id ?? ""} onChange={select} placeholder="No instances"
          options={instances.map((i) => ({ value: i.id, label: i.name }))} />
        <Chip icon="memory">{ramGb} GB</Chip>
        <IconButton icon="terminal" label="Open console" title="Console" disabled={!inst} onClick={() => navigate("console")} />
      </div>

      <div className={s.status}>
        <Dot tone={dot} />
        <span title={status}>{status}</span>
      </div>

      <div className={s.dockRight}>
        {preparing && (
          <div className={s.progress}>
            <div className={cx(s.progressTop, "mono")}>
              <span>{STAGE_LABEL[progress.stage]}</span>
              <span>{known ? `${Math.floor(pct)}%` : ""}</span>
            </div>
            <div className={cx(s.bar, !known && s.indeterminate)}>
              <div style={known ? { transform: `scaleX(${pct / 100})` } : undefined} />
            </div>
          </div>
        )}
        <Button variant="primary" size="lg" icon="play_arrow" className={s.play} disabled={!inst || running || !!busyId} onClick={() => inst && launch(inst.id)}>
          {running ? "IN GAME" : preparing ? "PREPARING" : "PLAY"}
        </Button>
      </div>
    </footer>
  );
}
