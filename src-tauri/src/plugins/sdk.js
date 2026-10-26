// TNLauncher plugin runtime: defines `window.tn` in every plugin frame. Types: packages/plugin-api.
// Talks to the launcher window over postMessage; the launcher checks each request against the manifest.
(() => {
  const pending = new Map();
  let next = 1;
  /** What the plugin registered, by call target. */
  const registered = { source: null, account: null };
  const listeners = new Map();
  const post = (msg) => parent.postMessage({ tn: 1, ...msg }, "*");
  const message = (err) => String((err && err.message) || err);

  function request(method, params) {
    return new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      post({ type: "request", id, method, params });
    });
  }

  addEventListener("message", async (e) => {
    const m = e.data;
    if (e.source !== parent || !m || m.tn !== 1) return;
    if (m.type === "response") {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.value);
      else p.reject(new Error(m.error));
    } else if (m.type === "event") {
      for (const cb of listeners.get(m.name) || []) {
        try {
          cb(m.payload);
        } catch (err) {
          console.error(err);
        }
      }
    } else if (m.type === "call") {
      try {
        const impl = registered[m.target];
        const fn = impl && impl[m.method];
        if (typeof fn !== "function") {
          if (m.target === "account" && m.method === "skin") {
            post({ type: "result", callId: m.callId, ok: true, value: null });
            return;
          }
          throw new Error(`${m.target}.${m.method} is not implemented`);
        }
        const value = await fn.apply(impl, m.args);
        post({ type: "result", callId: m.callId, ok: true, value: value === undefined ? null : value });
      } catch (err) {
        post({ type: "result", callId: m.callId, ok: false, error: message(err) });
      }
    }
  });

  const tn = Object.freeze({
    apiVersion: 1,
    /** Where this frame is shown: `instance` is set in instance tabs. */
    context: Object.freeze({ instance: new URLSearchParams(location.search).get("instance") }),
    storage: Object.freeze({
      get: (key) => request("storage.get", { key }),
      /** `null` or `undefined` removes the key. */
      set: (key, value) => request("storage.set", { key, value: value === undefined ? null : value }),
    }),
    settings: Object.freeze({ get: () => request("settings.get", null) }),
    instances: Object.freeze({
      list: () => request("instances.list", null),
      get: (id) => request("instances.get", { id }),
      readLog: (id) => request("instances.readLog", { id }),
      mods: (id) => request("instances.mods", { id }),
      crashReports: (id) => request("instances.crashReports", { id }),
      missingFiles: (id) => request("instances.missingFiles", { id }),
      launchSettings: (id) => request("instances.launchSettings", { id }),
      /** Progress arrives as the `repair-progress` event. */
      repair: (id) => request("instances.repair", { id }),
      restoreFiles: (id) => request("instances.restoreFiles", { id }),
      change: (id, change) => request("instances.change", { id, change }),
    }),
    content: Object.freeze({
      identify: (instance, source, kind) => request("content.identify", { instance, source, kind }),
      install: (p) => request("content.install", p),
      setEnabled: (instance, kind, file, enabled) => request("content.setEnabled", { instance, kind, file, enabled }),
      delete: (instance, kind, file) => request("content.delete", { instance, kind, file }),
    }),
    events: Object.freeze({
      /** Returns a function that stops listening. */
      on(name, cb) {
        const set = listeners.get(name) || new Set();
        set.add(cb);
        listeners.set(name, set);
        return () => set.delete(cb);
      },
      /** Sends an event to every frame (`main` and open pages) of this plugin. */
      emit(name, payload) {
        post({ type: "emit", name: String(name), payload: payload === undefined ? null : payload });
      },
    }),
    presence: Object.freeze({
      set: (p) => request("presence.set", p),
      clear: () => request("presence.clear", null),
    }),
    /** Opens a web page in the system browser. */
    open: (url) => request("open", { url: String(url) }),
    sources: Object.freeze({
      search: (source, query) => request("sources.search", { source, query }),
      versions: (source, project, filter) => request("sources.versions", { source, project, filter }),
      register(impl) {
        if (registered.source) throw new Error("A content source is already registered");
        registered.source = impl;
      },
    }),
    accounts: Object.freeze({
      register(impl) {
        if (registered.account) throw new Error("An account provider is already registered");
        registered.account = impl;
      },
    }),
    net: Object.freeze({
      async fetch(url, init = {}) {
        const r = await request("net.fetch", { url, method: init.method, headers: init.headers, body: init.body });
        const ok = r.status >= 200 && r.status < 300;
        const decodeBytes = () => {
          const bin = atob(r.bodyBase64 || "");
          const out = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
          return out;
        };
        return {
          status: r.status,
          ok,
          contentType: r.contentType,
          headers: Object.freeze({ ...(r.headers || {}) }),
          text: () => r.body,
          json: () => JSON.parse(r.body),
          bytes: decodeBytes,
          arrayBuffer: () => decodeBytes().buffer,
        };
      },
    }),
    log: (...args) => {
      console.info("[plugin]", ...args);
      return request("log", args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    },
    // Used by the launcher's boot script.
    async __activate(mod) {
      try {
        if (typeof mod.activate === "function") await mod.activate(tn);
        post({ type: "ready" });
      } catch (err) {
        tn.__fail(err);
      }
    },
    __fail: (err) => post({ type: "failed", error: message(err) }),
  });
  Object.defineProperty(window, "tn", { value: tn });
})();
