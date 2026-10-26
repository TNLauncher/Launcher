//! Modpack import for any content source: the source reads the archive's manifest into a `PackPlan`,
//! the launcher downloads its files and copies the archive's override folders over the game directory.
use crate::error::{AppError, Result};
use crate::minecraft::http::{self, Job};
use crate::models::{Instance, Loader, PackRef};
use crate::plugins::{
    self,
    api::{PackFile, PackPlan, ProjectKind, Version, VersionFilter},
    Plugin,
};
use crate::services::instances;
use crate::state::AppState;
use base64::{engine::general_purpose::STANDARD, Engine};
use futures::future::{AbortHandle, Abortable};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Top-level archive files bigger than this are not handed to the source.
const MAX_MANIFEST: u64 = 16 * 1024 * 1024;

/// The pack's file list, kept in the instance so a repair knows what belongs there without the archive.
const PACK_FILES: &str = ".pack-files.json";

/// How often Downloads is checked for hand-downloaded files.
const MANUAL_POLL: Duration = Duration::from_secs(1);

/// Files downloaded so far; streamed to the UI.
#[derive(Clone, Serialize)]
pub struct ImportProgress {
    pub done: usize,
    pub total: usize,
    /// Files the user downloads by hand; empty for most packs.
    pub manual: Vec<ManualFile>,
}

/// A pack file whose author does not allow launchers: the user downloads it from `page` into Downloads.
#[derive(Clone, Serialize)]
pub struct ManualFile {
    pub name: String,
    pub page: String,
    /// Found in Downloads and moved into the instance.
    pub done: bool,
}

/// Pack paths are untrusted: only plain relative components, so nothing escapes the instance dir.
fn safe_rel(path: &str) -> Result<&Path> {
    let p = Path::new(path);
    if path.is_empty() || !p.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(AppError::Invalid(format!("Bad path in modpack: {path}")));
    }
    Ok(p)
}

fn loader_of(plan: &PackPlan) -> Result<Loader> {
    match plan.loader.as_str() {
        "" => Ok(Loader::Vanilla),
        "fabric" => Ok(Loader::Fabric),
        "quilt" => Ok(Loader::Quilt),
        "forge" => Ok(Loader::Forge),
        "neoforge" => Ok(Loader::NeoForge),
        other => Err(AppError::Unsupported(format!("{other} modpacks are not supported"))),
    }
}

pub(crate) fn jobs(dir: &Path, allowed: &dyn Fn(&str) -> bool, files: &[PackFile]) -> Result<Vec<Job>> {
    files
        .iter()
        .map(|f| {
            let url = f.urls.iter().find(|u| allowed(u)).ok_or_else(|| AppError::Invalid(format!("No allowed download for {}", f.path)))?;
            Ok(Job { url: url.clone(), path: dir.join(safe_rel(&f.path)?), size: f.size, sha1: f.sha1.clone() })
        })
        .collect()
}

/// Splits pack files into the ones the launcher may download and the ones the user fetches by hand.
pub(crate) fn split_manual(files: Vec<PackFile>) -> (Vec<PackFile>, Vec<PackFile>) {
    files.into_iter().partition(|f| f.urls.is_empty() && f.page.is_some())
}

pub(crate) fn file_name(f: &PackFile) -> String {
    Path::new(&f.path).file_name().map_or(f.path.clone(), |n| n.to_string_lossy().into())
}

