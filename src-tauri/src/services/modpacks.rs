//! Modrinth modpacks (`.mrpack`): a zip with `modrinth.index.json` listing files to download,
//! plus `overrides/` and `client-overrides/` copied over the game directory.
use crate::error::{AppError, Result};
use crate::minecraft::http::{self, Job};
use crate::models::{Instance, Loader};
use crate::services::instances;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Component, Path, PathBuf};

const PACK_HOST: &str = "https://cdn.modrinth.com/";
/// Hosts the mrpack spec allows pack files to come from.
const FILE_HOSTS: [&str; 4] = [PACK_HOST, "https://github.com/", "https://raw.githubusercontent.com/", "https://gitlab.com/"];

/// Files downloaded so far; streamed to the UI.
#[derive(Clone, Serialize)]
pub struct ImportProgress {
    pub done: usize,
    pub total: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Index {
    name: String,
    files: Vec<PackFile>,
    dependencies: HashMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackFile {
    path: String,
    downloads: Vec<String>,
    file_size: Option<u64>,
    #[serde(default)]
    env: HashMap<String, String>,
}

/// Pack paths are untrusted: only plain relative components, so nothing escapes the instance dir.
fn safe_rel(path: &str) -> Result<&Path> {
    let p = Path::new(path);
    if path.is_empty() || !p.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(AppError::Invalid(format!("Bad path in modpack: {path}")));
    }
    Ok(p)
}

fn loader_of(deps: &HashMap<String, String>) -> Result<(Loader, String)> {
    if let Some(v) = deps.get("fabric-loader") {
        return Ok((Loader::Fabric, v.clone()));
    }
    if let Some(v) = deps.get("quilt-loader") {
        return Ok((Loader::Quilt, v.clone()));
    }
    if deps.contains_key("forge") || deps.contains_key("neoforge") {
        return Err(AppError::Unsupported("Forge and NeoForge modpacks are not supported".into()));
    }
    Ok((Loader::Vanilla, String::new()))
}

fn jobs(dir: &Path, files: &[PackFile]) -> Result<Vec<Job>> {
    files
        .iter()
        .filter(|f| f.env.get("client").map_or(true, |e| e != "unsupported"))
        .map(|f| {
            let url = f
                .downloads
                .iter()
                .find(|u| FILE_HOSTS.iter().any(|h| u.starts_with(h)))
                .ok_or_else(|| AppError::Invalid(format!("No allowed download for {}", f.path)))?;
            Ok(Job { url: url.clone(), path: dir.join(safe_rel(&f.path)?), size: f.file_size })
        })
        .collect()
}

fn extract_overrides(bytes: &[u8], dir: &Path) -> Result<()> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes))?;
    // client-overrides go second so they win over the shared ones.
    for prefix in ["overrides", "client-overrides"] {
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

/// `project_id` / `version_number` are stored on the instance so its page can show where it came from.
pub async fn import(
    state: &AppState,
    url: &str,
    project_id: &str,
    version_number: &str,
    progress: &(dyn Fn(ImportProgress) + Sync),
) -> Result<Instance> {
    if !url.starts_with(PACK_HOST) {
        return Err(AppError::Invalid("Only Modrinth modpacks are allowed".into()));
    }
    let bytes = http::fetch_bytes(&state.http, url).await?;
    let index: Index = {
        let mut zip = zip::ZipArchive::new(Cursor::new(&bytes))?;
        let index = serde_json::from_reader(zip.by_name("modrinth.index.json")?)?;
        index
    };
    let version = index.dependencies.get("minecraft").ok_or_else(|| AppError::Invalid("Modpack has no Minecraft version".into()))?;
    let (loader, loader_version) = loader_of(&index.dependencies)?;
    let instance = Instance {
        modpack_id: project_id.into(),
        modpack_version: version_number.into(),
        ..instances::new(&index.name, version, loader, loader_version)
    };
    let dir = state.paths.instance_dir(&instance.id)?;

    let result = async {
        let jobs = jobs(&dir, &index.files)?;
        progress(ImportProgress { done: 0, total: jobs.len() });
        http::download_all(&state.http, jobs, &|done, total| progress(ImportProgress { done, total })).await?;
        extract_overrides(&bytes, &dir)?;
        instances::add(state, &instance)
    }
    .await;
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    result.map(|_| instance)
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
    fn picks_loader() {
        let deps = |k: &str| HashMap::from([("minecraft".into(), "1.21".into()), (k.into(), "1.0".into())]);
        assert_eq!(loader_of(&deps("fabric-loader")).unwrap(), (Loader::Fabric, "1.0".into()));
        assert_eq!(loader_of(&deps("quilt-loader")).unwrap().0, Loader::Quilt);
        assert!(loader_of(&deps("forge")).is_err());
    }

    #[test]
    fn skips_server_only_and_foreign_hosts() {
        let file = |env: &str, url: &str| PackFile {
            path: "mods/a.jar".into(),
            downloads: vec![url.into()],
            file_size: None,
            env: HashMap::from([("client".into(), env.into())]),
        };
        let dir = Path::new("/x");
        assert_eq!(jobs(dir, &[file("unsupported", "https://evil.com/a.jar")]).unwrap().len(), 0);
        assert_eq!(jobs(dir, &[file("required", "https://cdn.modrinth.com/a.jar")]).unwrap()[0].path, dir.join("mods/a.jar"));
        assert!(jobs(dir, &[file("required", "https://evil.com/a.jar")]).is_err());
    }
}
