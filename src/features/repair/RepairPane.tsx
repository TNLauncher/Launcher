import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Banner, Button, Icon, IconButton, ProgressBar, Skeleton } from "@/components/ui";
import { useSource } from "@/hooks/useSource";
import { cx } from "@/lib/cx";
import { plural, STAGE_LABEL } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import { autoFix, repair, useRepair, type FixState } from "@/store/repair";
import type { Fix, Instance, Issue, RepairProgress, RepairReport, RepairStep } from "@/types";
import s from "./repair.module.css";

const STEPS: { step: RepairStep; label: string }[] = [
  { step: "game", label: "Game files" },
  { step: "pack", label: "Pack files" },
  { step: "mods", label: "Mod archives" },
];
const ORDER: RepairStep[] = STEPS.map((x) => x.step);

const KIND_ICON: Partial<Record<Issue["kind"], string>> = {
  missing: "extension_off",
  version: "swap_vert",
  game: "history",
  loader: "upgrade",
  conflict: "join_inner",
  duplicate: "content_copy",
  foreign: "block",
  broken: "broken_image",
  packFiles: "inventory_2",
  culprit: "bug_report",
  java: "coffee",
  memory: "memory",
  driver: "developer_board",
  crash: "error",
};

/** The instance's Repair tab: the last crash, a file repair, and the problems found with their fixes. */
export function RepairPane({ instance }: { instance: Instance }) {
  const id = instance.id;
  const e = useRepair(id);
  const running = useLauncher((st) => st.snapshot?.running.includes(id) ?? false);
  const starting = useLauncher((st) => st.busyId === id);
  const source = useSource();
  const qc = useQueryClient();
  const sourceId = source?.id ?? null;
  const d = e.diagnosis;
  const busy = !!e.progress || e.fixingAll;
  const blocked = running || starting;

  useEffect(() => {
    if (!d && !e.diagnosing && !e.diagnoseError) void repair.diagnose(id);
  }, [id, d, e.diagnosing, e.diagnoseError]);

  // Fixes add, swap and turn off files: the Mods tab must not show the old list.
  const applied = e.applied.length;
  useEffect(() => {
    if (applied) void qc.invalidateQueries({ queryKey: ["content", id] });
  }, [applied, qc, id]);

  const open = d?.issues.filter((i) => e.fixes[i.key]?.status !== "done") ?? [];
  const fixable = open.filter((i) => autoFix(i));

  return (
    <div className={s.pane}>
      <div className={s.side}>
        {d?.crashed && <CrashCard cause={d.cause} />}
        <FilesCard
          progress={e.progress}
          report={e.report}
          error={e.repairError}
          disabled={blocked || busy}
          blockedReason={running ? "Close the game to repair it" : starting ? "Wait for the launch to finish" : ""}
          onRun={() => repair.run(id)}
          hasPack={!!instance.pack}
        />
      </div>

      <section className={s.problems} aria-labelledby={`problems-${id}`} aria-busy={e.diagnosing}>
        <header className={s.head}>
          <h3 id={`problems-${id}`}>Problems</h3>
          {open.length > 0 && <span className={cx("mono", s.count)}>{open.length}</span>}
          <div className={s.headActions}>
            {fixable.length > 1 && (
              <Button size="sm" variant="primary" icon="auto_fix_high" loading={e.fixingAll} disabled={blocked || !!e.progress} onClick={() => repair.fixAll(id, sourceId)}>
                Fix all
              </Button>
            )}
            <IconButton icon="refresh" label="Check again" disabled={e.diagnosing || busy} onClick={() => repair.diagnose(id)} />
          </div>
        </header>

        {e.applied.length > 0 && (
          <p className={s.applied}>
            <Icon name="check_circle" fill />
            <span>{e.applied.join(" · ")}</span>
          </p>
        )}

        {e.diagnoseError ? (
          <Banner message={e.diagnoseError} onRetry={() => repair.diagnose(id)} />
        ) : !d ? (
          <div className={s.list}>
            {[0, 1, 2].map((n) => (
              <Skeleton key={n} height={64} className={s.skeleton} />
            ))}
          </div>
        ) : d.issues.length === 0 ? (
          <div className={s.clear}>
            <span className={s.clearMark}>
              <Icon name="verified" fill />
            </span>
            <b>Nothing to fix</b>
            <span>
              {d.mods ? `${plural(d.mods, "mod")} checked: every requirement is met and nothing conflicts.` : "No mods to check, and the last session ended cleanly."}
            </span>
          </div>
        ) : (
          <ul className={cx(s.list, e.diagnosing && s.stale)}>
            {d.issues.map((i) => (
              <IssueRow
                key={i.key}
                issue={i}
                fix={e.fixes[i.key]}
                disabled={blocked || busy}
                onApply={(f) => repair.apply(id, i, f.action, sourceId)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CrashCard({ cause }: { cause: string | null }) {
  const navigate = useUi((st) => st.navigate);
  return (
    <section className={s.crash} aria-label="Last crash">
      <div className={s.crashHead}>
        <Icon name="heart_broken" fill />
        <h3>The last session crashed</h3>
      </div>
      {cause ? <code className={s.cause}>{cause}</code> : <p className={s.crashText}>The log has no exception line.</p>}
      <Button size="sm" variant="link" icon="terminal" onClick={() => navigate("console")}>
        Open the full log
      </Button>
    </section>
  );
}

function stepState(step: RepairStep, progress: RepairProgress | null, report: RepairReport | null): "idle" | "active" | "done" {
  if (progress) {
    const at = ORDER.indexOf(progress.step);
    const me = ORDER.indexOf(step);
    return me < at ? "done" : me === at ? "active" : "idle";
  }
  return report ? "done" : "idle";
}

function stepResult(step: RepairStep, r: RepairReport, hasPack: boolean): { text: string; tone?: "warn" | "fixed" } {
  if (step === "game") return r.gameFiles ? { text: `${plural(r.gameFiles, "file")} restored`, tone: "fixed" } : { text: "All intact" };
  if (step === "pack") {
    if (!hasPack) return { text: "Not a modpack" };
    if (r.packError) return { text: "Could not check", tone: "warn" };
    return r.packFiles ? { text: `${plural(r.packFiles, "file")} restored`, tone: "fixed" } : { text: "All intact" };
  }
  if (r.broken.length) return { text: `${plural(r.broken.length, "damaged jar")}`, tone: "warn" };
  return r.partials ? { text: `${plural(r.partials, "leftover")} cleared`, tone: "fixed" } : { text: "All readable" };
}

function FilesCard(p: {
  progress: RepairProgress | null;
  report: RepairReport | null;
  error: string;
  disabled: boolean;
  blockedReason: string;
  hasPack: boolean;
  onRun(): void;
}) {
  const { progress, report } = p;
  return (
    <section className={s.files} aria-labelledby="repair-files">
      <div className={s.filesHead}>
        <h3 id="repair-files">Repair files</h3>
        <p>Rehashes Minecraft, the loader, libraries, assets and the pack's own files. Damaged ones download again; your mods, worlds and settings stay as they are.</p>
      </div>
      <ol className={s.steps}>
        {STEPS.map(({ step, label }) => {
          const state = stepState(step, progress, report);
          const live = state === "active" && progress;
          const known = live && progress.total > 0;
          const result = state === "done" && !progress && report ? stepResult(step, report, p.hasPack) : null;
          return (
            <li key={step} className={cx(s.step, s[state])}>
              <span className={s.stepMark} aria-hidden="true">
                {state === "done" ? <Icon name="check" /> : state === "active" ? <Icon name="progress_activity" spin /> : null}
              </span>
              <span className={s.stepText}>
                <b>{label}</b>
                {live && step === "game" && progress.stage && <span>{STAGE_LABEL[progress.stage]}</span>}
              </span>
              {known && (
                <span className={cx("mono", s.stepCount)}>
                  {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
                </span>
              )}
              {result && <span className={cx(s.stepResult, result.tone && s[result.tone])}>{result.text}</span>}
              {live && <ProgressBar className={s.stepBar} value={known ? progress.done / progress.total : undefined} />}
            </li>
          );
        })}
      </ol>
      {report?.packError && <p className={s.note}>Pack files were skipped: {report.packError}</p>}
      {report && report.broken.length > 0 && <p className={s.note}>Not restorable, listed under Problems: {report.broken.join(", ")}</p>}
      {p.error && <Banner message={p.error} />}
      <div className={s.filesFoot}>
        <Button icon="build" loading={!!progress} disabled={p.disabled} onClick={p.onRun} title={p.blockedReason || undefined}>
          {progress ? "Repairing" : report ? "Repair again" : "Repair files"}
        </Button>
        {p.blockedReason && <span className={s.reason}>{p.blockedReason}</span>}
      </div>
    </section>
  );
}

function IssueRow({ issue: i, fix, disabled, onApply }: { issue: Issue; fix?: FixState; disabled: boolean; onApply(f: Fix): void }) {
  const done = fix?.status === "done";
  const working = fix?.status === "busy";
  const [first, ...rest] = i.fixes;
  return (
    <li className={cx(s.issue, s[i.severity], done && s.resolved)}>
      <span className={s.issueMark} aria-hidden="true">
        <Icon name={done ? "check_circle" : (KIND_ICON[i.kind] ?? "error")} fill={done} />
      </span>
      <div className={s.issueText}>
        <div className={s.issueTitle}>
          <b>{i.title}</b>
          {i.crash && !done && <span className={s.crashTag}>Caused the crash</span>}
        </div>
        <p>{done ? fix.message : i.detail}</p>
        {fix?.status === "error" && (
          <p className={s.fixError} role="alert">
            <Icon name="error" />
            {fix.message}
          </p>
        )}
        {!done && rest.length > 0 && (
          <div className={s.alts}>
            or
            {rest.map((f) => (
              <Button key={f.label} variant="link" disabled={disabled || working} onClick={() => onApply(f)}>
                {f.label.charAt(0).toLowerCase() + f.label.slice(1)}
              </Button>
            ))}
          </div>
        )}
      </div>
      {!done && first && (
        <Button size="sm" className={s.fixBtn} variant={i.crash ? "primary" : "default"} loading={working} disabled={disabled} title={first.label} onClick={() => onApply(first)}>
          <span className={s.fixLabel}>{first.label}</span>
        </Button>
      )}
    </li>
  );
}
