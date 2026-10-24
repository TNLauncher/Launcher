import { useId, useState, type CSSProperties } from "react";
import { Button, Icon, IconButton, Select } from "@/components/ui";
import { useChanged } from "@/hooks/useChanged";
import { cx } from "@/lib/cx";
import { errorMessage, LOADER_ICON, LOADERS, lastPlayed, STAGE_LABEL } from "@/lib/format";
import { gameLogs, useGameStopping } from "@/store/gameLogs";
import { useLauncher, useProgress, useRecentInstances, useSelectedInstance } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import s from "./home.module.css";

export function LaunchDock() {
  return (
    <footer className={s.dock}>
      <DockInstance />
      <DockAction />
    </footer>
  );
}

/** Kept apart from the action so per-frame launch progress doesn't re-render the picker. */
function DockInstance() {
  const inst = useSelectedInstance();
  const select = useLauncher((st) => st.select);
  const ramMb = useLauncher((st) => st.snapshot?.settings.ramMb ?? 0);
  const navigate = useUi((st) => st.navigate);
  const instances = useRecentInstances();
  const ramGb = +(ramMb / 1024).toFixed(1);
  if (!inst) return <div className={s.dockLeft} />;
  return (
    <div className={s.dockLeft}>
      <Select label="Instance" variant="pill" className={s.card} value={inst.id} onChange={select}
        options={instances.map((i) => ({ value: i.id, label: i.name, hint: i.version }))}>
        <span className={s.cardIcon}>{inst.icon ? <img src={inst.icon} alt="" /> : <Icon name={LOADER_ICON[inst.loader]} />}</span>
        <span className={s.cardText}>
          <span className={s.cardName}>{inst.name}</span>
          <span className={s.cardSub}>{inst.version} · {LOADERS[inst.loader]}{ramGb > 0 && ` · ${ramGb} GB`}</span>
        </span>
      </Select>
      <IconButton icon="terminal" label="Open console" onClick={() => navigate("console")} />
    </div>
  );
}

function DockAction() {
  const inst = useSelectedInstance();
  const launch = useLauncher((st) => st.launch);
  const busyId = useLauncher((st) => st.busyId);
  const busyName = useLauncher((st) => (st.busyId ? st.snapshot?.instances.find((i) => i.id === st.busyId)?.name : undefined));
  const error = useLauncher((st) => st.error);
  const clearError = useLauncher((st) => st.clearError);
  const running = useLauncher((st) => (inst ? st.snapshot?.running.includes(inst.id) ?? false : false));
  const loaded = useLauncher((st) => st.snapshot !== null);
  const hasInstances = useLauncher((st) => !!st.snapshot?.instances.length);
  const progress = useProgress();
  const navigate = useUi((st) => st.navigate);
  const openNewInstance = useUi((st) => st.openNewInstance);
  const stopping = useGameStopping(inst?.id);
  const [stopError, setStopError] = useState<string | null>(null);
  const statusId = useId();
  const preparing = !!inst && busyId === inst.id;
  const known = !!progress && progress.total > 0;
  const pct = known ? progress.done / progress.total : 0;

  const failure = stopError ?? (inst && error?.id === inst.id ? error.message : null);
  let status = "";
  if (!inst) status = loaded ? "No instances yet" : "";
  else if (running) status = "In game";
  else if (preparing) status = progress ? `${STAGE_LABEL[progress.stage]}…` : "Starting…";
  else if (busyId) status = `Starting ${busyName ?? "another instance"}…`;
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

  const state = loaded && !hasInstances ? "create" : running ? "stop" : preparing ? "busy" : "play";
  // Each state arrives as a new button, but only after a real change: opening Home shows it settled.
  const swap = useChanged(state) && s.swap;

  let action;
  if (loaded && !hasInstances) {
    action = <Button key="create" variant="primary" size="lg" icon="add" className={cx(s.play, swap)} onClick={openNewInstance}>Create instance</Button>;
  } else if (running) {
    action = (
      <Button key="stop" variant="danger" size="lg" icon="stop" className={cx(s.play, swap)} disabled={stopping} onClick={stop}>
        {stopping ? "Stopping" : "Stop"}
      </Button>
    );
  } else if (preparing) {
    action = (
      <Button key="busy" variant="primary" size="lg" className={cx(s.play, swap, s.playBusy, !known && s.playSweep)} disabled aria-busy="true"
        style={{ "--p": pct } as CSSProperties}>
        {progress ? STAGE_LABEL[progress.stage] : "Starting"}
        {known && <span className={cx(s.playPct, "mono")}>{Math.floor(pct * 100)}%</span>}
      </Button>
    );
  } else {
    action = (
      <Button key="play" variant={busyId ? "default" : "primary"} size="lg" icon="play_arrow" className={cx(s.play, swap, !busyId && s.playReady)}
        disabled={!inst || !!busyId} aria-describedby={statusId} onClick={() => inst && launch(inst.id)}>
        Play
      </Button>
    );
  }

  return (
    <div className={s.dockRight}>
      {failure ? (
        <div className={s.failure} role="alert">
          <Icon name="error" className={s.failureIcon} />
          <span id={statusId} className={s.failureText} title={failure}>{failure}</span>
          <IconButton icon="article" label="Open log" onClick={() => navigate("console")} />
          <IconButton icon="close" label="Dismiss" onClick={dismiss} />
        </div>
      ) : (
        <span id={statusId} className={cx(s.status, preparing && s.statusSr, running && s.live)} role="status" title={status}>{status}</span>
      )}
      {action}
    </div>
  );
}
