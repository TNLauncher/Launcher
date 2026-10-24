use crate::error::Result;
use crate::models::{Instance, InstanceSettings, Loader, Screenshot};
use crate::services::modpacks::{self, ImportProgress};
use crate::services::{instances, mods, screenshots};
use crate::state::AppState;
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub async fn create_instance(state: State<'_, AppState>, name: String, version: String, loader: Loader) -> Result<Instance> {
    instances::create(&state, &name, &version, loader).await
}

/// Creates an instance from a modpack project; `version` is a version id, `None` = newest.
#[tauri::command]
pub async fn import_modpack(
    state: State<'_, AppState>,
    source: String,
    project: String,
    version: Option<String>,
    on_progress: Channel<ImportProgress>,
) -> Result<Instance> {
    modpacks::import(&state, &source, &project, version.as_deref(), &|p| {
        let _ = on_progress.send(p);
    })
    .await
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
pub fn set_instance_settings(state: State<'_, AppState>, id: String, settings: InstanceSettings) -> Result<()> {
    instances::set_settings(&state, &id, settings)
}

#[tauri::command]
pub fn delete_instance(state: State<'_, AppState>, id: String) -> Result<()> {
    instances::delete(&state, &id)
}

/// Opens the instance folder (or one of its content folders) in the file manager.
#[tauri::command]
pub fn open_instance_dir(app: AppHandle, state: State<'_, AppState>, id: String, folder: Option<String>) -> Result<()> {
    let mut dir = state.paths.instance_dir(&id)?;
    if let Some(folder) = folder {
        dir.push(mods::safe_file(&folder)?);
    }
    std::fs::create_dir_all(&dir)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| crate::error::AppError::Unsupported(e.to_string()))
}

#[tauri::command]
pub fn list_screenshots(state: State<'_, AppState>, id: String) -> Result<Vec<Screenshot>> {
    screenshots::list(&state, &id)
}

#[tauri::command]
pub fn delete_screenshot(state: State<'_, AppState>, id: String, file: String) -> Result<()> {
    screenshots::delete(&state, &id, &file)
}
