import { useQuery } from "@tanstack/react-query";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { launcher } from "@/api/launcher";
import { EmptyState, Icon, Pill, PillGroup } from "@/components/ui";
import { cx } from "@/lib/cx";
import { compact, errorMessage } from "@/lib/format";
import { gameLogs, useGameLog, type LogLine } from "@/store/gameLogs";
import { useLauncher } from "@/store/LauncherContext";
import s from "./logs.module.css";

type Kind = "log" | "crash";
type Filter = "all" | "warn" | "error";
/** Game log lines are used as they are (no copy per frame); `debug` draws like info. */
type Row = Pick<LogLine, "n" | "raw" | "level">;

const SOURCES: Record<Kind, { label: string; icon: string }> = {
  log: { label: "Game log", icon: "description" },
  crash: { label: "Crash report", icon: "heart_broken" },
};
/** Lines drawn at once. */
const SHOWN = 4000;

const ERROR = /[[/](ERROR|FATAL|SEVERE)\]|^(\S+\.)?\S*(Exception|Error)(:|$)/;
const WARN = /[[/]WARN(ING)?\]/;
/** Stack frames and `Caused by` lines belong to the line they follow. */
const CONTINUES = /^\s+at |^\s*\.\.\. \d+ more|^Caused by: |^\s+Suppressed: /;

/** Crash reports aren't log4j: each line's level, a stack trace taking the level of the line that threw it. */
export function classify(text: string): Row[] {
  let last: Row["level"] = "info";
  return text.replace(/\n$/, "").split("\n").map((line, i) => {
    last = CONTINUES.test(line) ? last : ERROR.test(line) ? "error" : WARN.test(line) ? "warn" : "info";
    return { n: i + 1, raw: line, level: last };
  });
}

/** The game log and crash report of one instance. Sharing them is left to plugins (mclogs adds a tab). */
export function Logs({ instanceId }: { instanceId: string }) {
  const log = useGameLog(instanceId);
  const running = useLauncher((st) => st.snapshot?.running.includes(instanceId) ?? false);
  // A finished session may leave a new crash report.
  const crash = useQuery({ queryKey: ["crash-report", instanceId, running], queryFn: () => launcher.readCrashReport(instanceId) });
  const [loadError, setLoadError] = useState("");
  const [picked, setPicked] = useState<Kind | null>(null);

  useEffect(() => {
    gameLogs.load(instanceId).catch((e) => setLoadError(errorMessage(e)));
  }, [instanceId]);

  const rev = log?.rev ?? 0;
  const rows = useMemo<Record<Kind, Row[]>>(
    () => ({
      log: log?.lines.slice() ?? [],
      crash: crash.data?.trim() ? classify(crash.data) : [],
    }),
    // `log.lines` mutates in place; `rev` is what changes.
    [log, rev, crash.data]
  );
  // A crash is what you look at first.
  const selected: Kind = picked === "log" || !rows.crash.length ? "log" : "crash";

  return (
    <div className={s.layout}>
      <section className={s.pane} aria-labelledby="logs-title">
        <div className={s.head}>
          <h3 id="logs-title">Logs</h3>
          <p>What the game printed in its last session.</p>
        </div>
        <ul className={s.sources}>
          {(["log", "crash"] as const).map((kind) =>
            kind === "crash" && !rows.crash.length ? null : (
              <Source key={kind} kind={kind} lines={rows[kind].length} selected={selected === kind} onSelect={() => setPicked(kind)} />
            )
          )}
        </ul>
      </section>
      <Preview key={selected} title={SOURCES[selected].label} rows={rows[selected]} rev={rev} error={selected === "log" ? loadError : ""} />
    </div>
  );
}

interface SourceProps { kind: Kind; lines: number; selected: boolean; onSelect(): void }

function Source({ kind, lines, selected, onSelect }: SourceProps) {
  const { label, icon } = SOURCES[kind];
  const meta = kind === "log" ? (lines ? `Last session · ${lines.toLocaleString()} lines` : "Nothing yet: launch the game first") : `From the last crash · ${lines.toLocaleString()} lines`;
  return (
    <li className={cx(s.source, s[kind])} tabIndex={0} aria-current={selected} title={`Preview the ${label.toLowerCase()}`} onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect())}>
      <span className={s.mark} aria-hidden="true"><Icon name={icon} /></span>
      <div className={s.text}>
        <b>{label}</b>
        <span>{meta}</span>
      </div>
    </li>
  );
}

function Preview({ title, rows, rev, error }: { title: string; rows: Row[]; rev: number; error: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const scroller = useRef<HTMLDivElement>(null);
  const counts = useMemo(() => ({ all: rows.length, warn: rows.filter((r) => r.level === "warn").length, error: rows.filter((r) => r.level === "error").length }), [rows]);
  const active = filter !== "all" && !counts[filter] ? "all" : filter;
  const matching = active === "all" ? rows : rows.filter((r) => r.level === active);
  const shown = matching.slice(-SHOWN);

  // The end of a log is where it broke; live output keeps it there only while the reader hasn't scrolled up.
  const stick = useRef(true);
  const stuckFilter = useRef(active);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (stuckFilter.current !== active) (stuckFilter.current = active), (stick.current = true);
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [rev, active, rows]);

  return (
    <section className={cx(s.pane, s.viewer)} aria-label={title}>
      <header className={s.viewerHead}>
        <h3>{title}</h3>
        <PillGroup label="Show">
          {([["all", "All"], ["warn", "Warnings"], ["error", "Errors"]] as const).map(([f, label]) => (
            <Pill key={f} tone={f === "all" ? undefined : f} pressed={active === f} disabled={f !== "all" && !counts[f]} onClick={() => setFilter(f)} count={compact(counts[f])}>
              {label}
            </Pill>
          ))}
        </PillGroup>
      </header>
      {error && <p className={s.loadError}>Could not read the last log: {error}</p>}
      {rows.length ? (
        <div className={cx(s.lines, "selectable")} ref={scroller} role="log" tabIndex={0}
          onScroll={(e) => (stick.current = e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 40)}>
          {shown.length < matching.length && (
            <p className={s.logNote}>Showing the last {shown.length.toLocaleString()} of {matching.length.toLocaleString()} lines.</p>
          )}
          {shown.map((r) => <Line key={r.n} {...r} />)}
        </div>
      ) : (
        <EmptyState icon="article">Nothing to show yet. Launch the game and its log appears here.</EmptyState>
      )}
    </section>
  );
}

// Memoized: a log line never changes, so live output renders only the new lines.
const Line = memo(function Line({ n, raw, level }: Row) {
  return (
    <div className={cx(s.ln, s[level])}>
      <span>{n}</span>
      <span>{raw || " "}</span>
    </div>
  );
});
