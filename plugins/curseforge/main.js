// @ts-check
// CurseForge (api.curseforge.com/v1) as a TNLauncher content source, with CurseForge modpack zips.
// Every request needs the user's API key (plugin setting `apiKey`).
/** @typedef {import("../../packages/plugin-api").TN} TN */
/** @typedef {import("../../packages/plugin-api").ProjectKind} ProjectKind */
/** @typedef {import("../../packages/plugin-api").SearchQuery} SearchQuery */
/** @typedef {import("../../packages/plugin-api").Version} Version */
/** @typedef {import("../../packages/plugin-api").PackPlan} PackPlan */

const API = "https://api.curseforge.com/v1";
const MINECRAFT = 432;
/** CurseForge "classes" (sections) per kind. */
export const CLASS = /** @type {const} */ ({ mod: 6, resourcepack: 12, shader: 6552, modpack: 4471 });
/** Instance folder per class; anything else lands in mods/. */
const FOLDER = /** @type {Record<number, string>} */ ({ 6: "mods", 12: "resourcepacks", 6552: "shaderpacks" });
const LOADER_TYPE = /** @type {Record<string, number>} */ ({ forge: 1, fabric: 4, quilt: 5, neoforge: 6 });
const LOADER_NAME = /** @type {Record<number, string>} */ ({ 1: "forge", 4: "fabric", 5: "quilt", 6: "neoforge" });
const CHANNEL = /** @type {const} */ ({ 1: "release", 2: "beta", 3: "alpha" });
const RELATION = /** @type {const} */ ({ 1: "embedded", 2: "optional", 3: "required", 5: "incompatible" });
/** Loaders the launcher can run modpacks on. */
const PACK_LOADERS = ["fabric", "quilt"];
/** Search can't page past this (index + pageSize <= 10,000). */
const MAX_RESULTS = 10000;
const NAME_SORT = "4";

const isGameVersion = (/** @type {string} */ v) => /^\d+\.\d+/.test(v);
const kindOfClass = (/** @type {number} */ id) => Object.entries(CLASS).find(([, c]) => c === id)?.[0] ?? "mod";

/** Search query string for `q`. @param {SearchQuery} q */
export function searchParams(q) {
  /** @type {Record<string, string>} */
  const p = {
    gameId: String(MINECRAFT),
    classId: String(CLASS[q.kind]),
    searchFilter: q.query,
    sortField: q.sort || "2",
    sortOrder: q.sort === NAME_SORT ? "asc" : "desc",
    index: String(q.offset),
    pageSize: String(Math.min(q.limit, 50)),
  };
  if (q.gameVersion) p.gameVersion = q.gameVersion;
  // ponytail: modpacks without a loader filter also list Forge packs, which fail to import; filter once CurseForge's list syntax is confirmed.
  if (q.loader && (q.kind === "mod" || q.kind === "modpack") && LOADER_TYPE[q.loader]) p.modLoaderType = String(LOADER_TYPE[q.loader]);
  if (q.categories.length === 1) p.categoryId = q.categories[0];
  else if (q.categories.length > 1) p.categoryIds = JSON.stringify(q.categories.map(Number));
  return p;
}

/** A CurseForge file as a launcher version. @param {any} f @returns {Version} */
export function version(f) {
  const tags = /** @type {string[]} */ (f.gameVersions ?? []);
  return {
    id: String(f.id),
    name: f.displayName,
    number: f.displayName,
    channel: CHANNEL[/** @type {1|2|3} */ (f.releaseType)] ?? "release",
    gameVersions: tags.filter(isGameVersion),
    // CurseForge tags files with loader names next to game versions.
    loaders: tags.map((t) => t.toLowerCase()).filter((t) => t in LOADER_TYPE),
    published: f.fileDate,
    changelog: null,
    // A missing downloadUrl means the author does not allow third-party downloads; the launcher reports it.
    files: [{ url: f.downloadUrl ?? "", filename: f.fileName, primary: true, size: f.fileLength }],
    dependencies: (f.dependencies ?? [])
      .filter((/** @type {any} */ d) => d.relationType in RELATION)
      .map((/** @type {any} */ d) => ({ projectId: String(d.modId), fileName: null, kind: RELATION[/** @type {1|2|3|5} */ (d.relationType)] })),
  };
}

/** A CurseForge modpack's manifest.json as a launcher plan. `files` is what the API says about its file ids. */
export function plan(/** @type {any} */ manifest, /** @type {any[]} */ files, /** @type {Map<number, number>} */ classOf) {
  const primary = manifest.minecraft?.modLoaders?.find((/** @type {any} */ l) => l.primary) ?? manifest.minecraft?.modLoaders?.[0];
  const [loader = "", loaderVersion = ""] = primary ? String(primary.id).split(/-(.*)/s) : [];
  const blocked = files.filter((f) => !f.downloadUrl).map((f) => f.displayName ?? f.fileName);
  if (blocked.length) throw new Error(`Their authors don't allow launchers to download: ${blocked.join(", ")}. Install this pack from the CurseForge app.`);
  return {
    name: manifest.name,
    gameVersion: manifest.minecraft.version,
    loader,
    loaderVersion,
    files: files.map((f) => ({ path: `${FOLDER[classOf.get(f.modId) ?? 6] ?? "mods"}/${f.fileName}`, urls: [f.downloadUrl], size: f.fileLength ?? null })),
    overrides: [manifest.overrides || "overrides"],
  };
}

