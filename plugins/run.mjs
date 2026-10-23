// Runs a plugin's content source or account provider outside the launcher, against the real network:
//   node plugins/run.mjs <plugin folder> <method | account.method> [JSON args...]
//   TN_SETTINGS='{"apiKey":"..."}' node plugins/run.mjs plugins/curseforge search '{"kind":"mod","query":"jei","categories":[],"sort":"","offset":0,"limit":3}'
// Like the launcher it only lets `tn.net.fetch` reach the manifest's hosts. No storage, instances or events.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [dir, method, ...args] = process.argv.slice(2);
if (!dir || !method) throw new Error("usage: node plugins/run.mjs <plugin folder> <method> [JSON args...]");
const manifest = JSON.parse(await readFile(resolve(dir, "manifest.json"), "utf8"));
const hosts = manifest.permissions?.hosts ?? [];
const allowed = (url) => {
  const u = new URL(url);
  return u.protocol === "https:" && hosts.some((h) => (h.startsWith("*.") ? u.hostname.endsWith(h.slice(1)) : u.hostname === h));
};

const registered = { source: null, account: null };
const tn = {
  apiVersion: 1,
  context: { instance: null },
  sources: { register: (impl) => (registered.source = impl) },
  accounts: { register: (impl) => (registered.account = impl) },
  settings: { get: async () => JSON.parse(process.env.TN_SETTINGS ?? "{}") },
  net: {
    async fetch(url, init = {}) {
      if (!allowed(url)) throw new Error(`${manifest.name} may not connect to ${url}`);
      const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body });
      const body = await res.text();
      return { status: res.status, ok: res.ok, contentType: res.headers.get("content-type") ?? "", text: () => body, json: () => JSON.parse(body) };
    },
  },
  log: async (...a) => console.error("[log]", ...a),
};

const mod = await import(pathToFileURL(resolve(dir, manifest.main ?? "main.js")).href);
await mod.activate?.(tn);
const [target, name] = method.startsWith("account.") ? ["account", method.slice(8)] : ["source", method];
const impl = registered[target];
if (!impl?.[name]) throw new Error(`${manifest.id} has no ${target} method ${name}`);
console.log(JSON.stringify(await impl[name](...args.map((a) => JSON.parse(a))), null, 2));
