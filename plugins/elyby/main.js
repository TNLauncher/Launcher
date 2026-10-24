// @ts-check
// Ely.by accounts (Yggdrasil API at authserver.ely.by). The game reaches Ely.by's skins and session
// server through authlib-injector, loaded as a Java agent.
/** @typedef {import("../../packages/plugin-api").TN} TN */

const AUTH = "https://authserver.ely.by/auth";
const AUTHLIB_API = "https://authserver.ely.by/api/authlib-injector";
const SKINS = "https://skinsystem.ely.by/textures";
const AUTHLIB_LATEST = "https://authlib-injector.yushi.moe/artifact/latest.json";

/** @param {TN} tn */
export function activate(tn) {
  /** POSTs to the auth server; resolves with the JSON, or null for 204. @param {string} path @param {object} body */
  async function post(path, body) {
    const res = await tn.net.fetch(`${AUTH}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const text = res.text();
    const data = text ? /** @type {any} */ (JSON.parse(text)) : null;
    if (!res.ok) throw Object.assign(new Error(data?.errorMessage ?? `Ely.by returned HTTP ${res.status}`), { status: res.status });
    return data;
  }

  /** The newest authlib-injector jar. */
  async function agent() {
    const res = await tn.net.fetch(AUTHLIB_LATEST);
    if (!res.ok) throw new Error(`authlib-injector metadata returned HTTP ${res.status}`);
    const meta = /** @type {any} */ (res.json());
    return { url: meta.download_url, filename: `authlib-injector-${meta.version}.jar`, options: AUTHLIB_API };
  }

  tn.accounts.register({
    async login({ username, password }) {
      if (!username || !password) throw new Error("Enter your Ely.by login and password");
      const clientToken = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
      const r = await post("authenticate", { username, password, clientToken, requestUser: true });
      return { name: r.selectedProfile.name, uuid: r.selectedProfile.id, data: { accessToken: r.accessToken, clientToken: r.clientToken } };
    },

    async session(account) {
      const stored = /** @type {{ accessToken: string, clientToken: string }} */ (account.data);
      let { accessToken, clientToken } = stored;
      let name = account.name;
      try {
        await post("validate", { accessToken });
      } catch {
        // Expired: trade it for a new one; if that fails too the user signs in again.
        try {
          const r = await post("refresh", { accessToken, clientToken, requestUser: true });
          accessToken = r.accessToken;
          name = r.selectedProfile?.name ?? name;
        } catch (err) {
          throw new Error(`Ely.by sign-in expired, sign in again (${/** @type {Error} */ (err).message})`);
        }
      }
      return { name, uuid: account.uuid, token: accessToken, userType: "mojang", data: { accessToken, clientToken }, javaAgent: await agent() };
    },

    async skin(account) {
      // 204 = no skin set.
      const res = await tn.net.fetch(`${SKINS}/${encodeURIComponent(account.name)}`);
      const skin = res.ok && res.status !== 204 ? /** @type {any} */ (res.json()).SKIN : null;
      return skin?.url ? { url: skin.url, slim: skin.metadata?.model === "slim" } : null;
    },
  });
}
