//! Instance repair in two halves. `repair` puts back damaged files without changing what is installed.
//! `diagnose` finds why a build will not start (its mods' own requirements, the last crash, files missing from its pack)
//! and offers fixes; `apply` runs the one the user picked.
use super::launcher::{self, RunningGuard};
use super::{instances, modpacks, mods};
use crate::error::{AppError, Result};
use crate::minecraft::crashlog::{self, Finding, PLATFORM_IDS};
use crate::minecraft::http::{self, Check, Job};
use crate::minecraft::modmeta::{self, ModMeta, Range, Scan};
use crate::minecraft::{loader, Stage};
use crate::models::{ContentKind, Instance, Loader};
use crate::plugins::{
    self,
    api::{PackFile, ProjectKind, SearchQuery, VersionFilter},
};
use crate::state::AppState;
use crate::storage;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{ipc::Channel, AppHandle, Manager};

const DISABLED: &str = ".disabled";
const CONTENT: [ContentKind; 3] = [ContentKind::Mod, ContentKind::Resourcepack, ContentKind::Shader];
/// Above this an out-of-memory crash is a leak, not a small heap.
const MAX_SUGGESTED_RAM_MB: u32 = 12288;

/// Mod ids that differ from their catalog slug.
const SLUGS: &[(&str, &str)] = &[
    ("fabric", "fabric-api"),
    ("cloth-config2", "cloth-config"),
    ("owo", "owo-lib"),
    ("yet_another_config_lib_v3", "yacl"),
    ("yet-another-config-lib", "yacl"),
    ("cardinal-components", "cardinal-components-api"),
    ("forgeconfigapiport", "forge-config-api-port"),
    ("puzzleslib", "puzzles-lib"),
    ("kotlinforforge", "kotlin-for-forge"),
    ("resourcefullib", "resourceful-lib"),
    ("playeranimator", "playeranimator"),
    ("geckolib3", "geckolib"),
];

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IssueKind {
    Missing,
    Version,
    Game,
    Loader,
    Conflict,
    Duplicate,
    Foreign,
    Broken,
    PackFiles,
    Culprit,
    Java,
    Memory,
    Driver,
    Crash,
}

/// What a fix does; comes back from the UI as is, so every field is checked again when applied.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FixAction {
    InstallMod { id: String },
    UpdateMod { file: String },
    DisableMod { file: String },
    DeleteMod { file: String },
    RestorePackFiles,
    UpdateLoader,
    SetRam { mb: u32 },
    AutoJava,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fix {
    pub label: String,
    pub action: FixAction,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    /// Stable across checks: the same problem found twice is one issue.
    pub key: String,
    pub kind: IssueKind,
    pub severity: Severity,
    pub title: String,
    pub detail: String,
    /// The recommended fix first; empty when the launcher cannot fix it.
    pub fixes: Vec<Fix>,
    /// The last crash points at it.
    pub crash: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnosis {
    /// The last session ended in a crash.
    pub crashed: bool,
    /// The error that ended it, in one line.
    pub cause: Option<String>,
    pub issues: Vec<Issue>,
    /// Mods checked.
    pub mods: usize,
}

fn fix(label: impl Into<String>, action: FixAction) -> Fix {
    Fix { label: label.into(), action }
}

fn loader_label(l: Loader) -> &'static str {
    match l {
        Loader::Vanilla => "Minecraft",
        Loader::Fabric => "Fabric",
        Loader::Quilt => "Quilt",
        Loader::Forge => "Forge",
        Loader::NeoForge => "NeoForge",
        Loader::LiteLoader => "LiteLoader",
    }
}

// ─── Repair ────────────────────────────────────────────────────────────────

