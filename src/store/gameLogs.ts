// Game output per instance, outside React state: thousands of lines per second must not re-render the app.
import { useSyncExternalStore } from "react";
import { launcher } from "@/api/launcher";
import { broadcast } from "@/plugins/bridge";

export type Level = "debug" | "info" | "warn" | "error";

export interface LogLine {
  /** 1-based line number within the session. */
  n: number;
  raw: string;
  time: string;
  /** `(Source)` for Fabric/Quilt lines, else the thread. */
  origin: string;
  level: Level;
  text: string;
  /** Not a log4j header: stack frames and other output that belongs to the line above. */
  cont: boolean;
}

export interface Session {
  lines: LogLine[];
  /** Bumped on every visible change; the store snapshot. */
  rev: number;
  /** Set on game exit; `stopped` when the user pressed Stop. */
  exit: { code: number | null; stopped: boolean } | null;
  stopping: boolean;
}

const MAX_LINES = 20_000;
// [12:34:56] [Render thread/INFO]: msg   ·   [12:34:56] [main/INFO] (FabricLoader) msg
const HEADER = /^\[(\d\d:\d\d:\d\d)\] \[([^\]]*)\/([A-Z]+)\](?: \(([^)]*)\))?:? ?(.*)$/;
const LEVELS: Record<string, Level> = { TRACE: "debug", DEBUG: "debug", INFO: "info", WARN: "warn", ERROR: "error", FATAL: "error" };

const sessions = new Map<string, Session>();
const listeners = new Set<() => void>();
const dirty = new Set<Session>();
let frame = 0;

function session(id: string): Session {
  let s = sessions.get(id);
  if (!s) sessions.set(id, (s = { lines: [], rev: 0, exit: null, stopping: false }));
  return s;
}

export function parse(raw: string, n: number, prev: LogLine | undefined, err: boolean): LogLine {
  const m = HEADER.exec(raw);
  if (m) return { n, raw, time: m[1], origin: m[4] || m[2], level: LEVELS[m[3]] ?? "info", text: m[5], cont: false };
  // Stray stderr (e.g. "Exception in thread …" before log4j is up) is an error; the rest follows its header.
  return { n, raw, time: "", origin: "", level: err ? "error" : prev?.level ?? "info", text: raw, cont: !!prev };
}

function push(s: Session, raw: string, err: boolean) {
  const last = s.lines[s.lines.length - 1];
  s.lines.push(parse(raw, (last?.n ?? 0) + 1, last, err));
  if (s.lines.length > MAX_LINES) s.lines.splice(0, s.lines.length - MAX_LINES);
}

function changed(s: Session) {
  dirty.add(s);
  frame ||= requestAnimationFrame(() => {
    frame = 0;
    for (const d of dirty) d.rev++;
    dirty.clear();
    listeners.forEach((l) => l());
  });
}

export const gameLogs = {
  /** Starts collecting output; call once, the result unsubscribes. */
  listen: () =>
    launcher.onGameLog(({ id, line, err }) => {
      broadcast("game-log", { instanceId: id, line, err });
      const s = session(id);
      push(s, line, err);
      changed(s);
    }),

  /** A new launch begins with an empty console. */
  reset(id: string) {
    sessions.set(id, { lines: [], rev: (sessions.get(id)?.rev ?? 0) + 1, exit: null, stopping: false });
    changed(session(id));
  },

  /** Returns whether the user stopped the game. */
  exited(id: string, code: number | null): boolean {
    const s = session(id);
    s.exit = { code, stopped: s.stopping };
    s.stopping = false;
    changed(s);
    return s.exit.stopped;
  },

  async stop(id: string) {
    const s = session(id);
    s.stopping = true;
    changed(s);
    try {
      await launcher.stopGame(id);
    } catch (e) {
      s.stopping = false;
      changed(s);
      throw e;
    }
  },

  /** Fills a console that saw no live output this run from the last session's file. */
  async load(id: string) {
    if (sessions.get(id)?.lines.length) return;
    const text = await launcher.readGameLog(id);
    const s = session(id);
    if (s.lines.length || !text) return;
    for (const line of text.split("\n")) if (line) push(s, line, false);
    changed(s);
  },
};

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

/** Re-renders when the instance's log changes; the returned session is mutable, key memos on `rev`. */
export function useGameLog(id: string | undefined): Session | undefined {
  useSyncExternalStore(subscribe, () => (id ? sessions.get(id)?.rev ?? -1 : -1));
  return id ? sessions.get(id) : undefined;
}

/** Just the Stop-pending flag: unlike `useGameLog`, new output lines don't re-render the caller. */
export function useGameStopping(id: string | undefined): boolean {
  return useSyncExternalStore(subscribe, () => (id ? sessions.get(id)?.stopping ?? false : false));
}
