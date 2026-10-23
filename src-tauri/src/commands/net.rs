use crate::error::{AppError, Result};
use crate::minecraft::http;
use crate::state::AppState;
use serde_json::Value;
use tauri::State;

/// The only hosts the UI may read directly; content sources go through `plugins`.
const ALLOWED: [&str; 2] = ["https://piston-meta.mojang.com/", "https://launchercontent.mojang.com/"];

/// GET a Mojang JSON document through Rust, so the webview never deals with CORS.
#[tauri::command]
pub async fn fetch_json(state: State<'_, AppState>, url: String) -> Result<Value> {
    if !ALLOWED.iter().any(|h| url.starts_with(h)) {
        return Err(AppError::Invalid(format!("{url} is not an allowed host")));
    }
    http::get_json(&state.http, &url).await
}