/// Rehashes game and pack files and downloads the damaged ones. Never adds, removes or switches mods.
pub async fn repair(app: &AppHandle, id: &str, on_progress: Channel<RepairProgress>) -> Result<RepairReport> {
    let _guard = RunningGuard::acquire(app, id)?;
    let state = app.state::<AppState>();
    let send = |step, stage, done, total| {
        let _ = on_progress.send(RepairProgress { step, stage, done, total });
    };
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

// ─── Diagnosis ─────────────────────────────────────────────────────────────

/// One enabled mod jar as its loader reads it.
struct Jar {
    file: String,
    meta: ModMeta,
}

/// Everything installed by id: mods, what they bundle, and the platform itself.
struct Index {
    /// id → (version, file); the platform's ids have no file.
    ids: HashMap<String, (String, Option<String>)>,
    names: HashMap<String, String>,
}

impl Index {
    fn file(&self, id: &str) -> Option<&str> {
        self.ids.get(id).and_then(|(_, f)| f.as_deref())
    }
    fn name<'a>(&'a self, id: &'a str) -> &'a str {
        self.names.get(id).map_or(id, String::as_str)
    }
}

fn loader_ids(l: Loader) -> &'static [&'static str] {
    match l {
        Loader::Fabric => &["fabricloader", "fabric-loader"],
        Loader::Quilt => &["quilt_loader"],
        Loader::Forge => &["forge"],
        Loader::NeoForge => &["neoforge"],
        Loader::Vanilla | Loader::LiteLoader => &[],
    }
}

fn index(inst: &Instance, jars: &[Jar]) -> Index {
    let mut ids: HashMap<String, (String, Option<String>)> = HashMap::new();
    let mut names = HashMap::new();
    // Bundled ids first, so a jar's own id wins over a copy bundled in another jar.
    for j in jars {
        for (id, v) in &j.meta.provides {
            ids.entry(id.clone()).or_insert((v.clone(), Some(j.file.clone())));
        }
    }
    // Two copies of one mod: point at the newest, the one a fix keeps.
    let mut own: HashMap<&str, &str> = HashMap::new();
    for j in jars {
        if own.get(j.meta.id.as_str()).is_some_and(|v| modmeta::cmp(&j.meta.version, v).is_le()) {
            continue;
        }
        own.insert(&j.meta.id, &j.meta.version);
        ids.insert(j.meta.id.clone(), (j.meta.version.clone(), Some(j.file.clone())));
        names.insert(j.meta.id.clone(), j.meta.name.clone());
    }
    // The platform: an empty version meets any range.
    for id in PLATFORM_IDS {
        ids.insert(id.to_string(), (String::new(), None));
    }
    ids.insert("minecraft".into(), (inst.version.clone(), None));
    for id in loader_ids(inst.loader) {
        ids.insert(id.to_string(), (inst.loader_version.clone(), None));
    }
    names.insert("minecraft".into(), "Minecraft".into());
    Index { ids, names }
}

/// Adds `issue`, or marks the one already found with its key as seen in the crash too.
fn add(issues: &mut Vec<Issue>, issue: Issue) {
    match issues.iter_mut().find(|i| i.key == issue.key) {
        Some(found) => found.crash |= issue.crash,
        None => issues.push(issue),
    }
}

fn off_fix(name: &str, file: &str) -> Fix {
    fix(format!("Turn off {name}"), FixAction::DisableMod { file: file.into() })
}

/// The issue for `by` needing `dep` in `wanted` while `present` (or nothing) is installed.
fn requirement(inst: &Instance, idx: &Index, by: &str, dep: &str, wanted: &str, present: Option<&str>, crash: bool) -> Option<Issue> {
    let by_file = idx.file(by);
    let by_name = idx.name(by).to_string();
    let off = by_file.map(|f| off_fix(&by_name, f));
    let wanted_tail = if wanted.is_empty() { String::new() } else { format!(" ({wanted})") };
    let issue = |key: String, kind, title: String, detail: String, fixes: Vec<Fix>| Issue { key, kind, severity: Severity::Error, title, detail, fixes, crash };
    if dep == "java" {
        return None;
    }
    if dep == "minecraft" {
        let file = by_file?;
        return Some(issue(
            format!("game:{file}"),
            IssueKind::Game,
            format!("{by_name} is made for another Minecraft version"),
            format!("It wants Minecraft{wanted_tail}, this instance runs {}.", inst.version),
            [fix(format!("Get {by_name} for {}", inst.version), FixAction::UpdateMod { file: file.into() })].into_iter().chain(off).collect(),
        ));
    }
    if loader_ids(inst.loader).contains(&dep) {
        let loader = loader_label(inst.loader);
        return Some(issue(
            format!("loader:{by}"),
            IssueKind::Loader,
            format!("{by_name} needs a newer {loader}"),
            format!("It wants {loader}{wanted_tail}, this instance has {}.", inst.loader_version),
            [fix(format!("Update {loader}"), FixAction::UpdateLoader)].into_iter().chain(off).collect(),
        ));
    }
    if !idx.ids.contains_key(dep) {
        return Some(issue(
            format!("missing:{dep}"),
            IssueKind::Missing,
            format!("{by_name} needs {dep}"),
            format!("{dep}{wanted_tail} is not installed."),
            [fix(format!("Install {dep}"), FixAction::InstallMod { id: dep.into() })].into_iter().chain(off).collect(),
        ));
    }
    let dep_file = idx.file(dep)?;
    let dep_name = idx.name(dep).to_string();
    let have = present.map(String::from).or_else(|| idx.ids.get(dep).map(|(v, _)| v.clone())).unwrap_or_default();
    Some(issue(
        format!("version:{by}:{dep}"),
        IssueKind::Version,
        format!("{by_name} needs another version of {dep_name}"),
        format!("It wants {dep_name}{wanted_tail}, {have} is installed."),
        [fix(format!("Update {dep_name}"), FixAction::UpdateMod { file: dep_file.into() })].into_iter().chain(off).collect(),
    ))
}

