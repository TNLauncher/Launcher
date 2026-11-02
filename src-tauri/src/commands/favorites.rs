use crate::error::Result;
use crate::services::favorites::{self, Favorite};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn list_favorites(state: State<'_, AppState>) -> Vec<Favorite> {
    favorites::list(&state)
}

#[tauri::command]
pub fn set_favorite(state: State<'_, AppState>, favorite: Favorite, on: bool) -> Result<Vec<Favorite>> {
    favorites::set(&state, favorite, on)
}
