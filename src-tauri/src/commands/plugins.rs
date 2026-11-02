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
pub fn reload_plugins(state: State<'_, AppState>) -> Vec<PluginEntry> {
    plugins::reload(&state)
}

#[tauri::command]
pub fn remove_plugin(state: State<'_, AppState>, id: String) -> Result<Vec<PluginEntry>> {
    plugins::remove(&state, &id)
}

#[tauri::command]
pub fn set_plugin_enabled(state: State<'_, AppState>, id: String, enabled: bool) -> Result<()> {
    plugins::set_enabled(&state, &id, enabled)
}

/// What the plugin store offers.
#[tauri::command]
pub async fn plugin_store(state: State<'_, AppState>) -> Result<Vec<plugins::store::StoreEntry>> {
    plugins::store::index(&state).await
}

/// Installs or updates a plugin from the store; resolves with the reloaded list.
#[tauri::command]
pub async fn install_plugin(state: State<'_, AppState>, id: String) -> Result<Vec<PluginEntry>> {
    plugins::store::install(&state, &id).await
}

/// Opens the folder user plugins are loaded from, creating it first.
#[tauri::command]
pub fn open_plugins_dir(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<()> {
    super::open_dir(&app, &state.paths.plugins_dir())
}

/// Current values of a plugin's declared settings.
#[tauri::command]
pub fn plugin_settings(state: State<'_, AppState>, id: String) -> Result<serde_json::Map<String, Value>> {
    let p = plugins::get(&state, &id)?;
    Ok(plugins::data::settings(&state, &p))
}

#[tauri::command]
pub fn set_plugin_setting(state: State<'_, AppState>, id: String, key: String, value: Value) -> Result<()> {
    let p = plugins::get(&state, &id)?;
    plugins::data::set_setting(&state, &p, &key, value)
}

/// The frontend listens for `plugin-call` events now.
#[tauri::command]
pub fn plugin_host_ready(state: State<'_, AppState>) {
    let bridge = state.plugins.read().unwrap().bridge.clone();
    bridge.listening();
}

/// A plugin frame's answer to a `plugin-call`.
#[tauri::command]
pub fn plugin_reply(state: State<'_, AppState>, id: u64, ok: bool, value: Value) {
    let answer = if ok { Ok(value) } else { Err(value.as_str().map_or_else(|| value.to_string(), String::from)) };
    let bridge = state.plugins.read().unwrap().bridge.clone();
    bridge.reply(id, answer);
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
