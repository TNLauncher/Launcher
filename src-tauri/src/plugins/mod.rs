//! Plugins: folders with a `manifest.json` and JS, bundled with the app or dropped into
//! `<app data>/plugins/`. Each runs in a sandboxed iframe of the main window and reaches the launcher
//! only through the bridge: `host` serves its files and answers its requests, `remote` calls into it.
//! Rust stays the source of truth: it owns the disk and checks every request against the manifest.
//!
//! - `manifest` — what a plugin declares; `registry` — the loaded plugins and which are on.
//! - `bridge` + `remote` — calls from Rust into a plugin frame; `host` — requests from a frame into Rust (`tn.*`).
//! - `api` — the data both sides exchange; `data` — a plugin's own storage and settings.
//! - `store` — the plugin store's catalog and installing from it.

pub mod api;
pub mod bridge;
pub mod data;
pub mod host;
pub mod manifest;
pub mod registry;
pub mod remote;
pub mod store;

pub use manifest::*;
pub use registry::{Failed, Plugin, Registry};

use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::storage;
use api::{Choice, ProjectKind};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;

/// What the UI needs to browse a source.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub id: String,
    pub name: String,
    pub sorts: Vec<Choice>,
    pub categories: HashMap<ProjectKind, Vec<Choice>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginEntry {
    /// Empty for a plugin that failed to load.
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub enabled: bool,
    pub bundled: bool,
    pub main: String,
    pub permissions: Permissions,
    pub source: Option<SourceInfo>,
    pub pages: Vec<PageSpec>,
    pub instance_tabs: Vec<PageSpec>,
    pub settings: Vec<SettingSpec>,
    /// Sign-in form fields when the plugin provides accounts.
    pub account: Option<AccountSpec>,
    /// Set when the plugin is a game runtime.
    pub runtime: Option<RuntimeSpec>,
    /// Why the plugin did not load; it is then off.
    pub error: Option<String>,
}

pub fn get(state: &AppState, id: &str) -> Result<Arc<Plugin>> {
    state.plugins.read().unwrap().get(id).cloned()
}

pub fn list(state: &AppState) -> Vec<PluginEntry> {
    let reg = state.plugins.read().unwrap();
    let loaded = reg.plugins.iter().map(|p| {
        let m = &p.manifest;
        PluginEntry {
            id: m.id.clone(),
            name: m.name.clone(),
            version: m.version.clone(),
            description: m.description.clone(),
            enabled: reg.is_enabled(&m.id),
            bundled: p.bundled,
            main: m.main.clone(),
            permissions: m.permissions.clone(),
            source: m.contributes.source.as_ref().map(|s| SourceInfo { id: m.id.clone(), name: m.name.clone(), sorts: s.sorts.clone(), categories: s.categories.clone() }),
            pages: m.contributes.pages.clone(),
            instance_tabs: m.contributes.instance_tabs.clone(),
            settings: m.contributes.settings.clone(),
            account: m.contributes.account.clone(),
            runtime: m.contributes.runtime.clone(),
            error: None,
        }
    });
    let failed = reg.failed.iter().map(|f| PluginEntry {
        id: String::new(),
        name: f.name.clone(),
        version: String::new(),
        description: String::new(),
        enabled: false,
        bundled: false,
        main: String::new(),
        permissions: Permissions::default(),
        source: None,
        pages: vec![],
        instance_tabs: vec![],
        settings: vec![],
        account: None,
        runtime: None,
        error: Some(f.error.clone()),
    });
    loaded.chain(failed).collect()
}

/// Re-scans the plugin folders on disk without restarting the launcher.
pub fn reload(state: &AppState) -> Vec<PluginEntry> {
    let mut reg = state.plugins.write().unwrap();
    *reg = Registry::load(&reg.dirs.clone(), std::mem::take(&mut reg.disabled), reg.bridge.clone());
    drop(reg);
    list(state)
}

