import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { launcher } from "@/api/launcher";
import { View } from "@/components/layout/View";
import { Button, Dot, EmptyState, Icon, IconButton, Pill, PillGroup, SearchInput, Select, type Tone } from "@/components/ui";
import { cx } from "@/lib/cx";
import { compact, errorMessage, STAGE_LABEL } from "@/lib/format";
import { gameLogs, useGameLog, type Level, type LogLine, type Session } from "@/store/gameLogs";
import { useLauncher, useProgress, useRecentInstances, useSelectedInstance } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import type { Instance } from "@/types";
import s from "./console.module.css";

type Filter = "all" | "warn" | "error";
/** Folded stack trace (`hidden` frames), or with `open` the point to collapse an expanded one. */
type Fold = { fold: number; hidden: number; open?: boolean };
type Item = LogLine | Fold;

/** Stack traces longer than this many frames collapse to their first frames. */
const SHOW_FRAMES = 3;
/** Pixels from the bottom that still count as following the live tail. */
const STICK_PX = 32;
const RAIL_BUCKETS = 240;

export function ConsoleView() {
  const selected = useSelectedInstance();
  const openNewInstance = useUi((st) => st.openNewInstance);
  if (!selected) {
    return (
      <View className={s.console}>
        <EmptyState icon="terminal" action={<Button variant="primary" icon="add" onClick={openNewInstance}>Create instance</Button>}>
          Game output appears here once you have an instance to launch.
        </EmptyState>
      </View>
    );
  }
  return <Console key={selected.id} instance={selected} />;
}

function Console({ instance }: { instance: Instance }) {
  const log = useGameLog(instance.id);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const [loadError, setLoadError] = useState("");
  const rev = log?.rev ?? 0;

  useEffect(() => {
    gameLogs.load(instance.id).catch((e) => setLoadError(errorMessage(e)));
  }, [instance.id]);

  const lines = log?.lines;
  const counts = useMemo(() => {
    const c = { warn: 0, error: 0, total: 0 };
    for (const l of lines ?? []) {
      if (l.cont) continue;
      c.total++;
      if (l.level === "warn" || l.level === "error") c[l.level]++;
    }
    return c;
    // `lines` mutates in place; `rev` is what changes.
  }, [lines, rev]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Item[] = [];
    let header = 0;
    let run = 0;
    let fold: Fold | null = null;
    for (const l of lines ?? []) {
      if (filter !== "all" && l.level !== filter) continue;
      if (q) {
        if (l.raw.toLowerCase().includes(q)) out.push(l);
        continue;
      }
      if (!l.cont) {
        [header, run, fold] = [l.n, 0, null];
        out.push(l);
      } else if (++run <= SHOW_FRAMES) {
        out.push(l);
      } else if (open.has(header)) {
        if (run === SHOW_FRAMES + 1) out.push({ fold: header, hidden: 0, open: true });
        out.push(l);
      } else if (fold) {
        fold.hidden++;
      } else {
        out.push((fold = { fold: header, hidden: 1 }));
      }
    }
    return out;
  }, [lines, rev, filter, query, open]);

  const toggleFold = (n: number) =>
    setOpen((o) => {
      const next = new Set(o);
      if (!next.delete(n)) next.add(n);
      return next;
    });

  const filtered = filter !== "all" || !!query.trim();
  return (
    <View className={s.console}>
      <Toolbar instance={instance} log={log} filter={filter} setFilter={setFilter} query={query} setQuery={setQuery}
        counts={counts} total={counts.total} items={items} />
      {loadError && <p className={s.consoleLoadError}>Could not read the last log: {loadError}</p>}
      <LogBody instance={instance} items={items} rev={rev} query={query.trim()} filtered={filtered} log={log}
        onToggle={toggleFold}
        onClear={() => [setFilter("all"), setQuery("")]} />
    </View>
  );
}

interface ToolbarProps {
  instance: Instance;
  log: Session | undefined;
  filter: Filter;
  setFilter(f: Filter): void;
  query: string;
  setQuery(q: string): void;
  counts: { warn: number; error: number };
  total: number;
  items: Item[];
}

