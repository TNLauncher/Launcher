use crate::error::Result;
use crate::models::{Instance, Loader};
use crate::services::{instances, modpacks};
use crate::state::AppState;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub async fn create_instance(state: State<'_, AppState>, name: String, version: String, loader: Loader) -> Result<Instance> {
    instances::create(&state, &name, &version, loader).await
}

/// Creates an instance from a Modrinth `.mrpack` URL.
#[tauri::command]
pub async fn import_modpack(state: State<'_, AppState>, url: String) -> Result<Instance> {
    modpacks::import(&state, &url).await
}

#[tauri::command]
pub fn rename_instance(state: State<'_, AppState>, id: String, name: String) -> Result<()> {
    instances::rename(&state, &id, &name)
}

/// `icon` is a `data:image/...` URL, or empty to reset.
#[tauri::command]
pub fn set_instance_icon(state: State<'_, AppState>, id: String, icon: String) -> Result<()> {
    instances::set_icon(&state, &id, &icon)
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
