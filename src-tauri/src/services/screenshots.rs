//! The game's `screenshots/` folder of an instance.
use crate::error::Result;
use crate::models::Screenshot;
use crate::services::mods::safe_file;
use crate::state::AppState;
use std::time::UNIX_EPOCH;

/// Newest first.
pub fn list(state: &AppState, id: &str) -> Result<Vec<Screenshot>> {
    let Ok(entries) = std::fs::read_dir(state.paths.instance_dir(id)?.join("screenshots")) else { return Ok(vec![]) };
    let mut shots: Vec<Screenshot> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let file = e.file_name().to_string_lossy().to_string();
            let meta = e.metadata().ok().filter(|m| m.is_file() && file.ends_with(".png"))?;
            let taken = meta.modified().ok()?.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
            Some(Screenshot { file, size: meta.len(), taken })
        })
        .collect();
    shots.sort_by(|a, b| b.taken.cmp(&a.taken).then_with(|| b.file.cmp(&a.file)));
    Ok(shots)
}

pub fn read(state: &AppState, id: &str, file: &str) -> Result<Vec<u8>> {
    Ok(std::fs::read(state.paths.instance_dir(id)?.join("screenshots").join(safe_file(file)?))?)
}

pub fn delete(state: &AppState, id: &str, file: &str) -> Result<()> {
    std::fs::remove_file(state.paths.instance_dir(id)?.join("screenshots").join(safe_file(file)?))?;
    Ok(())
}
