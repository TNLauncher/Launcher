//! Modrinth (api.modrinth.com/v2) as a built-in content source, with `.mrpack` modpacks.
use super::api::*;
use crate::error::{AppError, Result};
use crate::minecraft::http;
use futures::future::BoxFuture;
use futures::FutureExt;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use std::collections::HashMap;

const API: &str = "https://api.modrinth.com/v2";
const IDS_PER_REQUEST: usize = 100;
/// Loaders the launcher can run modpacks on.
const PACK_LOADERS: [&str; 2] = ["fabric", "quilt"];

pub struct Modrinth {
    http: reqwest::Client,
    info: SourceInfo,
}

impl Modrinth {
    pub fn new(http: reqwest::Client) -> Self {
        let c = |list: &[(&str, &str)]| list.iter().map(|(id, label)| Choice::new(id, label)).collect::<Vec<_>>();
        let categories = HashMap::from([
            (
                ProjectKind::Mod,
                c(&[("optimization", "Performance"), ("utility", "Utility"), ("worldgen", "Worldgen"), ("decoration", "Decoration"), ("library", "Libraries")]),
            ),
            (
                ProjectKind::Resourcepack,
                c(&[("vanilla-like", "Vanilla-like"), ("simplistic", "Simplistic"), ("realistic", "Realistic"), ("themed", "Themed"), ("tweaks", "Tweaks"), ("utility", "Utility")]),
            ),
            (
                ProjectKind::Shader,
                c(&[("vanilla-like", "Vanilla-like"), ("semi-realistic", "Semi-realistic"), ("realistic", "Realistic"), ("fantasy", "Fantasy"), ("cartoon", "Cartoon"), ("low", "Lightweight")]),
            ),
            (
                ProjectKind::Modpack,
                c(&[
                    ("adventure", "Adventure"),
                    ("challenging", "Challenging"),
                    ("combat", "Combat"),
                    ("kitchen-sink", "Kitchen sink"),
                    ("lightweight", "Lightweight"),
                    ("magic", "Magic"),
                    ("multiplayer", "Multiplayer"),
                    ("optimization", "Optimization"),
                    ("quests", "Quests"),
                    ("technology", "Technology"),
                ]),
            ),
        ]);
        let info = SourceInfo {
            id: "modrinth".into(),
            name: "Modrinth".into(),
            sorts: c(&[("relevance", "Relevance"), ("downloads", "Downloads"), ("follows", "Followers"), ("updated", "Recently updated"), ("newest", "Newest")]),
            categories,
            // The mrpack spec allows pack files from these too.
            hosts: ["https://cdn.modrinth.com/", "https://github.com/", "https://raw.githubusercontent.com/", "https://gitlab.com/"].map(String::from).into(),
        };
        Self { http, info }
    }

    async fn get<T: DeserializeOwned>(&self, path: &str, params: &[(&str, String)]) -> Result<T> {
        let url = reqwest::Url::parse_with_params(&format!("{API}{path}"), params).map_err(|e| AppError::Invalid(e.to_string()))?;
        Ok(serde_json::from_value(http::get_json(&self.http, url.as_str()).await?)?)
    }
}

/// Version loaders each kind is published under. `None` = don't filter.
fn loaders(kind: ProjectKind, loader: Option<&str>) -> Option<Vec<String>> {
    match kind {
        ProjectKind::Mod => loader.map(|l| vec![l.into()]),
        ProjectKind::Shader => Some(vec!["iris".into(), "optifine".into()]),
        ProjectKind::Resourcepack => Some(vec!["minecraft".into()]),
        ProjectKind::Modpack => Some(loader.map_or_else(|| PACK_LOADERS.map(String::from).into(), |l| vec![l.into()])),
    }
}

fn kind_name(kind: ProjectKind) -> &'static str {
    match kind {
        ProjectKind::Mod => "mod",
        ProjectKind::Resourcepack => "resourcepack",
        ProjectKind::Shader => "shader",
        ProjectKind::Modpack => "modpack",
    }
}

