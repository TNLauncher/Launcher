//! Repair and the instance facts a repair plugin works from. `repair` puts back damaged files without
//! changing what is installed; the rest reads and changes an instance on a plugin's behalf.
//! Deciding what is wrong with a build is the plugin's job: its rules change faster than the launcher.
use super::launcher::{self, RunningGuard};
use super::{instances, modpacks, mods};
use crate::error::{AppError, Result};
use crate::minecraft::http::{self, Check, Job};
use crate::minecraft::modmeta::{self, ModMeta, Scan};
use crate::minecraft::{loader, Stage};
use crate::models::ContentKind;
use crate::plugins::{self, api::PackFile};
use crate::state::AppState;
use crate::storage;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};

const DISABLED: &str = ".disabled";
const CONTENT: [ContentKind; 3] = [ContentKind::Mod, ContentKind::Resourcepack, ContentKind::Shader];

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RepairStep {
    Game,
    Pack,
    Mods,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairProgress {
    pub step: RepairStep,
    /// The install stage while `step` is `game`.
    pub stage: Option<Stage>,
    pub done: usize,
    pub total: usize,
}

/// What a repair did, so "done" is never a blank promise.
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairReport {
    /// Game, loader, library and asset files downloaded again.
    pub game_files: usize,
    /// Pack files that were damaged and downloaded again.
    pub pack_files: usize,
    /// Half-downloaded leftovers removed.
    pub partials: usize,
    /// Jars that are not readable archives and that the pack cannot restore.
    pub broken: Vec<String>,
    /// Why the pack's files could not be checked (source off, offline).
    pub pack_error: Option<String>,
}

/// Rehashes game and pack files and downloads the damaged ones. Never adds, removes or switches mods.
pub async fn repair(app: &AppHandle, id: &str, on_progress: &(dyn Fn(RepairProgress) + Sync)) -> Result<RepairReport> {
    let _guard = RunningGuard::acquire(app, id)?;
    let state = app.state::<AppState>();
    let send = |step, stage, done, total| on_progress(RepairProgress { step, stage, done, total });
    let mut report = RepairReport::default();
    let dir = state.paths.instance_dir(id)?;

    send(RepairStep::Game, Some(Stage::Resolving), 0, 0);
    let prepared = launcher::prepare(&state, id, Check::Hash, &|stage, done, total| send(RepairStep::Game, Some(stage), done, total)).await?;
    report.game_files = prepared.installed.fetched;

    for kind in CONTENT {
        report.partials += drop_partials(&dir.join(kind.dir()));
    }

    send(RepairStep::Pack, None, 0, 0);
    match modpacks::pack_files(&state, &prepared.inst).await {
        Ok(Some((plugin, files))) => {
            let jobs = present_jobs(&dir, &files, &|u| plugin.may_download(u));
            let total = jobs.len();
            match http::download_all(&state.http, jobs, Check::Hash, &|d, t| send(RepairStep::Pack, None, d, t)).await {
                Ok(n) => report.pack_files = n,
                Err(e) => report.pack_error = Some(e.to_string()),
            }
            send(RepairStep::Pack, None, total, total);
        }
        Ok(None) => {}
        Err(e) => report.pack_error = Some(e.to_string()),
    }

    send(RepairStep::Mods, None, 0, 0);
    let mods_dir = state.paths.mods_dir(id)?;
    for (file, _) in jar_files(&mods_dir, true) {
        if std::fs::File::open(mods_dir.join(&file)).ok().and_then(|f| zip::ZipArchive::new(f).ok()).is_none() {
            report.broken.push(file);
        }
    }
    Ok(report)
}

/// Removes `*.part` files a cut-off download left behind.
fn drop_partials(dir: &Path) -> usize {
    let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
    rd.flatten().filter(|e| e.path().extension().is_some_and(|x| x == "part") && std::fs::remove_file(e.path()).is_ok()).count()
}

/// Jar names in `dir` with whether each is on; `with_disabled` adds the `.jar.disabled` ones.
fn jar_files(dir: &Path, with_disabled: bool) -> Vec<(String, bool)> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    let mut out: Vec<(String, bool)> = rd
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name.ends_with(".jar") {
                Some((name, true))
            } else if with_disabled && name.ends_with(".jar.disabled") {
                Some((name, false))
            } else {
                None
            }
        })
        .collect();
    out.sort();
    out
}

/// Where a pack file is on disk: as listed, or switched off by the user.
fn on_disk(dir: &Path, f: &PackFile) -> Option<PathBuf> {
    let path = dir.join(&f.path);
    let off = PathBuf::from(format!("{}{DISABLED}", path.display()));
    [path, off].into_iter().find(|p| p.is_file())
}

