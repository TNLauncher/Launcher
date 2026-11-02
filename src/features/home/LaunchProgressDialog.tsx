import { useState } from "react";
import { launcher } from "@/api/launcher";
import { Button, Dialog, Icon, ProgressBar } from "@/components/ui";
import { cx } from "@/lib/cx";
import { errorMessage, launchStages, STAGE_LABEL } from "@/lib/format";
import type { Progress } from "@/store/LauncherContext";
import type { Instance } from "@/types";
import s from "./home.module.css";

/** Every stage of a launch that is still downloading, with a way out. */
export function LaunchProgressDialog({ open, onClose, inst, progress }: { open: boolean; onClose(): void; inst: Instance; progress: Progress }) {
  const [error, setError] = useState<string | null>(null);
  const stages = launchStages(!!inst.runtime);
  const pct = Math.floor(progress.overall * 100);
  // Past this point the game is spawning; there is nothing left to cancel.
  const starting = progress.stage === "starting";

  function cancel() {
    setError(null);
    launcher.cancelLaunch(inst.id).catch((e) => setError(errorMessage(e)));
  }

  return (
    <Dialog open={open} onClose={onClose} className={s.stagesDialog} title={`Downloading ${inst.name}`}
      aside={<span className={s.stagesPct}>{pct}%</span>}
      actions={
        <>
          <Button onClick={onClose}>Hide</Button>
          <Button variant="danger" icon="close" disabled={starting} onClick={cancel}>Cancel download</Button>
        </>
      }>
      <ProgressBar value={progress.overall || undefined} />
      <ul className={s.stages}>
        {stages.map(([stage], i) => {
          const done = i < progress.step || starting;
          const current = !done && i === progress.step && progress.stage === stage;
          return (
            <li key={stage} className={cx(s.stage, current && s.stageCurrent)} aria-current={current ? "step" : undefined}>
              <span className={s.stageMark}>{done ? <Icon name="check_circle" fill /> : <span className={s.stageRing} />}</span>
              <span className={s.stageName}>{STAGE_LABEL[stage]}</span>
              {current && progress.total > 0 && <span className={s.stageCount}>{progress.done} / {progress.total}</span>}
            </li>
          );
        })}
      </ul>
      {error && <p className={s.stagesError} role="alert">{error}</p>}
    </Dialog>
  );
}