/** @param {TN} tn */
export function activate(tn) {
  /**
   * @param {string} path
   * @param {Record<string, string>} [params]
   * @param {object} [body] JSON to POST
   */
  async function request(path, params = {}, body) {
    const key = (await tn.settings.get()).apiKey;
    if (!key) throw new Error("Add your CurseForge API key in Settings → Plugins (get one at console.curseforge.com).");
    const query = new URLSearchParams(params).toString();
    const url = `${API}${path}${query ? `?${query}` : ""}`;
    /** @type {Record<string, string>} */
    const headers = { "x-api-key": String(key), Accept: "application/json" };
    if (body) headers["Content-Type"] = "application/json";
    const res = await tn.net.fetch(url, { method: body ? "POST" : "GET", headers, body: body && JSON.stringify(body) });
    if (res.status === 403) throw new Error("CurseForge refused the API key. Check it in Settings → Plugins.");
    if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
    return /** @type {any} */ (res.json());
  }
  /** The `data` of a response. @type {typeof request} */
  const api = async (...args) => (await request(...args)).data;

  /** @param {any} m */
  const summary = (m) => ({ id: String(m.id), title: m.name, description: m.summary, iconUrl: m.logo?.thumbnailUrl ?? null, kind: kindOfClass(m.classId), url: m.links?.websiteUrl ?? "" });

  tn.sources.register({
    async search(q) {
      const { data, pagination } = await request("/mods/search", searchParams(q));
      return {
        offset: pagination.index,
        total: Math.min(pagination.totalCount, MAX_RESULTS),
        hits: data.map((/** @type {any} */ m) => {
          const indexes = /** @type {any[]} */ (m.latestFilesIndexes ?? []);
          const loaders = [...new Set(indexes.map((i) => LOADER_NAME[i.modLoader]).filter(Boolean))];
          const versions = [...new Set(indexes.map((i) => i.gameVersion).filter(isGameVersion))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
          return {
            id: String(m.id),
            slug: m.slug,
            title: m.name,
            author: m.authors?.[0]?.name ?? "",
            description: m.summary,
            iconUrl: m.logo?.thumbnailUrl ?? null,
            downloads: m.downloadCount,
            follows: m.thumbsUpCount ?? 0,
            categories: [...(m.categories ?? []).map((/** @type {any} */ c) => String(c.id)), ...loaders],
            gameVersions: versions,
            updated: m.dateModified,
            bannerUrl: m.screenshots?.[0]?.thumbnailUrl ?? null,
            color: null,
          };
        }),
      };
    },

    async project(id) {
      const [m, body] = await Promise.all([api(`/mods/${encodeURIComponent(id)}`), api(`/mods/${encodeURIComponent(id)}/description`)]);
      const links = [
        ["CurseForge page", "open_in_new", m.links?.websiteUrl],
        ["Source code", "code", m.links?.sourceUrl],
        ["Issues", "bug_report", m.links?.issuesUrl],
        ["Wiki", "menu_book", m.links?.wikiUrl],
      ];
      return {
        id: String(m.id),
        title: m.name,
        description: m.summary,
        body: String(body ?? ""),
        iconUrl: m.logo?.thumbnailUrl ?? null,
        color: null,
        published: m.dateReleased ?? m.dateCreated ?? "",
        license: null,
        links: links.filter(([, , url]) => url).map(([label, icon, url]) => ({ label, icon, url })),
        gallery: (m.screenshots ?? []).map((/** @type {any} */ s) => ({ url: s.thumbnailUrl, rawUrl: s.url, featured: false, title: s.title || null, description: s.description || null })),
      };
    },

    async projects(ids) {
      if (!ids.length) return [];
      const mods = /** @type {any[]} */ (await api("/mods", {}, { modIds: ids.map(Number) }));
      return mods.map(summary);
    },

    async versions(project, filter) {
      /** @type {Record<string, string>} */
      const params = { pageSize: "50" };
      if (filter.gameVersion) params.gameVersion = filter.gameVersion;
      if (filter.kind === "mod" && filter.loader && LOADER_TYPE[filter.loader]) params.modLoaderType = String(LOADER_TYPE[filter.loader]);
      // ponytail: the newest 50 files only; page through `index` if older ones are ever needed.
      const files = /** @type {any[]} */ (await api(`/mods/${encodeURIComponent(project)}/files`, params));
      const list = files.map(version);
      return filter.kind === "modpack" ? list.filter((v) => v.loaders.some((l) => PACK_LOADERS.includes(l))) : list;
    },

    async identify(fingerprints) {
      if (!fingerprints.length) return {};
      const data = await api(`/fingerprints/${MINECRAFT}`, {}, { fingerprints: fingerprints.map(Number) });
      return Object.fromEntries(
        (data.exactMatches ?? []).map((/** @type {any} */ m) => [String(m.file.fileFingerprint), { projectId: String(m.file.modId), versionNumber: m.file.displayName }])
      );
    },

    async planPack(root) {
      const text = root["manifest.json"];
      if (!text) throw new Error("Not a CurseForge modpack");
      const manifest = JSON.parse(text);
      const entries = /** @type {any[]} */ (manifest.files ?? []).filter((f) => f.required !== false);
      if (!entries.length) return plan(manifest, [], new Map());
      const files = /** @type {any[]} */ (await api("/mods/files", {}, { fileIds: entries.map((f) => f.fileID) }));
      const mods = /** @type {any[]} */ (await api("/mods", {}, { modIds: [...new Set(files.map((f) => f.modId))] }));
      return plan(manifest, files, new Map(mods.map((m) => [m.id, m.classId])));
    },
  });
}
