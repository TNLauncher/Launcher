use crate::error::Result;
use crate::models::ModFile;
use crate::services::mods;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn list_mods(state: State<'_, AppState>, id: String) -> Result<Vec<ModFile>> {
    mods::list(&state, &id)
}

#[tauri::command]
pub fn toggle_mod(state: State<'_, AppState>, id: String, file: String) -> Result<()> {
    mods::toggle(&state, &id, &file)
}

#[tauri::command]
pub fn delete_mod(state: State<'_, AppState>, id: String, file: String) -> Result<()> {
    mods::delete(&state, &id, &file)
}

#[tauri::command]
pub async fn install_mod(state: State<'_, AppState>, id: String, url: String, file: String) -> Result<()> {
    mods::install(&state, &id, &url, &file).await
}