fn conflict(idx: &Index, by: &str, other: &str, crash: bool) -> Option<Issue> {
    let (by_file, other_file) = (idx.file(by)?, idx.file(other)?);
    if by_file == other_file {
        return None;
    }
    let (by_name, other_name) = (idx.name(by), idx.name(other));
    let mut pair = [by, other];
    pair.sort();
    Some(Issue {
        key: format!("conflict:{}:{}", pair[0], pair[1]),
        kind: IssueKind::Conflict,
        severity: Severity::Error,
        title: format!("{by_name} does not work with {other_name}"),
        detail: format!("{by_name} declares {other_name} incompatible. Keep one of them."),
        fixes: vec![off_fix(other_name, other_file), off_fix(by_name, by_file)],
        crash,
    })
}

fn culprit(idx: &Index, id: &str) -> Option<Issue> {
    let file = idx.file(id)?;
    let name = idx.name(id);
    Some(Issue {
        key: format!("culprit:{file}"),
        kind: IssueKind::Culprit,
        severity: Severity::Error,
        title: format!("{name} crashed the game"),
        detail: "The crash points at this mod. A newer build often fixes it; turning it off always does.".into(),
        fixes: vec![fix(format!("Update {name}"), FixAction::UpdateMod { file: file.into() }), off_fix(name, file)],
        crash: true,
    })
}