/// Search facets: outer list is AND, inner lists are OR.
fn facets(q: &SearchQuery) -> Vec<Vec<String>> {
    let mut f = vec![vec![format!("project_type:{}", kind_name(q.kind))]];
    if let Some(v) = &q.game_version {
        f.push(vec![format!("versions:{v}")]);
    }
    // Resource packs are tagged `minecraft`, which search does not index as a category.
    if q.kind != ProjectKind::Resourcepack {
        if let Some(ls) = loaders(q.kind, q.loader.as_deref()) {
            f.push(ls.iter().map(|l| format!("categories:{l}")).collect());
        }
    }
    f.extend(q.categories.iter().map(|c| vec![format!("categories:{c}")]));
    f
}

#[derive(Deserialize)]
struct SearchRes {
    hits: Vec<RawHit>,
    offset: u32,
    total_hits: u32,
}

#[derive(Deserialize)]
struct RawHit {
    project_id: String,
    slug: String,
    title: String,
    author: String,
    description: String,
    icon_url: Option<String>,
    downloads: u64,
    #[serde(default)]
    follows: u64,
    categories: Vec<String>,
    versions: Vec<String>,
    date_modified: String,
    featured_gallery: Option<String>,
    color: Option<u32>,
}

#[derive(Deserialize)]
struct RawProject {
    id: String,
    slug: String,
    project_type: String,
    title: String,
    description: String,
    #[serde(default)]
    body: String,
    icon_url: Option<String>,
    color: Option<u32>,
    #[serde(default)]
    published: String,
    license: Option<RawLicense>,
    source_url: Option<String>,
    issues_url: Option<String>,
    wiki_url: Option<String>,
    discord_url: Option<String>,
    #[serde(default)]
    gallery: Vec<RawImage>,
}

#[derive(Deserialize)]
struct RawLicense {
    id: String,
}

#[derive(Deserialize)]
struct RawImage {
    url: String,
    raw_url: String,
    featured: bool,
    title: Option<String>,
    description: Option<String>,
}

#[derive(Deserialize)]
struct RawVersion {
    id: String,
    name: String,
    version_number: String,
    version_type: Channel,
    game_versions: Vec<String>,
    loaders: Vec<String>,
    date_published: String,
    changelog: Option<String>,
    files: Vec<RawFile>,
    dependencies: Vec<RawDependency>,
}

#[derive(Deserialize)]
struct RawFile {
    url: String,
    filename: String,
    primary: bool,
    size: u64,
}

#[derive(Deserialize)]
struct RawDependency {
    project_id: Option<String>,
    file_name: Option<String>,
    dependency_type: DependencyKind,
}

#[derive(Deserialize)]
struct RawIdentified {
    project_id: String,
    version_number: String,
}

fn page_url(kind: &str, slug: &str) -> String {
    format!("https://modrinth.com/{kind}/{slug}")
}

impl From<RawVersion> for Version {
    fn from(v: RawVersion) -> Self {
        Self {
            id: v.id,
            name: v.name,
            number: v.version_number,
            channel: v.version_type,
            game_versions: v.game_versions,
            loaders: v.loaders,
            published: v.date_published,
            changelog: v.changelog,
            files: v.files.into_iter().map(|f| VersionFile { url: f.url, filename: f.filename, primary: f.primary, size: f.size }).collect(),
            dependencies: v
                .dependencies
                .into_iter()
                .map(|d| Dependency { project_id: d.project_id, file_name: d.file_name, kind: d.dependency_type })
                .collect(),
        }
    }
}

impl ContentSource for Modrinth {
    fn info(&self) -> &SourceInfo {
        &self.info
    }

    fn search<'a>(&'a self, q: &'a SearchQuery) -> BoxFuture<'a, Result<Page>> {
        async move {
            let sort = if q.sort.is_empty() { "relevance" } else { &q.sort };
            let params = [
                ("query", q.query.clone()),
                ("index", sort.into()),
                ("limit", q.limit.to_string()),
                ("offset", q.offset.to_string()),
                ("facets", serde_json::to_string(&facets(q))?),
            ];
            let res: SearchRes = self.get("/search", &params).await?;
            let hits = res
                .hits
                .into_iter()
                .map(|h| Hit {
                    id: h.project_id,
                    slug: h.slug,
                    title: h.title,
                    author: h.author,
                    description: h.description,
                    icon_url: h.icon_url,
                    downloads: h.downloads,
                    follows: h.follows,
                    categories: h.categories,
                    game_versions: h.versions,
                    updated: h.date_modified,
                    banner_url: h.featured_gallery,
                    color: h.color,
                })
                .collect();
            Ok(Page { hits, offset: res.offset, total: res.total_hits })
        }
        .boxed()
    }

