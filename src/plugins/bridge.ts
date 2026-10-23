// The launcher side of the plugin bridge. Plugin frames are sandboxed iframes (opaque origin, no Tauri);
// they talk to this window over postMessage and this module relays to Rust, naming the plugin by the
// frame a message came from, never by what the message says. Protocol: src-tauri/src/plugins/sdk.js.
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import { call } from "@/api/ipc";

/** A `plugin-call` event from Rust: run `method(...args)` in the plugin's background frame. */
interface PluginCall {
  id: number;
  plugin: string;
  method: string;
  args: unknown[];
}

interface Frame {
  plugin: string;
  /** Runs `main` and answers calls; pages only send requests. */
  background: boolean;
}

interface Background {
  win: Window;
  ready: boolean;
  /** Calls that arrived before `ready`. */
  queue: PluginCall[];
}

const frames = new Map<Window, Frame>();
const backgrounds = new Map<string, Background>();
/** Calls for plugins whose background frame is not mounted yet. */
const waiting = new Map<string, PluginCall[]>();
/** Which plugin each call in flight went to, so only that plugin's frame can answer it. */
const inFlight = new Map<number, string>();
/** Frames whose plugin finished `activate`; kept on the window so a remount (StrictMode) stays ready. */
const readyFrames = new WeakSet<Window>();

let failures: Record<string, string> = {};
const subscribers = new Set<() => void>();
function setFailure(plugin: string, error: string | null) {
  const { [plugin]: _, ...rest } = failures;
  failures = error ? { ...rest, [plugin]: error } : rest;
  subscribers.forEach((f) => f());
}

/** Plugins whose `activate` threw, by id. */
export const usePluginFailures = () =>
  useSyncExternalStore(
    (f) => (subscribers.add(f), () => subscribers.delete(f)),
    () => failures
  );

/** The `plugin` scheme root for this platform (`plugin://localhost/`, `http://plugin.localhost/` on Windows). */
export const pluginBase = convertFileSrc("", "plugin");

const post = (win: Window, msg: object) => win.postMessage({ tn: 1, ...msg }, "*");
const reply = (id: number, ok: boolean, value: unknown) => {
  inFlight.delete(id);
  return call<void>("plugin_reply", { id, ok, value: value ?? null });
};
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function deliver(c: PluginCall) {
  const bg = backgrounds.get(c.plugin);
  if (!bg) {
    waiting.set(c.plugin, [...(waiting.get(c.plugin) ?? []), c]);
  } else if (!bg.ready) {
    bg.queue.push(c);
  } else {
    inFlight.set(c.id, c.plugin);
    post(bg.win, { type: "call", callId: c.id, method: c.method, args: c.args });
  }
}

function fail(plugin: string, error: string) {
  const bg = backgrounds.get(plugin);
  for (const c of [...(bg?.queue ?? []), ...(waiting.get(plugin) ?? [])]) void reply(c.id, false, `${plugin} failed to start: ${error}`);
  if (bg) bg.queue = [];
  waiting.delete(plugin);
}

/** Registers a mounted plugin frame; returns its cleanup. */
export function attachFrame(win: Window, plugin: string, background: boolean): () => void {
  frames.set(win, { plugin, background });
  if (background) {
    const bg: Background = { win, ready: readyFrames.has(win), queue: [] };
    backgrounds.set(plugin, bg);
    waiting.get(plugin)?.forEach(deliver);
    waiting.delete(plugin);
  }
  return () => {
    frames.delete(win);
    const bg = backgrounds.get(plugin);
    if (background && bg?.win === win) {
      // Unmounted (turned off, or a dev remount): calls wait for the next frame; Rust times them out.
      waiting.set(plugin, [...(waiting.get(plugin) ?? []), ...bg.queue]);
      backgrounds.delete(plugin);
    }
  };
}

window.addEventListener("message", (e) => {
  const frame = e.source && frames.get(e.source as Window);
  const m = e.data;
  if (!frame || !m || m.tn !== 1) return;
  const win = e.source as Window;
  const bg = frame.background ? backgrounds.get(frame.plugin) : undefined;

  switch (m.type) {
    case "ready":
      if (!bg) return;
      readyFrames.add(win);
      setFailure(frame.plugin, null);
      bg.ready = true;
      bg.queue.splice(0).forEach(deliver);
      break;
    case "failed":
      if (!bg) return;
      setFailure(frame.plugin, String(m.error));
      fail(frame.plugin, String(m.error));
      break;
    case "result":
      if (!bg || inFlight.get(m.callId) !== frame.plugin) return;
      void reply(m.callId, !!m.ok, m.ok ? m.value : String(m.error));
      break;
    case "request":
      call<unknown>("plugin_request", { plugin: frame.plugin, method: String(m.method), params: m.params ?? null }).then(
        (value) => post(win, { type: "response", id: m.id, ok: true, value }),
        (err) => post(win, { type: "response", id: m.id, ok: false, error: errorText(err) })
      );
      break;
  }
});

// Started at import, before anything can ask Rust for a plugin call; Rust holds calls until then.
void listen<PluginCall>("plugin-call", (e) => deliver(e.payload)).then(() => call<void>("plugin_host_ready"));
