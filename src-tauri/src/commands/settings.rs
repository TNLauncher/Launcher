use crate::error::Result;
use crate::models::Settings;
use crate::state::AppState;
use crate::storage;
use tauri::State;

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<()> {
    storage::save_settings(&state, &settings)
}