    fn project<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<Project>> {
        async move {
            let p: RawProject = self.get(&format!("/project/{}", urlencode(id)), &[]).await?;
            let link = |label: &str, icon: &str, url: Option<String>| url.map(|url| Link { label: label.into(), icon: icon.into(), url });
            let links = [
                link("Modrinth page", "open_in_new", Some(page_url(&p.project_type, &p.slug))),
                link("Source code", "code", p.source_url),
                link("Issues", "bug_report", p.issues_url),
                link("Wiki", "menu_book", p.wiki_url),
                link("Discord", "forum", p.discord_url),
            ];
            Ok(Project {
                id: p.id,
                title: p.title,
                description: p.description,
                body: p.body,
                icon_url: p.icon_url,
                color: p.color,
                published: p.published,
                license: p.license.map(|l| l.id.trim_start_matches("LicenseRef-").into()),
                links: links.into_iter().flatten().collect(),
                gallery: p
                    .gallery
                    .into_iter()
                    .map(|g| Image { url: g.url, raw_url: g.raw_url, featured: g.featured, title: g.title, description: g.description })
                    .collect(),
            })
        }
        .boxed()
    }

    fn projects<'a>(&'a self, ids: &'a [String]) -> BoxFuture<'a, Result<Vec<ProjectSummary>>> {
        async move {
            let chunks = ids.chunks(IDS_PER_REQUEST).map(|chunk| async move {
                let raw: Vec<RawProject> = self.get("/projects", &[("ids", serde_json::to_string(chunk)?)]).await?;
                Ok::<_, AppError>(raw)
            });
            let mut out = Vec::new();
            for chunk in futures::future::try_join_all(chunks).await? {
                out.extend(chunk.into_iter().map(|p| ProjectSummary {
                    url: page_url(&p.project_type, &p.slug),
                    id: p.id,
                    title: p.title,
                    description: p.description,
                    icon_url: p.icon_url,
                    kind: p.project_type,
                }));
            }
            Ok(out)
        }
        .boxed()
    }

    fn versions<'a>(&'a self, project: &'a str, f: &'a VersionFilter) -> BoxFuture<'a, Result<Vec<Version>>> {
        async move {
            let mut params = Vec::new();
            if let Some(ls) = loaders(f.kind, f.loader.as_deref()) {
                params.push(("loaders", serde_json::to_string(&ls)?));
            }
            if let Some(v) = &f.game_version {
                params.push(("game_versions", serde_json::to_string(&[v])?));
            }
            let raw: Vec<RawVersion> = self.get(&format!("/project/{}/version", urlencode(project)), &params).await?;
            Ok(raw.into_iter().map(Version::from).collect())
        }
        .boxed()
    }

    fn identify<'a>(&'a self, sha1: &'a [String]) -> BoxFuture<'a, Result<HashMap<String, Identified>>> {
        async move {
            let body = serde_json::json!({ "hashes": sha1, "algorithm": "sha1" });
            let raw: HashMap<String, RawIdentified> = serde_json::from_value(http::post_json(&self.http, &format!("{API}/version_files"), &body).await?)?;
            Ok(raw.into_iter().map(|(h, v)| (h, Identified { project_id: v.project_id, version_number: v.version_number })).collect())
        }
        .boxed()
    }

    fn plan_pack(&self, root: &HashMap<String, Vec<u8>>) -> Result<PackPlan> {
        let index = root.get("modrinth.index.json").ok_or_else(|| AppError::Invalid("Not a Modrinth modpack".into()))?;
        plan(serde_json::from_slice(index)?)
    }
}

