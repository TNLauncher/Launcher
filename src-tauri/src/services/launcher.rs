//! Install → spawn → watch. Progress streams over a Channel; game output and exit are global events.
use super::{instances, now};
use crate::error::{AppError, Result};
use crate::minecraft::http::Check;
use crate::minecraft::{command, install, java, loader, version, Progress, Stage};
use crate::models::{AfterLaunch, Instance, Loader, Settings};
use crate::state::AppState;
use crate::storage;
use serde::Serialize;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::thread::JoinHandle;
use tauri::{ipc::Channel, AppHandle, Emitter, Manager};

pub const GAME_EXIT_EVENT: &str = "game-exit";
pub const GAME_LOG_EVENT: &str = "game-log";
/// The console only needs the recent tail of a long session's log.
const LOG_TAIL_BYTES: u64 = 4 << 20;

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum LaunchEvent {
    Progress { stage: Stage, done: usize, total: usize },
    Started,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameExit {
    pub id: String,
    pub code: Option<i32>,
}

/// One line of game stdout/stderr.
#[derive(Clone, Serialize)]
pub struct GameLog<'a> {
    pub id: &'a str,
    pub line: &'a str,
    pub err: bool,
}

/// Marks an instance busy for as long as it lives; dropping it frees the instance.
pub(crate) struct RunningGuard {
    app: AppHandle,
    id: String,
}

impl RunningGuard {
    pub(crate) fn acquire(app: &AppHandle, id: &str) -> Result<Self> {
        if !app.state::<AppState>().running.lock().unwrap().insert(id.to_string()) {
            return Err(AppError::Conflict("This instance is already running".into()));
        }
        Ok(Self { app: app.clone(), id: id.to_string() })
    }
}

impl Drop for RunningGuard {
    fn drop(&mut self) {
        let state = self.app.state::<AppState>();
        let mut running = state.running.lock().unwrap();
        running.remove(&self.id);
    }
}

/// An instance with everything its launch needs on disk.
pub(crate) struct Prepared {
    pub inst: Instance,
    pub settings: Settings,
    pub version: serde_json::Value,
    pub java: PathBuf,
    pub installed: install::Installed,
}

/// Installs Java, the loader, libraries and assets of an instance; `check` decides how far existing files are trusted.
pub(crate) async fn prepare(state: &AppState, id: &str, check: Check, progress: Progress<'_>) -> Result<Prepared> {
    let mut inst = instances::get(state, id)?;
    let settings = storage::load_settings(state).for_instance(&inst.settings);
    // Instances saved without a loader version would hit `/loader/{game}//profile/json`.
    if inst.loader != Loader::Vanilla && inst.loader_version.is_empty() {
        let v = loader::latest(&state.http, &inst.version, inst.loader).await?;
        instances::update(state, id, |i| i.loader_version = v.clone())?;
        inst.loader_version = v;
    }
    let root = &state.paths.root;
    let natives = state.paths.instance_dir(id)?.join(".natives");
    let base = version::base(&state.http, root, &inst.version).await?;
    // Java follows the vanilla version; Forge/NeoForge installers need it before their profile exists.
    let java = match settings.java_path.trim() {
        "" => java::ensure(&state.http, root, &base, progress).await?,
        custom => PathBuf::from(custom),
    };
    let version = version::with_loader(&state.http, root, base, inst.loader, &inst.loader_version, &java, progress).await?;
    let installed = install::install(&state.http, root, &version, &natives, check, progress).await?;
    Ok(Prepared { inst, settings, version, java, installed })
}

