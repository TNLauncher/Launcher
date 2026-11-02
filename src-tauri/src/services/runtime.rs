//! Games that plugins run instead of Java Minecraft (`contributes.runtime`). The plugin only describes a build's
//! files and command lines; the launcher checks, downloads and runs them, and fills in paths and the account, so a
//! plugin never sees a token and never names a program outside its build's folder.
use super::instances;
use crate::paths::{safe_file, safe_rel};
use crate::error::{AppError, Result};
use crate::minecraft::auth::Session;
use crate::minecraft::http::{self, Check, Job};
use crate::minecraft::{install, java, version, Progress, Stage};
use crate::models::{Instance, Loader, RuntimeRef, Settings};
use crate::plugins::{self, api::*, Plugin};
use crate::state::AppState;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Written last into a build's folder, so an interrupted install is redone instead of reused.
const INSTALLED: &str = ".installed";

/// Builds of a runtime plugin, newest first.
pub async fn versions(state: &AppState, plugin: &str) -> Result<Vec<RuntimeVersion>> {
    let list = plugins::enabled(state, plugin)?.runtime()?.versions().await?;
    for v in &list {
        safe_file(&v.id)?;
    }
    Ok(list)
}

/// An instance that plays build `version` of runtime `plugin`.
pub async fn create(state: &AppState, name: &str, plugin: &str, version: &str) -> Result<Instance> {
    let p = plugins::enabled(state, plugin)?;
    let build = versions(state, plugin).await?.into_iter().find(|v| v.id == version).ok_or_else(|| AppError::NotFound(format!("{} has no build {version}", p.manifest.name)))?;
    let mut inst = instances::new(name, &build.minecraft, Loader::Vanilla, String::new());
    inst.runtime = Some(RuntimeRef { plugin: plugin.into(), name: p.manifest.name.clone(), version: build.id });
    instances::add(state, &inst)?;
    Ok(inst)
}

/// The game process of a runtime instance, and what goes to its stdin.
pub struct Game {
    pub cmd: Command,
    pub stdin: Option<String>,
}

/// Installs the build and Minecraft's files it builds on, runs the plugin's steps, and returns the game to start.
pub async fn prepare(state: &AppState, inst: &Instance, r: &RuntimeRef, session: &Session, settings: &Settings, world: Option<&str>, progress: Progress<'_>) -> Result<Game> {
    let plugin = plugins::enabled(state, &r.plugin)?;
    let runtime = plugin.runtime()?;
    if plugin.manifest.contributes.runtime.as_ref().is_some_and(|s| s.requires_microsoft) && session.user_type != "msa" {
        return Err(AppError::Invalid(format!("{} needs a Microsoft account that owns Minecraft: Java Edition", r.name)));
    }
    let (os, arch) = (std::env::consts::OS, std::env::consts::ARCH);
    let dir = state.paths.root.join("runtimes").join(&r.plugin).join(safe_file(&r.version)?);
    // shortcut: two instances of one build installing at once race on its folder; add a lock if that shows up.
    if !dir.join(INSTALLED).exists() {
        progress(Stage::Runtime, 0, 0);
        let files = runtime.install(json!({ "version": r.version, "os": os, "arch": arch })).await?.files;
        install_build(&state.http, &plugin, &dir, files, progress).await?;
    }

    progress(Stage::Resolving, 0, 0);
    let root = &state.paths.root;
    let game_dir = state.paths.instance_dir(&inst.id)?;
    let base = version::base(&state.http, root, &inst.version).await?;
    let java = match settings.java_path.trim() {
        "" => java::ensure(&state.http, root, &base, Check::Size, progress).await?,
        custom => PathBuf::from(custom),
    };
    install::install(&state.http, root, &base, &game_dir.join(".natives"), Check::Size, progress).await?;
    let launch = runtime
        .launch(json!({
            "version": r.version, "os": os, "arch": arch,
            "width": settings.width, "height": settings.height, "fullscreen": settings.fullscreen, "world": world,
        }))
        .await?;

    let v = &inst.version;
    let java_home = java.parent().and_then(Path::parent).unwrap_or(&java).to_path_buf();
    let mut vars: Vec<(&str, PathBuf)> = vec![
        ("runtime", dir.clone()),
        ("instance", game_dir.clone()),
        ("java", java),
        ("javaHome", java_home),
        ("mc.versionJson", root.join("versions").join(v).join(format!("{v}.json"))),
        ("mc.clientJar", root.join("versions").join(v).join(format!("{v}.jar"))),
        ("mc.libraries", root.join("libraries")),
        ("mc.assets", root.join("assets")),
    ];
    if launch.server_jar {
        let server = &base["downloads"]["server"];
        let url = server["url"].as_str().ok_or_else(|| AppError::Unsupported(format!("Minecraft {v} has no server jar")))?;
        let path = root.join("versions").join(v).join(format!("{v}-server.jar"));
        let job = Job { url: url.into(), path: path.clone(), size: server["size"].as_u64(), sha1: server["sha1"].as_str().map(String::from) };
        http::fetch(&state.http, &job, Check::Size).await?;
        vars.push(("mc.serverJar", path));
    }

    for step in &launch.steps {
        run_step(&dir, step, &vars, progress).await?;
    }

    let program = build_file(&dir, &launch.game.program)?;
    let mut wrapper = inst.settings.wrapper.split_whitespace();
    let mut cmd = match wrapper.next() {
        Some(w) => {
            let mut c = Command::new(w);
            c.args(wrapper).arg(&program);
            c
        }
        None => Command::new(&program),
    };
    cmd.current_dir(&game_dir).args(substitute(&launch.game.args, &vars)?);
    let stdin = launch.game.session.map(|SessionPass::Stdin| {
        json!({ "name": session.name, "uuid": session.uuid, "access_token": session.token, "user_type": session.user_type }).to_string()
    });
    Ok(Game { cmd, stdin })
}

