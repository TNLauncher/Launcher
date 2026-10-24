use crate::error::Result;
use crate::plugins::api::{Hit, ProjectKind};
use crate::state::AppState;
use crate::storage;
use serde::{Deserialize, Serialize};
use tauri::State;

/// A catalog project the user starred; the hit is a snapshot so the list shows without asking the source.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    pub source: String,
    pub kind: ProjectKind,
    pub hit: Hit,
}

/// Newest first.
#[tauri::command]
pub fn list_favorites(state: State<'_, AppState>) -> Vec<Favorite> {
    storage::read(&state.paths.favorites_file())
}

/// Stars (`on`) or unstars a project; returns the new list.
#[tauri::command]
pub fn set_favorite(state: State<'_, AppState>, favorite: Favorite, on: bool) -> Result<Vec<Favorite>> {
    let _guard = state.store_lock.lock().unwrap();
    let path = state.paths.favorites_file();
    let mut list: Vec<Favorite> = storage::read(&path);
    list.retain(|f| !(f.source == favorite.source && f.kind == favorite.kind && f.hit.id == favorite.hit.id));
    if on {
        list.insert(0, favorite);
    }
    storage::write(&path, &list)?;
    Ok(list)
}
