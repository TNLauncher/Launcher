use crate::error::Result;
use crate::models::{Instance, Loader};
use crate::services::instances;
use crate::state::AppState;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub async fn create_instance(state: State<'_, AppState>, name: String, version: String, loader: Loader) -> Result<Instance> {
    instances::create(&state, &name, &version, loader).await
}

#[tauri::command]
pub fn rename_instance(state: State<'_, AppState>, id: String, name: String) -> Result<()> {
    instances::rename(&state, &id, &name)
}

#[tauri::command]
pub fn delete_instance(state: State<'_, AppState>, id: String) -> Result<()> {
    instances::delete(&state, &id)
}

/// Opens the instance folder (or its `mods` subfolder) in the file manager.
#[tauri::command]
pub fn open_instance_dir(app: AppHandle, state: State<'_, AppState>, id: String, mods: bool) -> Result<()> {
    let dir = if mods { state.paths.mods_dir(&id)? } else { state.paths.instance_dir(&id)? };
    std::fs::create_dir_all(&dir)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| crate::error::AppError::Unsupported(e.to_string()))
}
