use crate::error::Result;
use crate::minecraft::loader;
use crate::models::{Instance, InstanceSettings, Loader, Screenshot, World};
use crate::services::modpacks::{self, ImportProgress};
use crate::services::{instances, mods, screenshots, worlds};
use crate::state::AppState;
use tauri::{ipc::{Channel, Response}, AppHandle, Manager, State};
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
    app: AppHandle,
    state: State<'_, AppState>,
    source: String,
    project: String,
    version: Option<String>,
    on_progress: Channel<ImportProgress>,
) -> Result<Instance> {
    // Where hand-downloaded files of a pack are looked for.
    let downloads = app.path().download_dir().ok();
    modpacks::import(&state, &source, &project, version.as_deref(), downloads.as_deref(), &|p| {
        let _ = on_progress.send(p);
    })
    .await
}

/// Creates an instance from a modpack archive on disk; whichever enabled plugin reads its format plans it.
/// [`cancel_modpack_import`] with the path stops it.
#[tauri::command]
pub async fn import_modpack_file(app: AppHandle, state: State<'_, AppState>, path: String, on_progress: Channel<ImportProgress>) -> Result<Instance> {
    let downloads = app.path().download_dir().ok();
    modpacks::import_file(&state, std::path::Path::new(&path), downloads.as_deref(), &|p| {
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

/// Copying reads every file, so it runs off the main thread.
#[tauri::command]
pub async fn copy_instance(app: AppHandle, id: String) -> Result<Instance> {
    tauri::async_runtime::spawn_blocking(move || instances::copy(&app.state::<AppState>(), &id)).await?
}

/// "" = ungrouped.
#[tauri::command]
pub fn set_instance_group(state: State<'_, AppState>, id: String, group: String) -> Result<()> {
    instances::set_group(&state, &id, &group)
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

/// Raw PNG bytes. Images go through IPC: WebKitGTK won't display custom-scheme URLs on the dev server's http origin.
#[tauri::command]
pub fn screenshot_bytes(state: State<'_, AppState>, id: String, file: String) -> Result<Response> {
    Ok(Response::new(screenshots::read(&state, &id, &file)?))
}

/// The icon packed inside a mod jar; errors when the mod has none.
#[tauri::command]
pub fn mod_icon(state: State<'_, AppState>, id: String, file: String) -> Result<Response> {
    Ok(Response::new(mods::icon(&state, &id, &file)?.0))
}

#[tauri::command]
pub fn list_worlds(state: State<'_, AppState>, id: String) -> Result<Vec<World>> {
    worlds::list(&state, &id)
}

/// The world's `icon.png` bytes.
#[tauri::command]
pub fn world_icon(state: State<'_, AppState>, id: String, folder: String) -> Result<Response> {
    Ok(Response::new(worlds::icon(&state, &id, &folder)?))
}

#[tauri::command]
pub fn delete_world(state: State<'_, AppState>, id: String, folder: String) -> Result<()> {
    worlds::delete(&state, &id, &folder)
}

/// Resolves with the copy's folder name.
#[tauri::command]
pub async fn copy_world(app: AppHandle, id: String, folder: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || worlds::copy(&app.state::<AppState>(), &id, &folder)).await?
}