function Toolbar({ instance, log, filter, setFilter, query, setQuery, counts, total, items }: ToolbarProps) {
  const select = useLauncher((st) => st.select);
  const launch = useLauncher((st) => st.launch);
  const starting = useLauncher((st) => st.busyId === instance.id);
  const busy = useLauncher((st) => st.busyId !== null);
  const running = useLauncher((st) => st.snapshot?.running.includes(instance.id) ?? false);
  const instances = useRecentInstances();
  const search = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        search.current?.select();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = () =>
    navigator.clipboard
      .writeText(items.flatMap((i) => ("raw" in i ? [i.raw] : [])).join("\n"))
      .then(() => setCopied(true), (e) => setActionError(errorMessage(e)));
  const act = (fn: () => Promise<unknown>) => fn().then(() => setActionError(""), (e) => setActionError(errorMessage(e)));

  const pills: { value: Filter; label: string; count: number }[] = [
    { value: "all", label: "All", count: total },
    { value: "warn", label: "Warnings", count: counts.warn },
    { value: "error", label: "Errors", count: counts.error },
  ];

  return (
    <header className={s.consoleBar}>
      <div className={s.consoleBarRow}>
        <div className={s.consoleSession}>
          <Select label="Instance" variant="pill" value={instance.id} onChange={select}
            options={instances.map((i) => ({ value: i.id, label: i.name, hint: i.version }))} />
          <SessionState instance={instance} log={log} error={actionError} />
        </div>
        <div className={s.consoleActions}>
          <IconButton icon={copied ? "check" : "content_copy"} label="Copy visible lines" title={copied ? "Copied" : undefined} disabled={!items.length} onClick={copy} />
          <IconButton icon="folder_open" label="Open instance folder" onClick={() => act(() => launcher.openInstanceDir(instance.id))} />
          {running ? (
            <Button variant="danger" icon="stop" className={s.runBtn} disabled={log?.stopping} onClick={() => act(() => gameLogs.stop(instance.id))}>
              {log?.stopping ? "Stopping" : "Stop"}
            </Button>
          ) : (
            <Button variant="primary" icon="play_arrow" className={s.runBtn} loading={starting} disabled={busy} onClick={() => launch(instance.id)}>
              {starting ? "Starting" : "Launch"}
            </Button>
          )}
        </div>
      </div>
      <div className={s.consoleBarRow}>
        <PillGroup label="Level">
          {pills.map((p) => (
            <Pill key={p.value} tone={p.value === "all" ? undefined : p.value} pressed={filter === p.value} onClick={() => setFilter(p.value)} count={p.count ? compact(p.count) : 0}>
              {p.label}
            </Pill>
          ))}
        </PillGroup>
        <SearchInput ref={search} className={s.consoleSearch} type="search" label="Filter lines"
          value={query} onChange={setQuery}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}>
          <kbd className="mono">Ctrl F</kbd>
        </SearchInput>
      </div>
    </header>
  );
}

function SessionState({ instance, log, error }: { instance: Instance; log: Session | undefined; error: string }) {
  const preparing = useLauncher((st) => st.busyId === instance.id);
  const running = useLauncher((st) => st.snapshot?.running.includes(instance.id) ?? false);
  const progress = useProgress();

  let [label, tone]: [string, Tone] = ["Not running", "neutral"];
  if (error) [label, tone] = [error, "red"];
  else if (preparing && progress) [label, tone] = [`Preparing · ${STAGE_LABEL[progress.stage]}`, "orange"];
  else if (running && log?.stopping) [label, tone] = ["Stopping…", "orange"];
  else if (running) return <Running since={instance.lastPlayed} />;
  else if (log?.exit?.stopped) [label, tone] = ["Stopped", "neutral"];
  else if (log?.exit?.code === 0) [label, tone] = ["Exited normally", "green"];
  else if (log?.exit?.code) [label, tone] = [`Crashed · exit code ${log.exit.code}`, "red"];
  else if (log?.exit) [label, tone] = ["Exited", "neutral"];
  else if (log?.lines.length) [label, tone] = ["Last session", "neutral"];

  return (
    <span className={cx(s.sessionState, tone !== "neutral" && s[tone])} role="status">
      <Dot tone={tone} />
      <span title={label}>{label}</span>
    </span>
  );
}

function Running({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);
  const sec = Math.max(0, Math.floor(now - since));
  const hms = [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60].map((v) => String(v).padStart(2, "0"));
  return (
    <span className={cx(s.sessionState, s.live)} role="status">
      <Dot tone="blue" className={s.liveDot} />
      Running <span className="mono">{sec < 3600 ? hms.slice(1).join(":") : hms.join(":")}</span>
    </span>
  );
}

interface BodyProps {
  instance: Instance;
  log: Session | undefined;
  items: Item[];
  rev: number;
  query: string;
  filtered: boolean;
  onToggle(n: number): void;
  onClear(): void;
}

