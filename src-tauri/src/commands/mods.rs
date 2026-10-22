use crate::error::Result;
use crate::models::{ContentKind, ModFile};
use crate::services::mods;
use crate::state::AppState;
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub fn list_content(state: State<'_, AppState>, id: String, kind: ContentKind) -> Result<Vec<ModFile>> {
    mods::list(&state, &id, kind)
}

/// Hashing reads every file, so it runs off the main thread.
#[tauri::command]
pub async fn hash_content(app: tauri::AppHandle, id: String, kind: ContentKind) -> Result<HashMap<String, String>> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || mods::hashes(&app.state::<AppState>(), &id, kind)).await?
}

#[tauri::command]
pub fn toggle_content(state: State<'_, AppState>, id: String, kind: ContentKind, file: String) -> Result<()> {
    mods::toggle(&state, &id, kind, &file)
}

#[tauri::command]
pub fn delete_content(state: State<'_, AppState>, id: String, kind: ContentKind, file: String) -> Result<()> {
    mods::delete(&state, &id, kind, &file)
}

#[tauri::command]
pub async fn install_content(state: State<'_, AppState>, id: String, kind: ContentKind, url: String, file: String) -> Result<()> {
    mods::install(&state, &id, kind, &url, &file).await
}