fn urlencode(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Index {
    name: String,
    files: Vec<IndexFile>,
    dependencies: HashMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexFile {
    path: String,
    downloads: Vec<String>,
    file_size: Option<u64>,
    #[serde(default)]
    env: HashMap<String, String>,
}

fn plan(index: Index) -> Result<PackPlan> {
    let deps = &index.dependencies;
    let game_version = deps.get("minecraft").ok_or_else(|| AppError::Invalid("Modpack has no Minecraft version".into()))?.clone();
    let (loader, loader_version) = match (deps.get("fabric-loader"), deps.get("quilt-loader")) {
        (Some(v), _) => ("fabric", v.clone()),
        (_, Some(v)) => ("quilt", v.clone()),
        _ if deps.contains_key("forge") || deps.contains_key("neoforge") => {
            return Err(AppError::Unsupported("Forge and NeoForge modpacks are not supported".into()))
        }
        _ => ("", String::new()),
    };
    let files = index
        .files
        .into_iter()
        .filter(|f| f.env.get("client").is_none_or(|e| e != "unsupported"))
        .map(|f| PackFile { path: f.path, urls: f.downloads, size: f.file_size })
        .collect();
    Ok(PackPlan {
        name: index.name,
        game_version,
        loader: loader.into(),
        loader_version,
        files,
        // client-overrides go second so they win over the shared ones.
        overrides: vec!["overrides".into(), "client-overrides".into()],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index(dep: &str, env: &str) -> Index {
        serde_json::from_value(serde_json::json!({
            "name": "Pack",
            "files": [{ "path": "mods/a.jar", "downloads": ["https://cdn.modrinth.com/a.jar"], "env": { "client": env } }],
            "dependencies": { "minecraft": "1.21", dep: "1.0" }
        }))
        .unwrap()
    }

    #[test]
    fn plans_packs() {
        let p = plan(index("fabric-loader", "required")).unwrap();
        assert_eq!((p.game_version.as_str(), p.loader.as_str(), p.loader_version.as_str(), p.files.len()), ("1.21", "fabric", "1.0", 1));
        assert_eq!(plan(index("quilt-loader", "required")).unwrap().loader, "quilt");
        assert!(plan(index("fabric-loader", "unsupported")).unwrap().files.is_empty());
        assert!(plan(index("forge", "required")).is_err());
    }

    #[test]
    fn builds_facets() {
        let q = |kind, loader: Option<&str>| SearchQuery {
            kind,
            query: String::new(),
            game_version: Some("1.21".into()),
            loader: loader.map(String::from),
            categories: vec!["magic".into()],
            sort: String::new(),
            offset: 0,
            limit: 20,
        };
        let f = facets(&q(ProjectKind::Modpack, None));
        assert_eq!(f[2], ["categories:fabric", "categories:quilt"]);
        assert_eq!(f[3], ["categories:magic"]);
        assert_eq!(facets(&q(ProjectKind::Mod, Some("fabric")))[2], ["categories:fabric"]);
        assert_eq!(facets(&q(ProjectKind::Resourcepack, None)).len(), 3);
    }

    /// Hits the real API: `cargo test -- --ignored live_api`.
    #[tokio::test]
    #[ignore]
    async fn live_api() {
        let m = Modrinth::new(crate::state::http_client().unwrap());
        let q = SearchQuery { kind: ProjectKind::Modpack, query: "fabulously".into(), game_version: None, loader: None, categories: vec![], sort: String::new(), offset: 0, limit: 5 };
        let page = m.search(&q).await.unwrap();
        let hit = &page.hits[0];
        let project = m.project(&hit.id).await.unwrap();
        assert!(project.links[0].url.starts_with("https://modrinth.com/modpack/"));
        let versions = m.versions(&hit.id, &VersionFilter { kind: ProjectKind::Modpack, game_version: None, loader: None }).await.unwrap();
        let deps: Vec<String> = versions[0].dependencies.iter().filter_map(|d| d.project_id.clone()).take(3).collect();
        assert_eq!(m.projects(&deps).await.unwrap().len(), deps.len());
        let pack = http::fetch_bytes(&m.http, &versions[0].primary_file().unwrap().url).await.unwrap();
        let plan = m.plan_pack(&crate::services::modpacks::root_files(&pack).unwrap()).unwrap();
        assert!(!plan.files.is_empty() && !plan.game_version.is_empty(), "{plan:?}");
        let sodium = m.versions("AANobbMI", &VersionFilter { kind: ProjectKind::Mod, game_version: Some("1.21.1".into()), loader: Some("fabric".into()) }).await.unwrap();
        assert!(!sodium.is_empty());
        let file = sodium[0].primary_file().unwrap();
        let bytes = http::fetch_bytes(&m.http, &file.url).await.unwrap();
        let sha1: String = <sha1::Sha1 as sha1::Digest>::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
        let found = m.identify(&[sha1.clone()]).await.unwrap();
        assert_eq!(found[&sha1].project_id, "AANobbMI");
    }
}