/// Downloads every file into a fresh `dir`, checking each against its SHA-256, and unpacks archives.
async fn install_build(c: &reqwest::Client, plugin: &Plugin, dir: &Path, files: Vec<RuntimeFile>, progress: Progress<'_>) -> Result<()> {
    if dir.exists() {
        std::fs::remove_dir_all(dir)?;
    }
    std::fs::create_dir_all(dir)?;
    let total = files.len();
    for (i, f) in files.into_iter().enumerate() {
        progress(Stage::Runtime, i, total);
        if !plugin.may_download(&f.url) {
            return Err(AppError::Invalid(format!("{} is not an allowed download", f.url)));
        }
        let path = dir.join(safe_file(&f.filename)?);
        let bytes = http::fetch_bytes(c, &f.url).await?;
        if !http::hex(&Sha256::digest(&bytes)).eq_ignore_ascii_case(&f.sha256) {
            return Err(AppError::Invalid(format!("{} does not match its checksum", f.url)));
        }
        tokio::fs::write(&path, &bytes).await?;
        if f.extract {
            let (archive, dest) = (path.clone(), dir.to_path_buf());
            tokio::task::spawn_blocking(move || extract(&archive, &dest)).await.map_err(|e| AppError::Unsupported(e.to_string()))??;
            std::fs::remove_file(&path)?;
        }
    }
    progress(Stage::Runtime, total, total);
    std::fs::write(dir.join(INSTALLED), "")?;
    Ok(())
}

/// Unpacks a `.zip` or `.tar.gz` into `dest`; both readers refuse entries that point outside it.
fn extract(archive: &Path, dest: &Path) -> Result<()> {
    let name = archive.file_name().unwrap_or_default().to_string_lossy();
    let file = std::fs::File::open(archive)?;
    if name.ends_with(".zip") {
        zip::ZipArchive::new(file)?.extract(dest)?;
    } else if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        tar::Archive::new(flate2::read::GzDecoder::new(file)).unpack(dest)?;
    } else {
        return Err(AppError::Unsupported(format!("Can't unpack {name}: only .zip and .tar.gz")));
    }
    Ok(())
}

/// A file inside the build's folder; the plugin names it relative to the folder.
fn build_file(dir: &Path, rel: &str) -> Result<PathBuf> {
    let path = dir.join(safe_rel(rel)?);
    if !path.is_file() {
        return Err(AppError::NotFound(format!("{rel} is not in the build")));
    }
    Ok(path)
}

/// Fills `${name}` placeholders; an unknown one is an error rather than a literal argument.
fn substitute(args: &[String], vars: &[(&str, PathBuf)]) -> Result<Vec<String>> {
    args.iter()
        .map(|a| {
            let mut out = String::new();
            let mut rest = a.as_str();
            while let Some(start) = rest.find("${") {
                let end = rest[start..].find('}').ok_or_else(|| AppError::Plugin(format!("Unclosed placeholder in {a}")))? + start;
                let name = &rest[start + 2..end];
                let value = vars.iter().find(|(k, _)| *k == name).ok_or_else(|| AppError::Plugin(format!("Unknown placeholder ${{{name}}}")))?;
                out.push_str(&rest[..start]);
                out.push_str(&value.1.to_string_lossy());
                rest = &rest[end + 1..];
            }
            out.push_str(rest);
            Ok(out)
        })
        .collect()
}

