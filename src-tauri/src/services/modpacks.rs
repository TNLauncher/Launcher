//! Modpack import for any content source: the source reads the archive's manifest into a `PackPlan`,
//! the launcher downloads its files and copies the archive's override folders over the game directory.
use crate::error::{AppError, Result};
use crate::minecraft::http::{self, Job};
use crate::models::{Instance, Loader, PackRef};
use crate::plugins::{
    self,
    api::{PackFile, PackPlan, ProjectKind, VersionFilter},
};
use crate::services::instances;
use crate::state::AppState;
use base64::{engine::general_purpose::STANDARD, Engine};
use futures::future::{AbortHandle, Abortable};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};

/// Top-level archive files bigger than this are not handed to the source.
const MAX_MANIFEST: u64 = 16 * 1024 * 1024;

/// Files downloaded so far; streamed to the UI.
#[derive(Clone, Serialize)]
pub struct ImportProgress {
    pub done: usize,
    pub total: usize,
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

fn jobs(dir: &Path, allowed: &dyn Fn(&str) -> bool, files: &[PackFile]) -> Result<Vec<Job>> {
    files
        .iter()
        .map(|f| {
            let url = f.urls.iter().find(|u| allowed(u)).ok_or_else(|| AppError::Invalid(format!("No allowed download for {}", f.path)))?;
            Ok(Job { url: url.clone(), path: dir.join(safe_rel(&f.path)?), size: f.size })
        })
        .collect()
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
    progress: &(dyn Fn(ImportProgress) + Sync),
) -> Result<Instance> {
    let (handle, reg) = AbortHandle::new_pair();
    state.imports.lock().unwrap().insert(project.into(), handle);
    let result = Abortable::new(install(state, source_id, project, version, progress), reg).await;
    state.imports.lock().unwrap().remove(project);
    result.unwrap_or(Err(AppError::Cancelled))
}

/// Stops the import of `project`, if one is running.
pub fn cancel(state: &AppState, project: &str) {
    if let Some(h) = state.imports.lock().unwrap().remove(project) {
        h.abort();
    }
}

async fn install(
    state: &AppState,
    source_id: &str,
    project: &str,
    version: Option<&str>,
    progress: &(dyn Fn(ImportProgress) + Sync),
) -> Result<Instance> {
    let plugin = plugins::enabled(state, source_id)?;
    let source = plugin.source()?;
    let allowed = |url: &str| plugin.may_download(url);
    let filter = VersionFilter { kind: ProjectKind::Modpack, game_version: None, loader: None };
    let versions = source.versions(project, &filter).await?;
    let picked = match version {
        Some(id) => versions.into_iter().find(|v| v.id == id),
        None => versions.into_iter().next(),
    }
    .ok_or_else(|| AppError::NotFound("This modpack has no version the launcher can run".into()))?;
    let file = picked.primary_file().ok_or_else(|| AppError::NotFound("This modpack version has no file".into()))?;
    if file.url.is_empty() {
        return Err(AppError::Unsupported("The author of this modpack does not allow launchers to download it.".into()));
    }
    if !allowed(&file.url) {
        return Err(AppError::Invalid(format!("{} is not an allowed download", file.url)));
    }

    let bytes = http::fetch_bytes(&state.http, &file.url).await?;
    let plan = source.plan_pack(&root_files(&bytes)?).await?;
    let loader = loader_of(&plan)?;
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

    let jobs = jobs(&dir, &allowed, &plan.files)?;
    progress(ImportProgress { done: 0, total: jobs.len() });
    http::download_all(&state.http, jobs, &|done, total| progress(ImportProgress { done, total })).await?;
    extract_overrides(&bytes, &dir, &plan.overrides)?;
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
        let file = |url: &str| PackFile { path: "mods/a.jar".into(), urls: vec!["https://evil.com/a.jar".into(), url.into()], size: None };
        let dir = Path::new("/x");
        assert_eq!(jobs(dir, &hosts, &[file("https://cdn.modrinth.com/a.jar")]).unwrap()[0].url, "https://cdn.modrinth.com/a.jar");
        assert!(jobs(dir, &hosts, &[file("https://evil.com/b.jar")]).is_err());
        let traversal = PackFile { path: "../a.jar".into(), urls: vec!["https://cdn.modrinth.com/a.jar".into()], size: None };
        assert!(jobs(dir, &hosts, &[traversal]).is_err());
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
