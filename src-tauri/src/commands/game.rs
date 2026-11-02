use crate::error::Result;
use crate::services::launcher::{self, LaunchEvent};
use crate::services::logs;
use crate::state::AppState;
use tauri::{ipc::Channel, AppHandle, State};

#[tauri::command]
/// `world`: a folder in the instance's `saves/` to open straight away; `None` = the title screen.
pub async fn launch(app: AppHandle, id: String, world: Option<String>, on_event: Channel<LaunchEvent>) -> Result<()> {
    launcher::launch(&app, &id, world.as_deref(), on_event).await
}

#[tauri::command]
pub fn stop_game(state: State<'_, AppState>, id: String) -> Result<()> {
    launcher::stop(&state, &id)
}

/// The last session's game output, for instances whose lines were not streamed this run.
#[tauri::command]
pub fn read_game_log(state: State<'_, AppState>, id: String) -> Result<String> {
    logs::read_log(&state, &id)
}

/// The last session's crash report and JVM error file; empty when it wrote none.
#[tauri::command]
pub fn read_crash_report(state: State<'_, AppState>, id: String) -> Result<String> {
    logs::crash_reports(&state, &id)
}