/// Runs one step unless its check passes; JSON progress lines drive the bar, and an `error` line becomes the failure.
async fn run_step(dir: &Path, step: &RuntimeStep, vars: &[(&str, PathBuf)], progress: Progress<'_>) -> Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
    let program = build_file(dir, &step.program)?;
    let spawn_err = |e: std::io::Error| AppError::Unsupported(format!("{}: could not start {}: {e}", step.title, step.program));
    let command = |args: Vec<String>| {
        let mut c = tokio::process::Command::new(&program);
        c.current_dir(dir).args(args).stdin(Stdio::null()).kill_on_drop(true);
        c
    };
    if let Some(check) = &step.check {
        let status = command(substitute(check, vars)?).stdout(Stdio::null()).stderr(Stdio::null()).status().await.map_err(spawn_err)?;
        if status.success() {
            return Ok(());
        }
    }
    progress(Stage::Preparing, 0, 0);
    let mut child = command(substitute(&step.args, vars)?).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(spawn_err)?;
    let mut stderr = child.stderr.take().expect("piped");
    let errors = tokio::spawn(async move {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text).await;
        text
    });
    let mut lines = BufReader::new(child.stdout.take().expect("piped")).lines();
    let mut error = None;
    while let Ok(Some(line)) = lines.next_line().await {
        let Some(ProgressFormat::Json) = step.progress else { continue };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
        if let Some(f) = v["fraction"].as_f64() {
            progress(Stage::Preparing, (f.clamp(0.0, 1.0) * 1000.0) as usize, 1000);
        }
        if let Some(e) = v["error"].as_str() {
            error = Some(e.to_string());
        }
    }
    let status = child.wait().await?;
    let stderr = errors.await.unwrap_or_default();
    if status.success() {
        return Ok(());
    }
    let why = error.or_else(|| stderr.lines().rev().find(|l| !l.trim().is_empty()).map(String::from)).unwrap_or_else(|| status.to_string());
    Err(AppError::Unsupported(format!("{}: {why}", step.title)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn substitutes_known_placeholders_only() {
        let vars = [("runtime", PathBuf::from("/r")), ("mc.assets", PathBuf::from("/a"))];
        let args = ["--out".to_string(), "${runtime}/prepared".into(), "x=${mc.assets}".into()];
        assert_eq!(substitute(&args, &vars).unwrap(), ["--out", "/r/prepared", "x=/a"]);
        assert!(substitute(&["${mc.serverJar}".into()], &vars).unwrap_err().to_string().contains("Unknown placeholder ${mc.serverJar}"));
        assert!(substitute(&["${runtime".into()], &vars).is_err());
    }

    #[test]
    fn keeps_programs_inside_the_build() {
        let dir = std::env::temp_dir().join(format!("tn-runtime-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("bin")).unwrap();
        std::fs::write(dir.join("bin/game"), "").unwrap();
        assert!(build_file(&dir, "bin/game").is_ok());
        assert!(build_file(&dir, "../game").is_err());
        assert!(build_file(&dir, "/bin/sh").is_err());
        assert!(build_file(&dir, "bin/missing").is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn steps_skip_on_check_and_report_json_errors() {
        use std::os::unix::fs::PermissionsExt;
        use std::sync::Mutex;
        let dir = std::env::temp_dir().join(format!("tn-runtime-step-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = r#"#!/bin/sh
[ "$1" = check ] && exit "$2"
echo '{"fraction": 0.5}'
echo 'plain text'
echo '{"error": "no server jar"}'
echo 'to stderr' >&2
exit 1
"#;
        std::fs::write(dir.join("prep"), script).unwrap();
        std::fs::set_permissions(dir.join("prep"), std::fs::Permissions::from_mode(0o755)).unwrap();
        let seen = Mutex::new(vec![]);
        let progress = |stage, done, total| seen.lock().unwrap().push((stage, done, total));
        let step = |check: &str| RuntimeStep {
            title: "Prep".into(),
            program: "prep".into(),
            args: vec![],
            check: Some(vec!["check".into(), check.into()]),
            progress: Some(ProgressFormat::Json),
        };
        run_step(&dir, &step("0"), &[], &progress).await.unwrap();
        assert!(seen.lock().unwrap().is_empty(), "a passing check skips the step");
        let err = run_step(&dir, &step("1"), &[], &progress).await.unwrap_err().to_string();
        assert_eq!(err, "Prep: no server jar");
        assert_eq!(*seen.lock().unwrap(), [(Stage::Preparing, 0, 0), (Stage::Preparing, 500, 1000)]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn unpacks_tar_gz() {
        let dir = std::env::temp_dir().join(format!("tn-runtime-tar-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let archive = dir.join("a.tar.gz");
        let mut b = tar::Builder::new(flate2::write::GzEncoder::new(std::fs::File::create(&archive).unwrap(), flate2::Compression::fast()));
        let mut h = tar::Header::new_gnu();
        h.set_size(2);
        h.set_mode(0o755);
        h.set_cksum();
        b.append_data(&mut h, "top/game", &b"hi"[..]).unwrap();
        b.into_inner().unwrap().finish().unwrap();
        extract(&archive, &dir).unwrap();
        assert_eq!(std::fs::read(dir.join("top/game")).unwrap(), b"hi");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(dir.join("top/game")).unwrap().permissions().mode() & 0o111, 0o111);
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
}
