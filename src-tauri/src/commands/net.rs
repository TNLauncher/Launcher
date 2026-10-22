use crate::error::Result;
use crate::minecraft::http;
use crate::state::AppState;
use serde_json::Value;
use tauri::State;

/// GET (or POST `body`) a JSON document through Rust, so the webview never deals with CORS.
#[tauri::command]
pub async fn fetch_json(state: State<'_, AppState>, url: String, body: Option<Value>) -> Result<Value> {
    match body {
        Some(body) => http::post_json(&state.http, &url, &body).await,
        None => http::get_json(&state.http, &url).await,
    }
}