/// Resolves when the game process has started; the guard then moves to the watcher thread.
pub async fn launch(app: &AppHandle, id: &str, on_event: Channel<LaunchEvent>) -> Result<()> {
    let guard = RunningGuard::acquire(app, id)?;
    let state = app.state::<AppState>();
    let root = &state.paths.root;
    let game_dir = state.paths.instance_dir(id)?;
    let natives = game_dir.join(".natives");
    let progress = |stage, done, total| {
        let _ = on_event.send(LaunchEvent::Progress { stage, done, total });
    };

    progress(Stage::Resolving, 0, 0);
    // Before the downloads, so an expired sign-in fails fast.
    let session = super::account::session(&state).await?;
    let Prepared { inst, settings, version: v, java, installed } = prepare(&state, id, Check::Size, &progress).await?;
    let classpath = installed.classpath;

    progress(Stage::Starting, 0, 0);
    let log = Arc::new(File::create(game_dir.join("launcher.log"))?);
    let mut cmd = command::build(
        &v,
        &command::LaunchOptions {
            java: &java,
            root,
            game_dir: &game_dir,
            natives: &natives,
            classpath: &classpath,
            session: &session,
            ram_mb: settings.ram_mb.max(512),
            jvm_args: &settings.jvm_args,
            width: settings.width,
            height: settings.height,
            fullscreen: settings.fullscreen,
            wrapper: &inst.settings.wrapper,
        },
    );
    cmd.envs(inst.settings.env_vars()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Unsupported(format!("Could not start {:?}: {e}", cmd.get_program())))?;

    let readers = [
        pipe(app, id, child.stdout.take().expect("piped"), log.clone(), false),
        pipe(app, id, child.stderr.take().expect("piped"), log, true),
    ];
    state.games.lock().unwrap().insert(id.to_string(), child);

    let started = now();
    instances::update(&state, id, |i| i.last_played = started)?;
    let _ = on_event.send(LaunchEvent::Started);
    apply_after_launch(app, settings.after_launch);

    let (app, id) = (app.clone(), id.to_string());
    std::thread::spawn(move || {
        // Pipes close when the game exits; waiting on them first leaves the child free for `stop`.
        // ponytail: a grandchild that inherits the pipes keeps this open, track the pid if that shows up.
        readers.into_iter().for_each(|r| drop(r.join()));
        let state = app.state::<AppState>();
        let child = state.games.lock().unwrap().remove(&id);
        let code = child.and_then(|mut c| c.wait().ok()).and_then(|s| s.code());
        let _ = instances::update(&state, &id, |i| i.play_seconds += now().saturating_sub(started));
        drop(guard);
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
        }
        let _ = app.emit(GAME_EXIT_EVENT, GameExit { id, code });
    });
    Ok(())
}

/// Tees one output stream into `launcher.log` and the `game-log` event, line by line.
fn pipe(app: &AppHandle, id: &str, src: impl Read + Send + 'static, log: Arc<File>, err: bool) -> JoinHandle<()> {
    let (app, id) = (app.clone(), id.to_string());
    std::thread::spawn(move || {
        let mut reader = BufReader::new(src);
        let mut buf = Vec::new();
        while matches!(reader.read_until(b'\n', &mut buf), Ok(n) if n > 0) {
            let _ = (&*log).write_all(&buf);
            let line = String::from_utf8_lossy(&buf);
            let line = line.trim_end_matches(['\r', '\n']);
            let _ = app.emit(GAME_LOG_EVENT, GameLog { id: &id, line, err });
            buf.clear();
        }
    })
}

/// Kills the running game of an instance.
pub fn stop(state: &AppState, id: &str) -> Result<()> {
    let mut games = state.games.lock().unwrap();
    let child = games.get_mut(id).ok_or_else(|| AppError::NotFound("This instance is not running".into()))?;
    Ok(child.kill()?)
}

/// Tail of the last session's `launcher.log`; empty if the instance never ran.
pub fn read_log(state: &AppState, id: &str) -> Result<String> {
    let mut file = match File::open(state.paths.instance_dir(id)?.join("launcher.log")) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(e) => return Err(e.into()),
    };
    let len = file.metadata()?.len();
    let mut bytes = Vec::new();
    if len > LOG_TAIL_BYTES {
        use std::io::Seek;
        file.seek(std::io::SeekFrom::Start(len - LOG_TAIL_BYTES))?;
    }
    file.read_to_end(&mut bytes)?;
    let text = String::from_utf8_lossy(&bytes);
    // A cut tail starts mid-line; drop the fragment.
    let text = if len > LOG_TAIL_BYTES { text.split_once('\n').map_or("", |(_, t)| t) } else { &text };
    Ok(text.to_string())
}

fn apply_after_launch(app: &AppHandle, action: AfterLaunch) {
    match action {
        AfterLaunch::Hide => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.hide();
            }
        }
        AfterLaunch::Close => app.exit(0),
        AfterLaunch::Keep => {}
    }
}
