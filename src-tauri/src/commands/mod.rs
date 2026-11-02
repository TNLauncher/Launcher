//! IPC surface. Each file groups commands by feature; bodies only adapt to `services`.

pub mod account;
pub mod app;
pub mod content;
pub mod favorites;
pub mod game;
pub mod instances;
pub mod net;
pub mod plugins;
pub mod settings;

use crate::error::{AppError, Result};
use tauri_plugin_opener::OpenerExt;

/// Opens `dir` in the file manager, creating it first.
fn open_dir(app: &tauri::AppHandle, dir: &std::path::Path) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| AppError::Unsupported(e.to_string()))
}