/// Moves each hand-downloaded file from `downloads` into `dir` as it appears, until none is left; `moved` gets its index.
// ponytail: polls by exact file name; a browser's "name (1).jar" rename is not matched, a file watcher could replace the poll.
async fn collect_manual(files: &[PackFile], downloads: Option<&Path>, dir: &Path, moved: &(dyn Fn(usize) + Sync)) -> Result<()> {
    if files.is_empty() {
        return Ok(());
    }
    let downloads = downloads.ok_or_else(|| AppError::NotFound("No Downloads folder to pick hand-downloaded files from".into()))?;
    let mut left: Vec<usize> = (0..files.len()).collect();
    loop {
        let mut still = vec![];
        for i in left {
            let src = downloads.join(file_name(&files[i]));
            // Browsers write to a temporary name and rename when done, so the final name means a whole file.
            if !src.is_file() {
                still.push(i);
                continue;
            }
            let out = dir.join(safe_rel(&files[i].path)?);
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent)?;
            }
            // Across filesystems a rename fails: copy, then remove the original.
            std::fs::rename(&src, &out).or_else(|_| std::fs::copy(&src, &out).and_then(|_| std::fs::remove_file(&src)))?;
            moved(i);
        }
        if still.is_empty() {
            return Ok(());
        }
        left = still;
        tokio::time::sleep(MANUAL_POLL).await;
    }
}

/// Top-level text files of the archive, which is where pack formats keep their manifest.
fn root_files(bytes: &[u8]) -> Result<HashMap<String, String>> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes))?;
    let mut out = HashMap::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        if entry.is_dir() || entry.name().contains('/') || entry.size() > MAX_MANIFEST {
            continue;
        }
        let mut buf = String::new();
        // Binary files (icons) are not manifests: skip them.
        if entry.read_to_string(&mut buf).is_ok() {
            out.insert(entry.name().to_string(), buf);
        }
    }
    Ok(out)
}

fn extract_overrides(bytes: &[u8], dir: &Path, prefixes: &[String]) -> Result<()> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes))?;
    for prefix in prefixes {
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i)?;
            let Some(name) = entry.enclosed_name() else { continue };
            let Ok(rel) = name.strip_prefix(prefix) else { continue };
            if entry.is_dir() || rel.as_os_str().is_empty() {
                continue;
            }
            let out: PathBuf = dir.join(rel);
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::io::copy(&mut entry, &mut std::fs::File::create(out)?)?;
        }
    }
    Ok(())
}

/// Image bytes as a `data:` URL; `None` for formats a webview may not sniff or icons too big to store.
fn icon_data_url(bytes: &[u8]) -> Option<String> {
    let mime = match bytes {
        [0x89, b'P', b'N', b'G', ..] => "png",
        [0xFF, 0xD8, 0xFF, ..] => "jpeg",
        [b'G', b'I', b'F', ..] => "gif",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "webp",
        _ => return None,
    };
    let url = format!("data:image/{mime};base64,{}", STANDARD.encode(bytes));
    (url.len() <= instances::MAX_ICON_LEN).then_some(url)
}

/// Deletes a half-installed instance dir unless disarmed: covers errors and cancels, which drop the future mid-await.
struct Cleanup<'a>(Option<&'a Path>);

