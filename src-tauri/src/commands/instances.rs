use crate::error::Result;
use crate::minecraft::loader;
use crate::models::{Instance, InstanceSettings, Loader, Screenshot};
use crate::services::modpacks::{self, ImportProgress};
use crate::services::{instances, mods, screenshots};
use crate::state::AppState;
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
/// `loader_version: None` = the loader's newest stable build.
pub async fn create_instance(state: State<'_, AppState>, name: String, version: String, loader: Loader, loader_version: Option<String>) -> Result<Instance> {
    instances::create(&state, &name, &version, loader, loader_version).await
}

/// Game versions the loader runs; `None` = all of them (vanilla).
#[tauri::command]
pub async fn loader_games(state: State<'_, AppState>, loader: Loader) -> Result<Option<Vec<String>>> {
    loader::games(&state.http, loader).await
}

/// Loader builds for a game version, newest first.
#[tauri::command]
pub async fn loader_builds(state: State<'_, AppState>, version: String, loader: Loader) -> Result<Vec<loader::Build>> {
    loader::builds(&state.http, &version, loader).await
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
pub fn cancel_modpack_import(state: State<'_, AppState>, project: String) {
    modpacks::cancel(&state, &project)
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
