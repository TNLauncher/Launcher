// TNLauncher plugin runtime: defines `window.tn` in every plugin frame. Types: packages/plugin-api.
// Talks to the launcher window over postMessage; the launcher checks each request against the manifest.
(() => {
  const pending = new Map();
  let next = 1;
  let source = null;
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
    } else if (m.type === "call") {
      try {
        const fn = source && source[m.method];
        if (typeof fn !== "function") throw new Error(`${m.method} is not implemented`);
        const value = await fn.apply(source, m.args);
        post({ type: "result", callId: m.callId, ok: true, value: value === undefined ? null : value });
      } catch (err) {
        post({ type: "result", callId: m.callId, ok: false, error: message(err) });
      }
    }
  });

  const tn = Object.freeze({
    apiVersion: 1,
    sources: Object.freeze({
      register(impl) {
        if (source) throw new Error("A content source is already registered");
        source = impl;
      },
    }),
    net: Object.freeze({
      async fetch(url, init = {}) {
        const r = await request("net.fetch", { url, method: init.method, headers: init.headers, body: init.body });
        const ok = r.status >= 200 && r.status < 300;
        return { status: r.status, ok, contentType: r.contentType, text: () => r.body, json: () => JSON.parse(r.body) };
      },
    }),
    log: (...args) => request("log", args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")),
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