/// Deletes a user-installed plugin folder and reloads the registry.
pub fn remove(state: &AppState, id: &str) -> Result<Vec<PluginEntry>> {
    let found = get(state, id)?;
    if found.bundled {
        return Err(AppError::Invalid(format!("{} is built-in and cannot be deleted", found.manifest.name)));
    }
    std::fs::remove_dir_all(&found.dir)?;
    let _ = std::fs::remove_dir_all(state.paths.plugin_data_dir(id));
    if !state.plugins.read().unwrap().is_enabled(id) {
        let _ = set_enabled(state, id, true);
    }
    Ok(reload(state))
}

/// An enabled plugin by id.
pub fn enabled(state: &AppState, id: &str) -> Result<Arc<Plugin>> {
    let reg = state.plugins.read().unwrap();
    let found = reg.get(id)?;
    if !reg.is_enabled(id) {
        return Err(AppError::Unsupported(format!("{} is turned off", found.manifest.name)));
    }
    Ok(found.clone())
}

/// Every plugin the user has not turned off, in load order.
pub fn all_enabled(state: &AppState) -> Vec<Arc<Plugin>> {
    let reg = state.plugins.read().unwrap();
    reg.plugins.iter().filter(|p| reg.is_enabled(&p.manifest.id)).cloned().collect()
}

pub fn set_enabled(state: &AppState, id: &str, enabled: bool) -> Result<()> {
    let mut reg = state.plugins.write().unwrap();
    reg.get(id)?;
    let mut off = reg.disabled.clone();
    off.retain(|d| d != id);
    if !enabled {
        off.push(id.into());
    }
    storage::save_disabled_plugins(state, &off)?;
    reg.disabled = off;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn write_plugin(dir: &Path, id: &str, api: u32, with_main: bool) {
        let folder = dir.join(id);
        std::fs::create_dir_all(&folder).unwrap();
        let m = serde_json::json!({ "id": id, "name": id, "version": "1", "api": api, "contributes": { "source": { "sorts": [], "categories": {} } } });
        std::fs::write(folder.join("manifest.json"), m.to_string()).unwrap();
        if with_main {
            std::fs::write(folder.join("main.js"), "export function activate() {}").unwrap();
        }
    }

    #[test]
    fn loads_folders_and_toggles() {
        let root = std::env::temp_dir().join(format!("tn-plugins-{}", std::process::id()));
        let dir = root.join("plugins");
        write_plugin(&dir, "good", API_VERSION, true);
        write_plugin(&dir, "old", API_VERSION + 1, true);
        write_plugin(&dir, "nomain", API_VERSION, false);
        std::fs::create_dir_all(dir.join("empty")).unwrap();

        let state = AppState::new(root.clone()).unwrap();
        let bridge = state.plugins.read().unwrap().bridge.clone();
        *state.plugins.write().unwrap() = Registry::load(&[(dir.clone(), true), (dir, false)], vec![], bridge);
        {
            let reg = state.plugins.read().unwrap();
            let ids: Vec<_> = reg.plugins.iter().map(|p| p.manifest.id.as_str()).collect();
            assert_eq!(ids, ["good"]);
            // empty, nomain and old fail in both passes; the second pass also finds "good" again.
            assert_eq!(reg.failed.len(), 7);
            assert!(reg.plugins[0].bundled && reg.plugins[0].source.is_some());
        }

        assert!(enabled(&state, "good").is_ok());
        set_enabled(&state, "good", false).unwrap();
        assert!(enabled(&state, "good").is_err());
        assert!(!list(&state)[0].enabled);
        // Survives a reload: the on/off state is kept, not re-read.
        reload(&state);
        assert!(enabled(&state, "good").is_err());
        assert_eq!(storage::load_disabled_plugins(&state), ["good"]);
        set_enabled(&state, "good", true).unwrap();
        assert!(enabled(&state, "good").is_ok());
        assert!(set_enabled(&state, "nope", true).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
