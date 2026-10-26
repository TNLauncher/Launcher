//! The game's `saves/` folder of an instance: one folder per world.
use crate::error::{AppError, Result};
use crate::models::World;
use crate::services::{instances, mods::safe_file};
use crate::state::AppState;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

fn saves(state: &AppState, id: &str) -> Result<PathBuf> {
    Ok(state.paths.instance_dir(id)?.join("saves"))
}

fn world_dir(state: &AppState, id: &str, folder: &str) -> Result<PathBuf> {
    let dir = saves(state, id)?.join(safe_file(folder)?);
    if !dir.join("level.dat").is_file() {
        return Err(AppError::NotFound(format!("No world {folder}")));
    }
    Ok(dir)
}

/// Last played first.
pub fn list(state: &AppState, id: &str) -> Result<Vec<World>> {
    let Ok(entries) = std::fs::read_dir(saves(state, id)?) else { return Ok(vec![]) };
    let mut worlds: Vec<World> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let dir = e.path();
            let level = std::fs::metadata(dir.join("level.dat")).ok()?;
            let played = level.modified().ok()?.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
            Some(World { folder: e.file_name().to_string_lossy().into(), played, icon: dir.join("icon.png").is_file() })
        })
        .collect();
    worlds.sort_by(|a, b| b.played.cmp(&a.played).then_with(|| a.folder.cmp(&b.folder)));
    Ok(worlds)
}

pub fn icon(state: &AppState, id: &str, folder: &str) -> Result<Vec<u8>> {
    Ok(std::fs::read(world_dir(state, id, folder)?.join("icon.png"))?)
}

pub fn delete(state: &AppState, id: &str, folder: &str) -> Result<()> {
    if state.is_running(id) {
        return Err(AppError::Conflict("Close the game before deleting a world".into()));
    }
    std::fs::remove_dir_all(world_dir(state, id, folder)?)?;
    Ok(())
}

/// Copies the world to "<folder> (copy)", "<folder> (copy 2)"...; returns the new folder.
pub fn copy(state: &AppState, id: &str, folder: &str) -> Result<String> {
    let src = world_dir(state, id, folder)?;
    let saves = saves(state, id)?;
    let name = (1..)
        .map(|n| if n == 1 { format!("{folder} (copy)") } else { format!("{folder} (copy {n})") })
        .find(|n| !saves.join(n).exists())
        .expect("some name is free");
    let dst = saves.join(&name);
    // `session.lock` is held by a running game; the copy needs none.
    if let Err(e) = instances::copy_dir(&src, &dst, &["session.lock"]) {
        let _ = std::fs::remove_dir_all(&dst);
        return Err(e);
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_copies_and_deletes() {
        let root = std::env::temp_dir().join(format!("tn-worlds-{}", std::process::id()));
        let state = AppState::new(root.clone()).unwrap();
        let w = state.paths.instance_dir("i").unwrap().join("saves").join("New World");
        std::fs::create_dir_all(w.join("region")).unwrap();
        std::fs::write(w.join("level.dat"), "x").unwrap();
        std::fs::write(w.join("region").join("r.0.0.mca"), "r").unwrap();
        std::fs::write(w.join("session.lock"), "").unwrap();
        // Not a world: no level.dat.
        std::fs::create_dir_all(w.with_file_name("junk")).unwrap();

        assert_eq!(list(&state, "i").unwrap().iter().map(|w| w.folder.as_str()).collect::<Vec<_>>(), ["New World"]);
        assert_eq!(copy(&state, "i", "New World").unwrap(), "New World (copy)");
        assert_eq!(copy(&state, "i", "New World").unwrap(), "New World (copy 2)");
        let c = w.with_file_name("New World (copy)");
        assert_eq!(std::fs::read(c.join("region").join("r.0.0.mca")).unwrap(), b"r");
        assert!(!c.join("session.lock").exists());
        assert!(copy(&state, "i", "../x").is_err() && copy(&state, "i", "junk").is_err());
        delete(&state, "i", "New World (copy 2)").unwrap();
        assert_eq!(list(&state, "i").unwrap().len(), 2);
        std::fs::remove_dir_all(root).unwrap();
    }
}
