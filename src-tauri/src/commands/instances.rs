use crate::error::Result;
use crate::models::{ContentKind, Instance, Loader};
use crate::services::modpacks::{self, ImportProgress};
use crate::services::instances;
use crate::state::AppState;
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub async fn create_instance(state: State<'_, AppState>, name: String, version: String, loader: Loader) -> Result<Instance> {
    instances::create(&state, &name, &version, loader).await
}

/// Creates an instance from a Modrinth `.mrpack` URL.
#[tauri::command]
pub async fn import_modpack(
    state: State<'_, AppState>,
    url: String,
    project_id: String,
    version_number: String,
    on_progress: Channel<ImportProgress>,
) -> Result<Instance> {
    modpacks::import(&state, &url, &project_id, &version_number, &|p| {
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
pub fn delete_instance(state: State<'_, AppState>, id: String) -> Result<()> {
    instances::delete(&state, &id)
}

/// Opens the instance folder (or one of its content folders) in the file manager.
#[tauri::command]
pub fn open_instance_dir(app: AppHandle, state: State<'_, AppState>, id: String, kind: Option<ContentKind>) -> Result<()> {
    let dir = match kind {
        Some(kind) => state.paths.content_dir(&id, kind)?,
        None => state.paths.instance_dir(&id)?,
    };
    std::fs::create_dir_all(&dir)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| crate::error::AppError::Unsupported(e.to_string()))
}