/// Static checks over the enabled jars: duplicates, unmet requirements, declared conflicts.
fn audit(inst: &Instance, jars: &[Jar], idx: &Index, issues: &mut Vec<Issue>) {
    let mut by_id: HashMap<&str, Vec<&Jar>> = HashMap::new();
    for j in jars {
        by_id.entry(j.meta.id.as_str()).or_default().push(j);
    }
    for (id, copies) in by_id.iter().filter(|(_, c)| c.len() > 1) {
        let newest = copies.iter().max_by(|a, b| modmeta::cmp(&a.meta.version, &b.meta.version)).expect("non-empty");
        for extra in copies.iter().filter(|j| j.file != newest.file) {
            add(
                issues,
                Issue {
                    key: format!("duplicate:{}", extra.file),
                    kind: IssueKind::Duplicate,
                    severity: Severity::Error,
                    title: format!("{} is installed twice", idx.name(id)),
                    detail: format!("{} and {} are the same mod; loaders refuse to start with both.", extra.file, newest.file),
                    fixes: vec![fix(format!("Remove {}", extra.file), FixAction::DisableMod { file: extra.file.clone() })],
                    crash: false,
                },
            );
        }
    }
    for j in jars {
        for d in &j.meta.depends {
            let Some((have, _)) = idx.ids.get(&d.id) else {
                if let Some(i) = requirement(inst, idx, &j.meta.id, &d.id, &modmeta::describe(&d.range), None, false) {
                    add(issues, i);
                }
                continue;
            };
            if !modmeta::satisfies(&d.range, have) {
                if let Some(i) = requirement(inst, idx, &j.meta.id, &d.id, &modmeta::describe(&d.range), Some(have), false) {
                    add(issues, i);
                }
            }
        }
        for b in &j.meta.breaks {
            let hit = idx.ids.get(&b.id).is_some_and(|(v, f)| f.is_some() && (b.range == Range::Any || modmeta::satisfies(&b.range, v)) && !v.is_empty());
            if hit {
                if let Some(i) = conflict(idx, &j.meta.id, &b.id, false) {
                    add(issues, i);
                }
            }
        }
    }
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

fn crash_issues(state: &AppState, inst: &Instance, jars: &[Jar], idx: &Index, analysis: &crashlog::Analysis, issues: &mut Vec<Issue>) {
    let settings = storage::load_settings(state).for_instance(&inst.settings);
    let before = issues.iter().filter(|i| i.crash).count();
    for f in &analysis.findings {
        let issue = match f {
            Finding::Requires { by, dep, wanted, present } => requirement(inst, idx, by, dep, wanted, present.as_deref(), true),
            Finding::Breaks { by, other } => conflict(idx, by, other, true),
            Finding::Culprit { id } => culprit(idx, id),
            Finding::Mixin { config } => jars.iter().find(|j| j.meta.mixins.contains(config)).and_then(|j| culprit(idx, &j.meta.id)),
            Finding::Java { needs } => Some(Issue {
                key: "java".into(),
                kind: IssueKind::Java,
                severity: Severity::Error,
                title: format!("Something needs Java {needs}"),
                detail: if settings.java_path.is_empty() {
                    format!("A mod is built for Java {needs}, newer than Minecraft {} runs on. Get a build of it for this version.", inst.version)
                } else {
                    format!("The custom Java in settings is older than Java {needs}.")
                },
                fixes: if settings.java_path.is_empty() { vec![] } else { vec![fix("Use the Java the launcher picks", FixAction::AutoJava)] },
                crash: true,
            }),
            Finding::OutOfMemory => {
                let mb = (settings.ram_mb + 2048).min(MAX_SUGGESTED_RAM_MB) / 512 * 512;
                Some(Issue {
                    key: "memory".into(),
                    kind: IssueKind::Memory,
                    severity: Severity::Error,
                    title: "The game ran out of memory".into(),
                    detail: format!("It had {} GB.", settings.ram_mb as f32 / 1024.0),
                    fixes: if mb > settings.ram_mb { vec![fix(format!("Give it {} GB", mb as f32 / 1024.0), FixAction::SetRam { mb })] } else { vec![] },
                    crash: true,
                })
            }
            Finding::HeapReserve => {
                let mb = (settings.ram_mb / 2).max(2048) / 512 * 512;
                Some(Issue {
                    key: "memory".into(),
                    kind: IssueKind::Memory,
                    severity: Severity::Error,
                    title: "Java could not get the memory it was given".into(),
                    detail: format!("{} GB is more than this computer can spare.", settings.ram_mb as f32 / 1024.0),
                    fixes: if mb < settings.ram_mb { vec![fix(format!("Lower it to {} GB", mb as f32 / 1024.0), FixAction::SetRam { mb })] } else { vec![] },
                    crash: true,
                })
            }
            Finding::Driver => Some(Issue {
                key: "driver".into(),
                kind: IssueKind::Driver,
                severity: Severity::Error,
                title: "The graphics driver crashed".into(),
                detail: "Update the GPU driver from the vendor's site. Shaders and some render mods make this more likely.".into(),
                fixes: vec![],
                crash: true,
            }),
        };
        if let Some(i) = issue {
            add(issues, i);
        }
    }
    if issues.iter().filter(|i| i.crash).count() == before {
        add(
            issues,
            Issue {
                key: "crash".into(),
                kind: IssueKind::Crash,
                severity: Severity::Error,
                title: "The game crashed".into(),
                detail: "The log does not point at a mod the launcher can fix. Check the console for the full error.".into(),
                fixes: vec![],
                crash: true,
            },
        );
    }
}

/// Checks the instance without changing it.
pub async fn diagnose(state: &AppState, id: &str) -> Result<Diagnosis> {
    let inst = instances::get(state, id)?;
    let dir = state.paths.instance_dir(id)?;
    let mods_dir = state.paths.mods_dir(id)?;
    let mut issues = vec![];
    let mut jars = vec![];
    let mut foreign = vec![];
    for (file, _) in jar_files(&mods_dir, false) {
        match std::fs::File::open(mods_dir.join(&file)).map_err(zip::result::ZipError::Io).and_then(|f| modmeta::scan(f, inst.loader)) {
            Ok(Scan::Mod(meta)) if !meta.id.is_empty() => jars.push(Jar { file, meta }),
            Ok(Scan::Foreign(platform)) => foreign.push((file, platform)),
            Ok(_) => {}
            Err(_) => add(
                &mut issues,
                Issue {
                    key: format!("broken:{file}"),
                    kind: IssueKind::Broken,
                    severity: Severity::Error,
                    title: format!("{file} is damaged"),
                    detail: "It is not a readable jar, so the loader will fail on it. Repair restores pack files; anything else has to go.".into(),
                    fixes: vec![fix(format!("Delete {file}"), FixAction::DeleteMod { file: file.clone() })],
                    crash: false,
                },
            ),
        }
    }
    let idx = index(&inst, &jars);
    audit(&inst, &jars, &idx, &mut issues);

    // Sinytra Connector runs Fabric mods on Forge/NeoForge.
    let connector = idx.ids.contains_key("connector");
    for (file, platform) in foreign {
        if connector && platform == "Fabric" {
            continue;
        }
        add(
            &mut issues,
            Issue {
                key: format!("foreign:{file}"),
                kind: IssueKind::Foreign,
                severity: Severity::Warning,
                title: format!("{file} is a {platform} mod"),
                detail: format!("{} skips it, so whatever needs it will not find it.", loader_label(inst.loader)),
                fixes: vec![fix(format!("Turn off {file}"), FixAction::DisableMod { file: file.clone() })],
                crash: false,
            },
        );
    }

    // A pack whose source is off or offline is still worth the rest of the check.
    if let Ok(Some((plugin, files))) = modpacks::pack_files(state, &inst).await {
        let missing = missing_pack_files(&dir, &files);
        let (manual, auto): (Vec<_>, Vec<_>) = missing.into_iter().partition(|f| !f.urls.iter().any(|u| plugin.may_download(u)));
        let names = |fs: &[PackFile]| fs.iter().map(modpacks::file_name).collect::<Vec<_>>().join(", ");
        if !auto.is_empty() {
            add(
                &mut issues,
                Issue {
                    key: "pack-files".into(),
                    kind: IssueKind::PackFiles,
                    severity: Severity::Error,
                    title: format!("{} {} of the pack {} missing", auto.len(), if auto.len() == 1 { "file" } else { "files" }, if auto.len() == 1 { "is" } else { "are" }),
                    detail: names(&auto),
                    fixes: vec![fix("Download them again", FixAction::RestorePackFiles)],
                    crash: false,
                },
            );
        }
        if !manual.is_empty() {
            add(
                &mut issues,
                Issue {
                    key: "pack-manual".into(),
                    kind: IssueKind::PackFiles,
                    severity: Severity::Warning,
                    title: format!("{} pack {} only by hand", manual.len(), if manual.len() == 1 { "file downloads" } else { "files download" }),
                    detail: format!("Their authors block launchers: {}. Download them from their pages into the instance's mods folder.", names(&manual)),
                    fixes: vec![],
                    crash: false,
                },
            );
        }
    }

    let log = launcher::read_log(state, id).unwrap_or_default();
    let analysis = crashlog::analyze(&log, &crash_files(&dir, inst.last_played));
    if analysis.crashed {
        crash_issues(state, &inst, &jars, &idx, &analysis, &mut issues);
    }
    issues.sort_by_key(|i| (!i.crash, i.severity == Severity::Warning));
    Ok(Diagnosis { crashed: analysis.crashed, cause: analysis.cause, issues, mods: jars.len() })
}

// ─── Fixes ─────────────────────────────────────────────────────────────────

/// The source fixes install from: the pack's own, else the one the user browses.
fn source_for(state: &AppState, inst: &Instance, chosen: Option<&str>) -> Result<String> {
    let pack = inst.pack.as_ref().map(|p| p.source.as_str()).filter(|s| plugins::enabled(state, s).is_ok());
    pack.or(chosen).map(String::from).ok_or_else(|| AppError::NotFound("Turn on a content source to install mods".into()))
}

/// Catalog projects already in the instance, so dependencies of a new mod are not installed twice.
async fn installed_projects(state: &AppState, source_id: &str, id: &str) -> Result<(Vec<String>, HashMap<String, String>)> {
    let plugin = plugins::enabled(state, source_id)?;
    let algo = plugin.manifest.contributes.source.as_ref().map(|s| s.hash).unwrap_or_default();
    let hashes = mods::hashes(state, id, ContentKind::Mod, algo)?;
    let found = mods::identify(state, source_id, hashes).await?;
    let by_file: HashMap<String, String> = found.into_iter().map(|(file, f)| (file, f.project.id)).collect();
    Ok((by_file.values().cloned().collect(), by_file))
}

fn norm(s: &str) -> String {
    s.chars().filter(char::is_ascii_alphanumeric).collect::<String>().to_lowercase()
}

/// The catalog project behind a mod id: the id is usually the slug; otherwise a search by it.
async fn find_project(state: &AppState, source_id: &str, inst: &Instance, mod_id: &str) -> Result<String> {
    let plugin = plugins::enabled(state, source_id)?;
    let source = plugin.source()?;
    let loader = mods::loader_name(inst.loader).to_string();
    let filter = VersionFilter { kind: ProjectKind::Mod, game_version: Some(inst.version.clone()), loader: Some(loader.clone()) };
    let mut slugs: Vec<String> = SLUGS.iter().filter(|(id, _)| *id == mod_id).map(|(_, s)| s.to_string()).collect();
    slugs.push(mod_id.to_string());
    slugs.push(mod_id.replace('_', "-"));
    slugs.dedup();
    for slug in &slugs {
        if source.versions(slug, &filter).await.is_ok_and(|v| !v.is_empty()) {
            return Ok(slug.clone());
        }
    }
    let q = SearchQuery {
        kind: ProjectKind::Mod,
        query: mod_id.replace(['_', '-'], " "),
        game_version: Some(inst.version.clone()),
        loader: Some(loader),
        categories: vec![],
        sort: String::new(),
        offset: 0,
        limit: 10,
    };
    let want: Vec<String> = slugs.iter().map(|s| norm(s)).collect();
    source
        .search(&q)
        .await?
        .hits
        .into_iter()
        .find(|h| want.contains(&norm(&h.slug)) || want.contains(&norm(&h.title)))
        .map(|h| h.id)
        .ok_or_else(|| AppError::NotFound(format!("{mod_id} for Minecraft {} is not on {}", inst.version, plugin.manifest.name)))
}

/// Runs one fix; returns what changed, for people.
pub async fn apply(state: &AppState, id: &str, chosen_source: Option<&str>, action: FixAction) -> Result<String> {
    if state.is_running(id) {
        return Err(AppError::Conflict("Close the game first".into()));
    }
    let inst = instances::get(state, id)?;
    match action {
        FixAction::DisableMod { file } => {
            let file = mods::safe_file(&file)?;
            if !file.ends_with(".jar") {
                return Ok(format!("{file} is already off"));
            }
            mods::toggle(state, id, ContentKind::Mod, file)?;
            Ok(format!("Turned off {file}"))
        }
        FixAction::DeleteMod { file } => {
            mods::delete(state, id, ContentKind::Mod, &file)?;
            Ok(format!("Deleted {file}"))
        }
        FixAction::InstallMod { id: mod_id } => {
            if PLATFORM_IDS.contains(&mod_id.as_str()) || mod_id.is_empty() || mod_id.len() > 64 {
                return Err(AppError::Invalid(format!("{mod_id} is not a mod the launcher installs")));
            }
            let source = source_for(state, &inst, chosen_source)?;
            let project = find_project(state, &source, &inst, &mod_id).await?;
            let (skip, _) = installed_projects(state, &source, id).await?;
            mods::install(state, &source, id, ContentKind::Mod, &project, None, None, &skip).await?;
            Ok(format!("Installed {mod_id}"))
        }
        FixAction::UpdateMod { file } => {
            let file = mods::safe_file(&file)?.to_string();
            let source = source_for(state, &inst, chosen_source)?;
            let (skip, by_file) = installed_projects(state, &source, id).await?;
            let project = by_file.get(&file).ok_or_else(|| AppError::NotFound(format!("{file} is not from the catalog, so there is nothing to update it from")))?;
            mods::install(state, &source, id, ContentKind::Mod, project, None, Some(&file), &skip).await?;
            Ok(format!("Updated {file}"))
        }
        FixAction::RestorePackFiles => {
            let (plugin, files) = modpacks::pack_files(state, &inst).await?.ok_or_else(|| AppError::NotFound("This instance is not from a modpack".into()))?;
            let dir = state.paths.instance_dir(id)?;
            let missing = missing_pack_files(&dir, &files);
            let jobs = modpacks::jobs(&dir, &|u| plugin.may_download(u), &missing.into_iter().filter(|f| f.urls.iter().any(|u| plugin.may_download(u))).collect::<Vec<_>>())?;
            let n = http::download_all(&state.http, jobs, Check::Size, &|_, _| {}).await?;
            Ok(format!("Downloaded {n} pack {}", if n == 1 { "file" } else { "files" }))
        }
        FixAction::UpdateLoader => {
            let latest = loader::latest(&state.http, &inst.version, inst.loader).await?;
            if latest == inst.loader_version {
                return Err(AppError::Conflict(format!("{} {latest} is already the newest for Minecraft {}", loader_label(inst.loader), inst.version)));
            }
            instances::update(state, id, |i| i.loader_version = latest.clone())?;
            Ok(format!("{} {} → {latest}", loader_label(inst.loader), inst.loader_version))
        }
        FixAction::SetRam { mb } => {
            if !(1024..=65536).contains(&mb) {
                return Err(AppError::Invalid("Memory must be between 1 and 64 GB".into()));
            }
            instances::update(state, id, |i| i.settings.ram_mb = Some(mb))?;
            Ok(format!("Memory set to {} GB", mb as f32 / 1024.0))
        }
        FixAction::AutoJava => {
            instances::update(state, id, |i| i.settings.java_path = Some(String::new()))?;
            Ok("Using the Java the launcher picks".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::minecraft::modmeta::Dep;

    fn jar(file: &str, id: &str, version: &str, depends: &[(&str, &str)], breaks: &[&str]) -> Jar {
        let dep = |(id, r): &(&str, &str)| Dep { id: id.to_string(), range: if r.is_empty() { Range::Any } else { Range::Fabric(vec![r.to_string()]) } };
        Jar {
            file: file.into(),
            meta: ModMeta {
                id: id.into(),
                name: id.into(),
                version: version.into(),
                depends: depends.iter().map(dep).collect(),
                breaks: breaks.iter().map(|b| Dep { id: b.to_string(), range: Range::Any }).collect(),
                ..Default::default()
            },
        }
    }

    fn keys(inst: &Instance, jars: &[Jar]) -> Vec<(String, Vec<FixAction>)> {
        let mut issues = vec![];
        audit(inst, jars, &index(inst, jars), &mut issues);
        let mut out: Vec<_> = issues.into_iter().map(|i| (i.key, i.fixes.into_iter().map(|f| f.action).collect())).collect();
        out.sort_by(|a: &(String, _), b| a.0.cmp(&b.0));
        out
    }

    #[test]
    fn audit_finds_and_fixes() {
        let inst = Instance { version: "1.20.1".into(), loader: Loader::Fabric, loader_version: "0.14.0".into(), ..Default::default() };
        let jars = [
            jar("iris.jar", "iris", "1.7.0", &[("sodium", ">=0.5.8"), ("fabricloader", ">=0.15"), ("minecraft", "1.20.1")], &[]),
            jar("sodium-0.5.3.jar", "sodium", "0.5.3", &[("minecraft", "1.20.x")], &[]),
            jar("modmenu.jar", "modmenu", "7.2", &[("fabric-api", "")], &["optifabric"]),
            jar("optifabric.jar", "optifabric", "1.13", &[], &[]),
            jar("old-sodium-0.4.jar", "sodium", "0.4.10", &[], &[]),
            jar("legacy.jar", "legacy", "1", &[("minecraft", "1.16.5"), ("java", ">=8")], &[]),
        ];
        let off = |f: &str| FixAction::DisableMod { file: f.into() };
        assert_eq!(
            keys(&inst, &jars),
            [
                ("conflict:modmenu:optifabric".into(), vec![off("optifabric.jar"), off("modmenu.jar")]),
                ("duplicate:old-sodium-0.4.jar".into(), vec![off("old-sodium-0.4.jar")]),
                ("game:legacy.jar".into(), vec![FixAction::UpdateMod { file: "legacy.jar".into() }, off("legacy.jar")]),
                ("loader:iris".into(), vec![FixAction::UpdateLoader, off("iris.jar")]),
                ("missing:fabric-api".into(), vec![FixAction::InstallMod { id: "fabric-api".into() }, off("modmenu.jar")]),
                ("version:iris:sodium".into(), vec![FixAction::UpdateMod { file: "sodium-0.5.3.jar".into() }, off("iris.jar")]),
            ]
        );
    }

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
