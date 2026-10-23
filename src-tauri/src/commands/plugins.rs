use crate::error::Result;
use crate::plugins::{self, api::*, PluginEntry};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn list_plugins(state: State<'_, AppState>) -> Vec<PluginEntry> {
    plugins::list(&state)
}

#[tauri::command]
pub fn set_plugin_enabled(state: State<'_, AppState>, id: String, enabled: bool) -> Result<()> {
    plugins::set_enabled(&state, &id, enabled)
}

#[tauri::command]
pub async fn source_search(state: State<'_, AppState>, source: String, query: SearchQuery) -> Result<Page> {
    plugins::source(&state, &source)?.search(&query).await
}

#[tauri::command]
pub async fn source_project(state: State<'_, AppState>, source: String, id: String) -> Result<Project> {
    plugins::source(&state, &source)?.project(&id).await
}

#[tauri::command]
pub async fn source_projects(state: State<'_, AppState>, source: String, ids: Vec<String>) -> Result<Vec<ProjectSummary>> {
    plugins::source(&state, &source)?.projects(&ids).await
}

#[tauri::command]
pub async fn source_versions(state: State<'_, AppState>, source: String, project: String, filter: VersionFilter) -> Result<Vec<Version>> {
    plugins::source(&state, &source)?.versions(&project, &filter).await
}
