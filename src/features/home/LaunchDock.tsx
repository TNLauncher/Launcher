import { useId, useState, type CSSProperties } from "react";
import { Button, Icon, IconButton, Select } from "@/components/ui";
import { cx } from "@/lib/cx";
import { errorMessage, LOADER_ICON, LOADERS, lastPlayed, STAGE_LABEL } from "@/lib/format";
import { gameLogs, useGameLog } from "@/store/gameLogs";
import { useLauncher, useProgress, useRecentInstances } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import s from "./home.module.css";

export function LaunchDock() {
  const { selected: inst, select, launch, busyId, error, clearError, isRunning, snapshot } = useLauncher();
  const progress = useProgress();
  const { navigate, openNewInstance } = useUi();
  const instances = useRecentInstances();
  const log = useGameLog(inst?.id);
  const [stopError, setStopError] = useState<string | null>(null);
  const statusId = useId();
  const running = !!inst && isRunning(inst.id);
  const preparing = !!inst && busyId === inst.id;
  const ramGb = +((snapshot?.settings.ramMb ?? 0) / 1024).toFixed(1);
  const known = !!progress && progress.total > 0;
  const pct = known ? progress.done / progress.total : 0;

  const failure = stopError ?? (inst && error?.id === inst.id ? error.message : null);
  let status = "";
  if (!inst) status = snapshot ? "No instances yet" : "";
  else if (running) status = "In game";
  else if (preparing) status = progress ? `${STAGE_LABEL[progress.stage]}…` : "Starting…";
  else if (busyId) status = `Starting ${snapshot?.instances.find((i) => i.id === busyId)?.name ?? "another instance"}…`;
  else status = lastPlayed(inst.lastPlayed);

  function stop() {
    if (!inst) return;
    setStopError(null);
    gameLogs.stop(inst.id).catch((e) => setStopError(errorMessage(e)));
  }

  function dismiss() {
    setStopError(null);
    clearError();
  }

  let action;
  if (snapshot && !instances.length) {
    action = <Button variant="primary" size="lg" icon="add" className={s.play} onClick={openNewInstance}>Create instance</Button>;
  } else if (running) {
    action = (
      <Button variant="danger" size="lg" icon="stop" className={s.play} disabled={log?.stopping} onClick={stop}>
        {log?.stopping ? "Stopping" : "Stop"}
      </Button>
    );
  } else if (preparing) {
    action = (
      <Button variant="primary" size="lg" className={cx(s.play, s.playBusy, !known && s.playSweep)} disabled aria-busy="true"
        style={{ "--p": pct } as CSSProperties}>
        {progress ? STAGE_LABEL[progress.stage] : "Starting"}
        {known && <span className={cx(s.playPct, "mono")}>{Math.floor(pct * 100)}%</span>}
      </Button>
    );
  } else {
    action = (
      <Button variant={busyId ? "default" : "primary"} size="lg" icon="play_arrow" className={s.play}
        disabled={!inst || !!busyId} aria-describedby={statusId} onClick={() => inst && launch(inst.id)}>
        Play
      </Button>
    );
  }

  return (
    <footer className={s.dock}>
      <div className={s.dockLeft}>
        {inst && (
          <Select label="Instance" variant="pill" className={s.card} value={inst.id} onChange={select}
            options={instances.map((i) => ({ value: i.id, label: i.name, hint: i.version }))}>
            <span className={s.cardIcon}>{inst.icon ? <img src={inst.icon} alt="" /> : <Icon name={LOADER_ICON[inst.loader]} />}</span>
            <span className={s.cardText}>
              <span className={s.cardName}>{inst.name}</span>
              <span className={s.cardSub}>{inst.version} · {LOADERS[inst.loader]}{ramGb > 0 && ` · ${ramGb} GB`}</span>
            </span>
          </Select>
        )}
        {inst && <IconButton icon="terminal" label="Open console" onClick={() => navigate("console")} />}
      </div>

      <div className={s.dockRight}>
        {failure ? (
          <div className={s.failure} role="alert">
            <Icon name="error" className={s.failureIcon} />
            <span id={statusId} className={s.failureText} title={failure}>{failure}</span>
            <IconButton icon="article" label="Open log" onClick={() => navigate("console")} />
            <IconButton icon="close" label="Dismiss" onClick={dismiss} />
          </div>
        ) : (
          <span id={statusId} className={cx(s.status, preparing && s.statusSr)} role="status" title={status}>{status}</span>
        )}
        {action}
      </div>
    </footer>
  );
}
