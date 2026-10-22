use crate::error::Result;
use crate::models::{Instance, Settings};
use crate::services::instances;
use crate::state::AppState;
use crate::storage;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    settings: Settings,
    /// Signed-in Microsoft player name, if any.
    account: Option<String>,
    instances: Vec<Instance>,
    mod_counts: HashMap<String, usize>,
    running: Vec<String>,
    data_dir: PathBuf,
}

/// Everything the UI needs to render, in one round trip.
#[tauri::command]
pub fn get_state(state: State<'_, AppState>) -> Result<Snapshot> {
    let list = instances::list(&state);
    Ok(Snapshot {
        settings: storage::load_settings(&state),
        account: storage::load_account(&state).map(|a| a.name),
        mod_counts: instances::mod_counts(&state, &list),
        instances: list,
        running: state.running.lock().unwrap().iter().cloned().collect(),
        data_dir: state.paths.root.clone(),
    })
}