impl Drop for Cleanup<'_> {
    fn drop(&mut self) {
        if let Some(dir) = self.0 {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}

/// Installs `version` (an id) of a modpack project as a new instance, or its newest version when `None`.
/// [`cancel`] with the same project stops it.
pub async fn import(
    state: &AppState,
    source_id: &str,
    project: &str,
    version: Option<&str>,
    downloads: Option<&Path>,
    progress: &(dyn Fn(ImportProgress) + Sync),
) -> Result<Instance> {
    let (handle, reg) = AbortHandle::new_pair();
    state.imports.lock().unwrap().insert(project.into(), handle);
    let result = Abortable::new(install(state, source_id, project, version, downloads, progress), reg).await;
    state.imports.lock().unwrap().remove(project);
    result.unwrap_or(Err(AppError::Cancelled))
}

/// Stops the import of `project`, if one is running.
pub fn cancel(state: &AppState, project: &str) {
    if let Some(h) = state.imports.lock().unwrap().remove(project) {
        h.abort();
    }
}

/// A modpack version's archive and the plan its source reads from it.
struct Fetched {
    plugin: Arc<Plugin>,
    picked: Version,
    bytes: Vec<u8>,
    plan: PackPlan,
}

/// Downloads the archive of the first version `pick` accepts (versions come newest first).
async fn fetch_pack(state: &AppState, source_id: &str, project: &str, pick: &(dyn Fn(&Version) -> bool + Sync)) -> Result<Fetched> {
    let plugin = plugins::enabled(state, source_id)?;
    let source = plugin.source()?;
    let filter = VersionFilter { kind: ProjectKind::Modpack, game_version: None, loader: None };
    let picked = source
        .versions(project, &filter)
        .await?
        .into_iter()
        .find(|v| pick(v))
        .ok_or_else(|| AppError::NotFound("This modpack has no version the launcher can run".into()))?;
    let file = picked.primary_file().ok_or_else(|| AppError::NotFound("This modpack version has no file".into()))?;
    if file.url.is_empty() {
        return Err(AppError::Unsupported("The author of this modpack does not allow launchers to download it.".into()));
    }
    if !plugin.may_download(&file.url) {
        return Err(AppError::Invalid(format!("{} is not an allowed download", file.url)));
    }
    let bytes = http::fetch_bytes(&state.http, &file.url).await?;
    let plan = source.plan_pack(&root_files(&bytes)?).await?;
    Ok(Fetched { plugin: plugin.clone(), picked, bytes, plan })
}

/// The files the instance's modpack ships, from the copy kept at import; packs imported before that are fetched once.
pub async fn pack_files(state: &AppState, inst: &Instance) -> Result<Option<(Arc<Plugin>, Vec<PackFile>)>> {
    let Some(pack) = &inst.pack else { return Ok(None) };
    let plugin = plugins::enabled(state, &pack.source)?;
    let saved = state.paths.instance_dir(&inst.id)?.join(PACK_FILES);
    if let Some(files) = std::fs::read(&saved).ok().and_then(|b| serde_json::from_slice(&b).ok()) {
        return Ok(Some((plugin, files)));
    }
    let fetched = fetch_pack(state, &pack.source, &pack.project, &|v| v.number == pack.version).await?;
    std::fs::write(&saved, serde_json::to_vec(&fetched.plan.files)?)?;
    Ok(Some((plugin, fetched.plan.files)))
}

async fn install(
    state: &AppState,
    source_id: &str,
    project: &str,
    version: Option<&str>,
    downloads: Option<&Path>,
    progress: &(dyn Fn(ImportProgress) + Sync),
) -> Result<Instance> {
    let Fetched { plugin, picked, bytes, mut plan } = fetch_pack(state, source_id, project, &|v| version.is_none_or(|id| v.id == id)).await?;
    let source = plugin.source()?;
    let allowed = |url: &str| plugin.may_download(url);
    let loader = loader_of(&plan)?;
    let listed = serde_json::to_vec(&plan.files)?;
    let (manual, auto) = split_manual(std::mem::take(&mut plan.files));
    // Kept locally so the row does not hit the source on every render; a missing icon is not worth failing over.
    let icon = match source.project(project).await.ok().and_then(|p| p.icon_url) {
        Some(url) => http::fetch_bytes(&state.http, &url).await.ok().and_then(|b| icon_data_url(&b)),
        None => None,
    };
    let instance = Instance {
        pack: Some(PackRef { source: source_id.into(), project: project.into(), version: picked.number.clone() }),
        icon: icon.unwrap_or_default(),
        ..instances::new(&plan.name, &plan.game_version, loader, plan.loader_version.clone())
    };
    let dir = state.paths.instance_dir(&instance.id)?;
    let mut cleanup = Cleanup(Some(&dir));

    let jobs = jobs(&dir, &allowed, &auto)?;
    let shown = Mutex::new(ImportProgress {
        done: 0,
        total: jobs.len(),
        manual: manual.iter().map(|f| ManualFile { name: file_name(f), page: f.page.clone().unwrap_or_default(), done: false }).collect(),
    });
    let update = |f: &dyn Fn(&mut ImportProgress)| {
        let mut p = shown.lock().unwrap();
        f(&mut p);
        progress(p.clone());
    };
    update(&|_| {});
    let ticked = |done: usize, total: usize| update(&|p| (p.done, p.total) = (done, total));
    let moved = |i: usize| update(&|p| p.manual[i].done = true);
    // The user fetches blocked files while the rest downloads.
    let (downloaded, collected) = futures::join!(http::download_all(&state.http, jobs, http::Check::Size, &ticked), collect_manual(&manual, downloads, &dir, &moved));
    downloaded?;
    collected?;
    extract_overrides(&bytes, &dir, &plan.overrides)?;
    std::fs::write(dir.join(PACK_FILES), listed)?;
    instances::add(state, &instance)?;
    cleanup.0 = None;
    Ok(instance)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_escaping_paths() {
        assert!(safe_rel("../evil.jar").is_err());
        assert!(safe_rel("/etc/passwd").is_err());
        assert!(safe_rel("mods/sodium.jar").is_ok());
    }

    #[test]
    fn skips_foreign_hosts() {
        let hosts = |u: &str| u.starts_with("https://cdn.modrinth.com/");
        let file = |url: &str| PackFile { path: "mods/a.jar".into(), urls: vec!["https://evil.com/a.jar".into(), url.into()], size: None, page: None, sha1: None };
        let dir = Path::new("/x");
        assert_eq!(jobs(dir, &hosts, &[file("https://cdn.modrinth.com/a.jar")]).unwrap()[0].url, "https://cdn.modrinth.com/a.jar");
        assert!(jobs(dir, &hosts, &[file("https://evil.com/b.jar")]).is_err());
        let traversal = PackFile { path: "../a.jar".into(), urls: vec!["https://cdn.modrinth.com/a.jar".into()], size: None, page: None, sha1: None };
        assert!(jobs(dir, &hosts, &[traversal]).is_err());
    }

    #[tokio::test]
    async fn moves_manual_downloads() {
        let root = std::env::temp_dir().join(format!("tn-manual-{}", std::process::id()));
        let (dl, dir) = (root.join("dl"), root.join("inst"));
        std::fs::create_dir_all(&dl).unwrap();
        std::fs::write(dl.join("a.jar"), b"a").unwrap();
        let files = [PackFile { path: "mods/a.jar".into(), urls: vec![], size: None, page: Some("https://x".into()), sha1: None }];
        let moved = Mutex::new(vec![]);
        collect_manual(&files, Some(&dl), &dir, &|i| moved.lock().unwrap().push(i)).await.unwrap();
        assert_eq!(*moved.lock().unwrap(), [0]);
        assert_eq!(std::fs::read(dir.join("mods/a.jar")).unwrap(), b"a");
        assert!(!dl.join("a.jar").exists());
        assert!(collect_manual(&files, None, &dir, &|_| {}).await.is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sniffs_icons() {
        assert!(icon_data_url(b"\x89PNG\r\n").unwrap().starts_with("data:image/png;base64,"));
        assert!(icon_data_url(b"RIFF\0\0\0\0WEBPVP8").unwrap().starts_with("data:image/webp;"));
        assert!(icon_data_url(b"<svg/>").is_none());
    }

    #[test]
    fn maps_loaders() {
        let plan = |l: &str| PackPlan { name: "p".into(), game_version: "1.21".into(), loader: l.into(), loader_version: String::new(), files: vec![], overrides: vec![] };
        assert_eq!(loader_of(&plan("")).unwrap(), Loader::Vanilla);
        assert_eq!(loader_of(&plan("quilt")).unwrap(), Loader::Quilt);
        assert_eq!(loader_of(&plan("neoforge")).unwrap(), Loader::NeoForge);
        assert!(loader_of(&plan("liteloader")).is_err());
    }
}