/// Downloads for pack files that are still there, aimed at whichever name they have now.
fn present_jobs(dir: &Path, files: &[PackFile], allowed: &dyn Fn(&str) -> bool) -> Vec<Job> {
    let (_, auto) = modpacks::split_manual(files.to_vec());
    auto.iter()
        .filter_map(|f| {
            let path = on_disk(dir, f)?;
            let url = f.urls.iter().find(|u| allowed(u))?;
            Some(Job { url: url.clone(), path, size: f.size, sha1: f.sha1.clone() })
        })
        .collect()
}

/// The part of a file name before its version: `sodium-fabric-0.5.3.jar` → `sodium-fabric`.
fn stem(name: &str) -> String {
    let base = name.trim_end_matches(DISABLED);
    let cut = base.find(|c: char| c.is_ascii_digit()).unwrap_or(base.len());
    base[..cut].trim_end_matches(['-', '_', '+', '.', ' ']).to_lowercase()
}

/// Pack files gone from disk. One whose name stem matches a file still in its folder was replaced by an update, not lost.
fn missing_pack_files(dir: &Path, files: &[PackFile]) -> Vec<PackFile> {
    files
        .iter()
        .filter(|f| on_disk(dir, f).is_none())
        .filter(|f| {
            let path = dir.join(&f.path);
            let (Some(folder), Some(name)) = (path.parent(), path.file_name()) else { return true };
            let want = stem(&name.to_string_lossy());
            want.is_empty()
                || !std::fs::read_dir(folder).into_iter().flatten().flatten().any(|e| stem(&e.file_name().to_string_lossy()) == want)
        })
        .cloned()
        .collect()
}

/// A mod jar as the instance's loader reads it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModEntry {
    pub file: String,
    pub enabled: bool,
    /// Set for a mod of this loader.
    pub meta: Option<ModMeta>,
    /// The loader a jar for another loader is made for.
    pub foreign: Option<&'static str>,
    /// Not a readable archive.
    pub broken: bool,
}

/// Every jar in `mods/`, on and off, read the way the instance's loader would read it.
pub fn scan_mods(state: &AppState, id: &str) -> Result<Vec<ModEntry>> {
    let inst = instances::get(state, id)?;
    let dir = state.paths.mods_dir(id)?;
    Ok(jar_files(&dir, true)
        .into_iter()
        .map(|(file, enabled)| {
            let scan = std::fs::File::open(dir.join(&file)).map_err(zip::result::ZipError::Io).and_then(|f| modmeta::scan(f, inst.loader));
            let (meta, foreign, broken) = match scan {
                Ok(Scan::Mod(m)) if !m.id.is_empty() => (Some(m), None, false),
                Ok(Scan::Foreign(p)) => (None, Some(p), false),
                Ok(_) => (None, None, false),
                Err(_) => (None, None, true),
            };
            ModEntry { file, enabled, meta, foreign, broken }
        })
        .collect())
}

/// A pack file gone from disk.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingFile {
    pub path: String,
    pub name: String,
    /// The launcher may download it; otherwise its author only allows a download by hand from `page`.
    pub downloadable: bool,
    pub page: Option<String>,
}

/// Files the instance's modpack ships that are no longer on disk; empty for instances made by hand.
pub async fn missing_files(state: &AppState, id: &str) -> Result<Vec<MissingFile>> {
    let inst = instances::get(state, id)?;
    let Some((plugin, files)) = modpacks::pack_files(state, &inst).await? else { return Ok(vec![]) };
    let dir = state.paths.instance_dir(id)?;
    Ok(missing_pack_files(&dir, &files)
        .into_iter()
        .map(|f| MissingFile { name: modpacks::file_name(&f), downloadable: f.urls.iter().any(|u| plugin.may_download(u)), page: f.page.clone(), path: f.path })
        .collect())
}

/// Downloads the missing pack files the launcher may fetch; returns how many.
pub async fn restore_files(state: &AppState, id: &str) -> Result<usize> {
    let inst = instances::get(state, id)?;
    let (plugin, files) = modpacks::pack_files(state, &inst).await?.ok_or_else(|| AppError::NotFound("This instance is not from a modpack".into()))?;
    let dir = state.paths.instance_dir(id)?;
    let missing: Vec<PackFile> = missing_pack_files(&dir, &files).into_iter().filter(|f| f.urls.iter().any(|u| plugin.may_download(u))).collect();
    let jobs = modpacks::jobs(&dir, &|u| plugin.may_download(u), &missing)?;
    http::download_all(&state.http, jobs, Check::Size, &|_, _| {}).await
}

