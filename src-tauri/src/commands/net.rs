use crate::error::Result;
use crate::minecraft::http;
use crate::state::AppState;
use serde_json::Value;
use tauri::State;

/// GET a JSON document through Rust, so the webview never deals with CORS.
#[tauri::command]
pub async fn fetch_json(state: State<'_, AppState>, url: String) -> Result<Value> {
    http::get_json(&state.http, &url).await
}