function LogBody({ instance, log, items, rev, query, filtered, onToggle, onClear }: BodyProps) {
  const starting = useLauncher((st) => st.busyId === instance.id);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [following, setFollowing] = useState(true);
  const [seen, setSeen] = useState(0);
  const [flash, setFlash] = useState(0);
  const lastN = log?.lines[log.lines.length - 1]?.n ?? 0;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [rev, items]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(0), 1400);
    return () => clearTimeout(t);
  }, [flash]);

  const onScroll = () => {
    const el = scroller.current!;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    if (atEnd === stick.current) return;
    stick.current = atEnd;
    setFollowing(atEnd);
    if (!atEnd) setSeen(lastN);
  };

  const follow = () => {
    const el = scroller.current!;
    stick.current = true;
    setFollowing(true);
    el.scrollTo({ top: el.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  const jump = (n: number) => {
    scroller.current?.querySelector(`[data-n="${n}"]`)?.scrollIntoView({ block: "center" });
    setFlash(n);
  };

  // One tick per bucket so a log with thousands of warnings stays a readable strip.
  const ticks = useMemo(() => {
    const out = new Map<number, { n: number; level: Level }>();
    items.forEach((it, i) => {
      if ("fold" in it || it.cont || (it.level !== "warn" && it.level !== "error")) return;
      const b = Math.floor((i / items.length) * RAIL_BUCKETS);
      if (out.get(b)?.level !== "error") out.set(b, { n: it.n, level: it.level });
    });
    return [...out].map(([b, t]) => ({ ...t, top: (b / RAIL_BUCKETS) * 100 }));
  }, [items]);

  if (!items.length) {
    let empty = <EmptyState icon="terminal">No output yet. Launch {instance.name} and its log streams here live.</EmptyState>;
    if (filtered && log?.lines.length) {
      empty = (
        <EmptyState icon="filter_alt_off" action={<Button onClick={onClear}>Show all lines</Button>}>
          No lines match this filter.
        </EmptyState>
      );
    } else if (starting) {
      empty = <EmptyState icon="hourglass_top">Waiting for the game to start…</EmptyState>;
    }
    return <div className={s.consoleBody}>{empty}</div>;
  }

  const fresh = following ? 0 : lastN - seen;
  return (
    <div className={s.consoleBody}>
      <div className={cx(s.log, "selectable")} ref={scroller} onScroll={onScroll} role="log" aria-label={`${instance.name} game output`}>
        {items.map((it) =>
          "fold" in it ? (
            <button key={`f${it.fold}`} className={s.logFold} aria-expanded={!!it.open} onClick={() => onToggle(it.fold)}>
              <Icon name={it.open ? "unfold_less" : "unfold_more"} />
              {it.open ? "Collapse trace" : `${it.hidden} more ${it.hidden === 1 ? "line" : "lines"}`}
            </button>
          ) : (
            <Line key={it.n} line={it} query={query} flash={flash === it.n} />
          )
        )}
      </div>
      <div className={s.rail} aria-hidden="true">
        {ticks.map((t) => (
          <button key={t.n} tabIndex={-1} className={cx(s.tick, s[t.level])} style={{ top: `${t.top}%` }} onClick={() => jump(t.n)} />
        ))}
      </div>
      {!following && (
        <Button icon="arrow_downward" className={s.follow} onClick={follow}>
          {fresh > 0 ? `${compact(fresh)} new ${fresh === 1 ? "line" : "lines"}` : "Jump to latest"}
        </Button>
      )}
    </div>
  );
}

// Memoized: a log line never changes, so each new batch of output renders only the new lines.
const Line = memo(function Line({ line: l, query, flash }: { line: LogLine; query: string; flash: boolean }) {
  return (
    <div className={cx(s.ln, s[l.level], l.cont && s.cont, flash && s.flash)} data-n={l.n}>
      <span className={s.lnN}>{l.n}</span>
      <span className={s.lnTime}>{l.time}</span>
      <span className={s.lnOrigin} title={l.origin || undefined}>{l.origin}</span>
      <span className={s.lnText}>{query ? <Marked text={l.text} query={query} /> : l.text || " "}</span>
    </div>
  );
});

function Marked({ text, query }: { text: string; query: string }) {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts = [];
  let at = 0;
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, at)) {
    parts.push(text.slice(at, i), <mark key={i}>{text.slice(i, i + q.length)}</mark>);
    at = i + q.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}
