//! Catalog projects the user starred.
use crate::error::Result;
use crate::plugins::api::{Hit, ProjectKind};
use crate::state::AppState;
use crate::storage;
use serde::{Deserialize, Serialize};

/// A catalog project the user starred; the hit is a snapshot so the list shows without asking the source.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    pub source: String,
    pub kind: ProjectKind,
    pub hit: Hit,
}

/// Newest first.
pub fn list(state: &AppState) -> Vec<Favorite> {
    storage::read(&state.paths.favorites_file())
}

/// Stars (`on`) or unstars a project; returns the new list.
pub fn set(state: &AppState, favorite: Favorite, on: bool) -> Result<Vec<Favorite>> {
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