/// The last session's crash report and JVM error file: written in the instance after it started.
fn crash_files(dir: &Path, since: u64) -> String {
    let fresh = |p: &Path| p.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).is_some_and(|d| d.as_secs() + 1 >= since);
    let mut out = String::new();
    let reports = std::fs::read_dir(dir.join("crash-reports")).into_iter().flatten().flatten().map(|e| e.path());
    let jvm = std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("hs_err_pid")));
    let mut files: Vec<PathBuf> = reports.chain(jvm).filter(|p| p.is_file() && fresh(p)).collect();
    files.sort();
    for f in files {
        out += &std::fs::read_to_string(f).unwrap_or_default();
        out.push('\n');
    }
    out
}

/// The crash report and JVM error file of the last session, joined; empty when it wrote none.
pub fn crash_reports(state: &AppState, id: &str) -> Result<String> {
    let inst = instances::get(state, id)?;
    Ok(crash_files(&state.paths.instance_dir(id)?, inst.last_played))
}

/// Launch settings a fix may look at; never the environment, which may hold secrets.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchFacts {
    pub ram_mb: u32,
    /// The user set their own Java instead of the one the launcher picks.
    pub custom_java: bool,
}

pub fn launch_facts(state: &AppState, id: &str) -> Result<LaunchFacts> {
    let inst = instances::get(state, id)?;
    let s = storage::load_settings(state).for_instance(&inst.settings);
    Ok(LaunchFacts { ram_mb: s.ram_mb, custom_java: !s.java_path.trim().is_empty() })
}

/// One change to an instance's launch, asked by a plugin. Each is checked here, whatever the plugin sent.
#[derive(Debug, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Change {
    SetRam { mb: u32 },
    /// Back to the Java the launcher picks.
    AutoJava,
    /// The newest loader build for the instance's game version.
    UpdateLoader,
}

/// Returns what changed, for people.
pub async fn change(state: &AppState, id: &str, change: Change) -> Result<String> {
    if state.is_running(id) {
        return Err(AppError::Conflict("Close the game first".into()));
    }
    let inst = instances::get(state, id)?;
    match change {
        Change::SetRam { mb } => {
            if !(1024..=65536).contains(&mb) {
                return Err(AppError::Invalid("Memory must be between 1 and 64 GB".into()));
            }
            instances::update(state, id, |i| i.settings.ram_mb = Some(mb))?;
            Ok(format!("Memory set to {} GB", mb as f32 / 1024.0))
        }
        Change::AutoJava => {
            instances::update(state, id, |i| i.settings.java_path = Some(String::new()))?;
            Ok("Using the Java the launcher picks".into())
        }
        Change::UpdateLoader => {
            let latest = loader::latest(&state.http, &inst.version, inst.loader).await?;
            if latest == inst.loader_version {
                return Err(AppError::Conflict(format!("{latest} is already the newest loader for Minecraft {}", inst.version)));
            }
            instances::update(state, id, |i| i.loader_version = latest.clone())?;
            Ok(format!("Loader {} → {latest}", inst.loader_version))
        }
    }
}

/// Catalog projects already in the instance, so dependencies of a new mod are not installed twice.
pub async fn installed_projects(state: &AppState, source_id: &str, id: &str) -> Result<(Vec<String>, HashMap<String, String>)> {
    let plugin = plugins::enabled(state, source_id)?;
    let algo = plugin.manifest.contributes.source.as_ref().map(|s| s.hash).unwrap_or_default();
    let hashes = mods::hashes(state, id, ContentKind::Mod, algo)?;
    let found = mods::identify(state, source_id, hashes).await?;
    let by_file: HashMap<String, String> = found.into_iter().map(|(file, f)| (file, f.project.id)).collect();
    Ok((by_file.values().cloned().collect(), by_file))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pack_files_replaced_by_an_update_are_not_missing() {
        let dir = std::env::temp_dir().join(format!("tn-doctor-{}", std::process::id()));
        let mods = dir.join("mods");
        std::fs::create_dir_all(&mods).unwrap();
        std::fs::write(mods.join("sodium-fabric-0.6.0.jar"), "").unwrap();
        std::fs::write(mods.join("lithium-0.11.jar.disabled"), "").unwrap();
        let file = |p: &str| PackFile { path: p.into(), urls: vec![], size: None, page: None, sha1: None };
        let files = [file("mods/sodium-fabric-0.5.3.jar"), file("mods/lithium-0.11.jar"), file("mods/iris-1.7.jar"), file("config/x.toml")];
        let missing: Vec<String> = missing_pack_files(&dir, &files).into_iter().map(|f| f.path).collect();
        assert_eq!(missing, ["mods/iris-1.7.jar", "config/x.toml"]);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
