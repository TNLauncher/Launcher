// @ts-check
// Modrinth (api.modrinth.com/v2) as a TNLauncher content source, with `.mrpack` modpacks.
/** @typedef {import("../../packages/plugin-api").TN} TN */
/** @typedef {import("../../packages/plugin-api").ProjectKind} ProjectKind */
/** @typedef {import("../../packages/plugin-api").SearchQuery} SearchQuery */
/** @typedef {import("../../packages/plugin-api").Version} Version */
/** @typedef {import("../../packages/plugin-api").PackPlan} PackPlan */

const API = "https://api.modrinth.com/v2";
const IDS_PER_REQUEST = 100;
/** Loaders the launcher can run modpacks on. */
const PACK_LOADERS = ["fabric", "quilt"];

/**
 * Version loaders each kind is published under; null = don't filter.
 * @param {ProjectKind} kind
 * @param {string | null | undefined} loader
 */
export function loaders(kind, loader) {
  switch (kind) {
    case "mod":
      return loader ? [loader] : null;
    case "shader":
      return ["iris", "optifine"];
    case "resourcepack":
      return ["minecraft"];
    case "modpack":
      return loader ? [loader] : PACK_LOADERS;
  }
}

/**
 * Search facets: outer list is AND, inner lists are OR.
 * @param {SearchQuery} q
 */
export function facets(q) {
  const f = [[`project_type:${q.kind}`]];
  if (q.gameVersion) f.push([`versions:${q.gameVersion}`]);
  // Resource packs are tagged `minecraft`, which search does not index as a category.
  const ls = q.kind === "resourcepack" ? null : loaders(q.kind, q.loader);
  if (ls) f.push(ls.map((l) => `categories:${l}`));
  for (const c of q.categories) f.push([`categories:${c}`]);
  return f;
}

/**
 * The `.mrpack` index as a launcher plan.
 * @param {any} index modrinth.index.json
 * @returns {PackPlan}
 */
export function plan(index) {
  const deps = index.dependencies ?? {};
  if (!deps.minecraft) throw new Error("Modpack has no Minecraft version");
  let loader = "";
  let loaderVersion = "";
  if (deps["fabric-loader"]) [loader, loaderVersion] = ["fabric", deps["fabric-loader"]];
  else if (deps["quilt-loader"]) [loader, loaderVersion] = ["quilt", deps["quilt-loader"]];
  else if (deps.forge || deps.neoforge) throw new Error("Forge and NeoForge modpacks are not supported");
  return {
    name: index.name,
    gameVersion: deps.minecraft,
    loader,
    loaderVersion,
    files: (index.files ?? [])
      .filter((/** @type {any} */ f) => f.env?.client !== "unsupported")
      .map((/** @type {any} */ f) => ({ path: f.path, urls: f.downloads, size: f.fileSize ?? null })),
    // client-overrides go second so they win over the shared ones.
    overrides: ["overrides", "client-overrides"],
  };
}

const enc = encodeURIComponent;
const pageUrl = (/** @type {string} */ kind, /** @type {string} */ slug) => `https://modrinth.com/${kind}/${slug}`;

/** @param {any} v @returns {Version} */
const version = (v) => ({
  id: v.id,
  name: v.name,
  number: v.version_number,
  channel: v.version_type,
  gameVersions: v.game_versions,
  loaders: v.loaders,
  published: v.date_published,
  changelog: v.changelog ?? null,
  files: v.files.map((/** @type {any} */ f) => ({ url: f.url, filename: f.filename, primary: f.primary, size: f.size })),
  dependencies: v.dependencies.map((/** @type {any} */ d) => ({ projectId: d.project_id ?? null, fileName: d.file_name ?? null, kind: d.dependency_type })),
});

/** @param {TN} tn */
export function activate(tn) {
  /**
   * @param {string} path
   * @param {Record<string, string>} [params]
   * @param {string} [body] JSON to POST
   */
  async function api(path, params = {}, body) {
    const query = new URLSearchParams(params).toString();
    const url = `${API}${path}${query ? `?${query}` : ""}`;
    const init = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body } : {};
    const res = await tn.net.fetch(url, init);
    if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
    return res.json();
  }

  tn.sources.register({
    async search(q) {
      const res = /** @type {any} */ (
        await api("/search", {
          query: q.query,
          index: q.sort || "relevance",
          limit: String(q.limit),
          offset: String(q.offset),
          facets: JSON.stringify(facets(q)),
        })
      );
      return {
        offset: res.offset,
        total: res.total_hits,
        hits: res.hits.map((/** @type {any} */ h) => ({
          id: h.project_id,
          slug: h.slug,
          title: h.title,
          author: h.author,
          description: h.description,
          iconUrl: h.icon_url ?? null,
          downloads: h.downloads,
          follows: h.follows ?? 0,
          categories: h.categories,
          gameVersions: h.versions,
          updated: h.date_modified,
          bannerUrl: h.featured_gallery ?? null,
          color: h.color ?? null,
        })),
      };
    },

    async project(id) {
      const p = /** @type {any} */ (await api(`/project/${enc(id)}`));
      const links = [
        ["Modrinth page", "open_in_new", pageUrl(p.project_type, p.slug)],
        ["Source code", "code", p.source_url],
        ["Issues", "bug_report", p.issues_url],
        ["Wiki", "menu_book", p.wiki_url],
        ["Discord", "forum", p.discord_url],
      ];
      return {
        id: p.id,
        title: p.title,
        description: p.description,
        body: p.body ?? "",
        iconUrl: p.icon_url ?? null,
        color: p.color ?? null,
        published: p.published ?? "",
        license: p.license ? p.license.id.replace(/^LicenseRef-/, "") : null,
        links: links.filter(([, , url]) => url).map(([label, icon, url]) => ({ label, icon, url })),
        gallery: (p.gallery ?? []).map((/** @type {any} */ g) => ({
          url: g.url,
          rawUrl: g.raw_url,
          featured: g.featured,
          title: g.title ?? null,
          description: g.description ?? null,
        })),
      };
    },

    async projects(ids) {
      const chunks = [];
      for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) chunks.push(ids.slice(i, i + IDS_PER_REQUEST));
      const lists = await Promise.all(chunks.map((c) => api("/projects", { ids: JSON.stringify(c) })));
      return lists.flat().map((/** @type {any} */ p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        iconUrl: p.icon_url ?? null,
        kind: p.project_type,
        url: pageUrl(p.project_type, p.slug),
      }));
    },

    async versions(project, filter) {
      /** @type {Record<string, string>} */
      const params = {};
      const ls = loaders(filter.kind, filter.loader);
      if (ls) params.loaders = JSON.stringify(ls);
      if (filter.gameVersion) params.game_versions = JSON.stringify([filter.gameVersion]);
      const list = /** @type {any[]} */ (await api(`/project/${enc(project)}/version`, params));
      return list.map(version);
    },

    async identify(sha1) {
      const found = /** @type {Record<string, any>} */ (await api("/version_files", {}, JSON.stringify({ hashes: sha1, algorithm: "sha1" })));
      return Object.fromEntries(Object.entries(found).map(([hash, v]) => [hash, { projectId: v.project_id, versionNumber: v.version_number }]));
    },

    async planPack(root) {
      const index = root["modrinth.index.json"];
      if (!index) throw new Error("Not a Modrinth modpack");
      return plan(JSON.parse(index));
    },
  });
}
