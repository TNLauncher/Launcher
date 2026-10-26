use crate::error::Result;
use crate::services::doctor::{self, Diagnosis, FixAction, RepairProgress, RepairReport};
use crate::state::AppState;
use tauri::{ipc::Channel, AppHandle, State};

/// Rehashes the instance's game and pack files and downloads the damaged ones.
#[tauri::command]
pub async fn repair_instance(app: AppHandle, id: String, on_progress: Channel<RepairProgress>) -> Result<RepairReport> {
    doctor::repair(&app, &id, on_progress).await
}

/// Unmet mod requirements, conflicts, missing pack files and the last crash's cause, each with its fixes.
#[tauri::command]
pub async fn diagnose_instance(state: State<'_, AppState>, id: String) -> Result<Diagnosis> {
    doctor::diagnose(&state, &id).await
}

/// `source`: the source the user browses, used when the instance is not from a pack.
#[tauri::command]
pub async fn apply_fix(state: State<'_, AppState>, id: String, source: Option<String>, action: FixAction) -> Result<String> {
    doctor::apply(&state, &id, source.as_deref(), action).await
}
