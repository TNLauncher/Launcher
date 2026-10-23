use crate::error::Result;
use crate::plugins::{self, api::*, host, PluginEntry};
use crate::state::AppState;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub fn list_plugins(state: State<'_, AppState>) -> Vec<PluginEntry> {
    plugins::list(&state)
}

#[tauri::command]
pub fn set_plugin_enabled(state: State<'_, AppState>, id: String, enabled: bool) -> Result<()> {
    plugins::set_enabled(&state, &id, enabled)
}

/// Opens the folder user plugins are loaded from, creating it first.
#[tauri::command]
pub fn open_plugins_dir(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    let dir = state.paths.plugins_dir();
    std::fs::create_dir_all(&dir)?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| crate::error::AppError::Unsupported(e.to_string()))
}

/// Current values of a plugin's declared settings.
#[tauri::command]
pub fn plugin_settings(state: State<'_, AppState>, id: String) -> Result<serde_json::Map<String, Value>> {
    Ok(plugins::data::settings(&state, state.plugins.get(&id)?))
}

#[tauri::command]
pub fn set_plugin_setting(state: State<'_, AppState>, id: String, key: String, value: Value) -> Result<()> {
    plugins::data::set_setting(&state, state.plugins.get(&id)?, &key, value)
}

/// The frontend listens for `plugin-call` events now.
#[tauri::command]
pub fn plugin_host_ready(state: State<'_, AppState>) {
    state.plugins.bridge.listening();
}

/// A plugin frame's answer to a `plugin-call`.
#[tauri::command]
pub fn plugin_reply(state: State<'_, AppState>, id: u64, ok: bool, value: Value) {
    let answer = if ok { Ok(value) } else { Err(value.as_str().map_or_else(|| value.to_string(), String::from)) };
    state.plugins.bridge.reply(id, answer);
}

/// A request from a plugin frame; `plugin` is the frame the frontend saw send it, never the plugin's own word.
#[tauri::command]
pub async fn plugin_request(app: tauri::AppHandle, state: State<'_, AppState>, plugin: String, method: String, params: Value) -> Result<Value> {
    host::request(&app, &state, &plugin, &method, params).await
}

#[tauri::command]
pub async fn source_search(state: State<'_, AppState>, source: String, query: SearchQuery) -> Result<Page> {
    plugins::enabled(&state, &source)?.source()?.search(&query).await
}

#[tauri::command]
pub async fn source_project(state: State<'_, AppState>, source: String, id: String) -> Result<Project> {
    plugins::enabled(&state, &source)?.source()?.project(&id).await
}

#[tauri::command]
pub async fn source_projects(state: State<'_, AppState>, source: String, ids: Vec<String>) -> Result<Vec<ProjectSummary>> {
    plugins::enabled(&state, &source)?.source()?.projects(&ids).await
}

#[tauri::command]
pub async fn source_versions(state: State<'_, AppState>, source: String, project: String, filter: VersionFilter) -> Result<Vec<Version>> {
    plugins::enabled(&state, &source)?.source()?.versions(&project, &filter).await
}
