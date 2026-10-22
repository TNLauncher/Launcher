//! Install → spawn → watch. Progress streams over a Channel; game exit is a global event.
use super::discord::{Discord, Presence};
use super::{instances, now};
use crate::error::{AppError, Result};
use crate::minecraft::{command, install, java, version, Stage};
use crate::models::AfterLaunch;
use crate::state::AppState;
use crate::storage;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{ipc::Channel, AppHandle, Emitter, Manager};

pub const GAME_EXIT_EVENT: &str = "game-exit";

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

/// Marks an instance busy for as long as it lives; dropping it frees the instance.
struct RunningGuard {
    app: AppHandle,
    id: String,
}

impl RunningGuard {
    fn acquire(app: &AppHandle, id: &str) -> Result<Self> {
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
        // Covers both a normal exit and a launch that failed before the game started.
        if running.is_empty() {
            self.app.state::<Discord>().set(Presence::Idle);
        }
    }
}

/// Resolves when the game process has started; the guard then moves to the watcher thread.
pub async fn launch(app: &AppHandle, id: &str, on_event: Channel<LaunchEvent>) -> Result<()> {
    let guard = RunningGuard::acquire(app, id)?;
    let state = app.state::<AppState>();
    let settings = storage::load_settings(&state);
    let inst = instances::get(&state, id)?;
    app.state::<Discord>().set(Presence::Launching { name: inst.name.clone() });
    let root = &state.paths.root;
    let game_dir = state.paths.instance_dir(id)?;
    let natives = game_dir.join(".natives");
    let progress = |stage, done, total| {
        let _ = on_event.send(LaunchEvent::Progress { stage, done, total });
    };

    progress(Stage::Resolving, 0, 0);
    // Before the downloads, so an expired sign-in fails fast.
    let session = super::account::session(&state, settings.player_name()).await?;
    let v = version::resolve(&state.http, root, &inst.version, inst.loader, &inst.loader_version).await?;
    let java = match settings.java_path.trim() {
        "" => java::ensure(&state.http, root, &v, &progress).await?,
        custom => PathBuf::from(custom),
    };
    let classpath = install::install(&state.http, root, &v, &natives, &progress).await?;

    progress(Stage::Starting, 0, 0);
    let log = std::fs::File::create(game_dir.join("launcher.log"))?;
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
        },
    );
    cmd.stdout(log.try_clone()?).stderr(log);
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Unsupported(format!("Could not start Java ({}): {e}", java.display())))?;

    let started = now();
    instances::update(&state, id, |i| i.last_played = started)?;
    let _ = on_event.send(LaunchEvent::Started);
    let mods = super::mods::list(&state, id).map(|m| m.iter().filter(|m| m.enabled).count()).unwrap_or(0);
    app.state::<Discord>().set(Presence::Playing {
        name: inst.name.clone(),
        version: inst.version.clone(),
        loader: inst.loader,
        mods,
        since: started,
    });
    apply_after_launch(app, settings.after_launch);

    let (app, id) = (app.clone(), id.to_string());
    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|s| s.code());
        let state = app.state::<AppState>();
        let _ = instances::update(&state, &id, |i| i.play_seconds += now().saturating_sub(started));
        drop(guard);
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
        }
        let _ = app.emit(GAME_EXIT_EVENT, GameExit { id, code });
    });
    Ok(())
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
