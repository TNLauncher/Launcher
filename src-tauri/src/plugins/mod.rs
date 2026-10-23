//! Plugins: pieces of the launcher that can be switched off, and later loaded from files.
//! `api` is the contract; built-ins implement it natively.

pub mod api;
pub mod modrinth;

use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::storage;
use api::ContentSource;
use serde::Serialize;
use std::sync::Arc;

/// Every plugin the launcher knows, enabled or not.
pub struct Registry {
    pub sources: Vec<Arc<dyn ContentSource>>,
}

impl Registry {
    pub fn builtin(http: &reqwest::Client) -> Self {
        Self { sources: vec![Arc::new(modrinth::Modrinth::new(http.clone()))] }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginEntry {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    /// Set when the plugin is a content source.
    pub source: Option<api::SourceInfo>,
}

pub fn list(state: &AppState) -> Vec<PluginEntry> {
    let off = storage::load_disabled_plugins(state);
    state
        .plugins
        .sources
        .iter()
        .map(|s| {
            let info = s.info();
            PluginEntry { id: info.id.clone(), name: info.name.clone(), enabled: !off.contains(&info.id), source: Some(info.clone()) }
        })
        .collect()
}

/// An enabled content source by id.
pub fn source(state: &AppState, id: &str) -> Result<Arc<dyn ContentSource>> {
    let found = state.plugins.sources.iter().find(|s| s.info().id == id).ok_or_else(|| AppError::NotFound(format!("No plugin {id}")))?;
    if storage::load_disabled_plugins(state).iter().any(|d| d == id) {
        return Err(AppError::Unsupported(format!("{} is turned off", found.info().name)));
    }
    Ok(found.clone())
}

pub fn set_enabled(state: &AppState, id: &str, enabled: bool) -> Result<()> {
    if !state.plugins.sources.iter().any(|s| s.info().id == id) {
        return Err(AppError::NotFound(format!("No plugin {id}")));
    }
    let mut off = storage::load_disabled_plugins(state);
    off.retain(|d| d != id);
    if !enabled {
        off.push(id.into());
    }
    storage::save_disabled_plugins(state, &off)
}

#[cfg(test)]
mod tests {
    #[test]
    fn disabled_source_is_not_found() {
        let root = std::env::temp_dir().join(format!("tn-plugins-{}", std::process::id()));
        let state = crate::state::AppState::new(root.clone()).unwrap();
        assert!(super::source(&state, "modrinth").is_ok());
        super::set_enabled(&state, "modrinth", false).unwrap();
        assert!(super::source(&state, "modrinth").is_err());
        assert!(!super::list(&state)[0].enabled);
        super::set_enabled(&state, "modrinth", true).unwrap();
        assert!(super::source(&state, "modrinth").is_ok());
        assert!(super::set_enabled(&state, "nope", true).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
