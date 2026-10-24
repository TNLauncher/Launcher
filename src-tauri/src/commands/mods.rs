use crate::error::Result;
use crate::models::{ContentKind, ModFile};
use crate::services::mods::{self, IdentifiedFile};
use crate::state::AppState;
use std::collections::HashMap;
use tauri::{Manager, State};

#[tauri::command]
pub fn list_content(state: State<'_, AppState>, id: String, kind: ContentKind) -> Result<Vec<ModFile>> {
    mods::list(&state, &id, kind)
}

/// Files of one kind the source recognises, by file name. Hashing reads every file, so it runs off the main thread.
#[tauri::command]
pub async fn identify_content(app: tauri::AppHandle, source: String, id: String, kind: ContentKind) -> Result<HashMap<String, IdentifiedFile>> {
    let algo = crate::plugins::enabled(&app.state::<AppState>(), &source)?.manifest.contributes.source.as_ref().map(|s| s.hash).unwrap_or_default();
    let handle = app.clone();
    let hashes = tauri::async_runtime::spawn_blocking(move || mods::hashes(&handle.state::<AppState>(), &id, kind, algo)).await??;
    mods::identify(&app.state::<AppState>(), &source, hashes).await
}

#[tauri::command]
pub fn toggle_content(state: State<'_, AppState>, id: String, kind: ContentKind, file: String) -> Result<()> {
    mods::toggle(&state, &id, kind, &file)
}

#[tauri::command]
pub fn delete_content(state: State<'_, AppState>, id: String, kind: ContentKind, file: String) -> Result<()> {
    mods::delete(&state, &id, kind, &file)
}

/// `skip`: projects already installed, so dependencies are not added twice.
/// `version`: optional version id (`None` = newest). `replace`: optional existing file name to replace in place.
#[tauri::command]
pub async fn install_content(
    state: State<'_, AppState>,
    source: String,
    id: String,
    kind: ContentKind,
    project: String,
    version: Option<String>,
    replace: Option<String>,
    skip: Vec<String>,
) -> Result<()> {
    mods::install(&state, &source, &id, kind, &project, version.as_deref(), replace.as_deref(), &skip).await
}
