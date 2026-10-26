//! Plugins: folders with a `manifest.json` and JS, bundled with the app or dropped into
//! `<app data>/plugins/`. Each runs in a sandboxed iframe of the main window and reaches the launcher
//! only through the bridge: `host` serves its files and answers its requests, `js` calls into it.
//! Rust stays the source of truth: it owns the disk and checks every request against the manifest.

pub mod api;
pub mod data;
pub mod host;
pub mod js;

use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::storage;
use api::{Choice, ContentSource, ProjectKind};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Bumped on breaking changes to the plugin API; plugins declaring another version are not loaded.
pub const API_VERSION: u32 = 1;

/// `manifest.json`. Mirrored in packages/plugin-api/index.d.ts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    /// `[a-z0-9-]`, unique.
    pub id: String,
    pub name: String,
    pub version: String,
    pub api: u32,
    #[serde(default)]
    pub description: String,
    /// ES module whose `activate(tn)` runs at startup.
    #[serde(default = "default_main")]
    pub main: String,
    #[serde(default)]
    pub contributes: Contributes,
    #[serde(default)]
    pub permissions: Permissions,
}

fn default_main() -> String {
    "main.js".into()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contributes {
    /// Set when the plugin is a content source; it must then `tn.sources.register` one.
    pub source: Option<SourceSpec>,
    /// Pages added to the sidebar.
    #[serde(default)]
    pub pages: Vec<PageSpec>,
    /// Tabs added to every instance page; the frame gets `tn.context.instance`.
    #[serde(default)]
    pub instance_tabs: Vec<PageSpec>,
    /// Options the user sets in Settings; the plugin reads them with `tn.settings.get()`.
    #[serde(default)]
    pub settings: Vec<SettingSpec>,
    /// Makes the plugin an account provider: the sign-in form's fields. It must `tn.accounts.register` one.
    pub account: Option<AccountSpec>,
    /// Reads modpack archives of some format (`tn.importers.register`); the user imports them from a file.
    #[serde(default)]
    pub importer: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSpec {
    /// Text or secret fields; toggles are not offered here.
    pub fields: Vec<SettingSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingSpec {
    /// `[A-Za-z0-9_-]`.
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub hint: String,
    #[serde(rename = "type")]
    pub kind: SettingKind,
    #[serde(default)]
    pub default: Option<serde_json::Value>,
    /// Choices when `type` is `select`.
    #[serde(default)]
    pub options: Vec<Choice>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SettingKind {
    Text,
    /// Shown masked, e.g. an API key.
    Secret,
    Toggle,
    Select,
}

/// What the UI builds a source's filters from.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSpec {
    /// Sort orders for search, first = default.
    pub sorts: Vec<Choice>,
    /// Browse categories per kind; a kind missing here is not offered by the source.
    pub categories: HashMap<ProjectKind, Vec<Choice>>,
    /// How `identify` receives installed files.
    #[serde(default)]
    pub hash: HashAlgo,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HashAlgo {
    /// Hex SHA-1 (Modrinth).
    #[default]
    Sha1,
    /// CurseForge's fingerprint, as a decimal string: MurmurHash2 (seed 1) of the file minus whitespace bytes.
    Murmur2,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSpec {
    pub id: String,
    pub title: String,
    /// Material Symbols name.
    pub icon: String,
    /// HTML file in the plugin folder.
    pub entry: String,
    /// Instance tabs: also a button in the instance header that opens the tab.
    #[serde(default)]
    pub header: bool,
    /// Instance tabs: offered next to the error when the game crashes or fails to start.
    #[serde(default)]
    pub crash: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Permissions {
    /// Hosts the plugin may request (`tn.net.fetch`) and show images from; `*.example.com` allowed.
    #[serde(default)]
    pub hosts: Vec<String>,
    /// URL prefixes the launcher may download files from on the plugin's behalf.
    #[serde(default)]
    pub downloads: Vec<String>,
    /// Read the instance list (`tn.instances`) and game start/exit events.
    #[serde(default)]
    pub instances: bool,
    /// Change instances (`tn.content`, `tn.instances.repair`/`restoreFiles`/`change`): add, swap, switch off and
    /// delete content, repair files, change memory, Java and loader. Needs `instances` too.
    #[serde(default)]
    pub content: bool,
    /// Set the Discord status (`tn.presence`).
    #[serde(default)]
    pub presence: bool,
    /// Load a Java agent into the game (account providers like Ely.by need authlib-injector). Runs code in the game.
    #[serde(default)]
    pub jvm: bool,
}

pub struct Plugin {
    pub manifest: Manifest,
    pub dir: PathBuf,
    /// Shipped with the launcher rather than added by the user.
    pub bundled: bool,
    pub source: Option<Arc<dyn ContentSource>>,
    pub account: Option<js::JsAccount>,
    pub importer: Option<js::JsImporter>,
}

impl Plugin {
    /// Whether the launcher may download `url` for this plugin.
    pub fn may_download(&self, url: &str) -> bool {
        self.manifest.permissions.downloads.iter().any(|h| url.starts_with(h.as_str()))
    }

    /// The account provider, or an error naming the plugin.
    pub fn account(&self) -> Result<&js::JsAccount> {
        self.account.as_ref().ok_or_else(|| AppError::Unsupported(format!("{} is not an account provider", self.manifest.name)))
    }

    /// The content source, or an error naming the plugin.
    pub fn source(&self) -> Result<&Arc<dyn ContentSource>> {
        self.source.as_ref().ok_or_else(|| AppError::Unsupported(format!("{} is not a content source", self.manifest.name)))
    }
}

/// A plugin folder that could not be loaded.
pub struct Failed {
    pub name: String,
    pub error: String,
}

pub struct Registry {
    pub dirs: Vec<(PathBuf, bool)>,
    pub plugins: Vec<Arc<Plugin>>,
    pub failed: Vec<Failed>,
    pub bridge: Arc<js::Bridge>,
}

impl Registry {
    pub fn empty(bridge: Arc<js::Bridge>) -> Self {
        Self { dirs: vec![], plugins: vec![], failed: vec![], bridge }
    }

    /// Loads every plugin folder in `dirs` as `(dir, bundled)`; the first plugin with an id wins.
    pub fn load(dirs: &[(PathBuf, bool)], bridge: Arc<js::Bridge>) -> Self {
        let mut reg = Self { dirs: dirs.to_vec(), plugins: vec![], failed: vec![], bridge };
        for (dir, bundled) in dirs {
            let Ok(entries) = std::fs::read_dir(dir) else { continue };
            let mut folders: Vec<PathBuf> = entries.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir()).collect();
            folders.sort();
            for folder in folders {
                let name = folder.file_name().unwrap_or_default().to_string_lossy().into_owned();
                match read_manifest(&folder) {
                    Ok(m) if reg.plugins.iter().any(|p| p.manifest.id == m.id) => {
                        reg.failed.push(Failed { name: m.name, error: format!("Another plugin already uses the id {}", m.id) })
                    }
                    Ok(manifest) => {
                        let source = manifest.contributes.source.as_ref().map(|_| {
                            Arc::new(js::JsSource { plugin: manifest.id.clone(), bridge: reg.bridge.clone() }) as Arc<dyn ContentSource>
                        });
                        let account = manifest.contributes.account.as_ref().map(|_| js::JsAccount { plugin: manifest.id.clone(), bridge: reg.bridge.clone() });
                        let importer = manifest.contributes.importer.then(|| js::JsImporter { plugin: manifest.id.clone(), bridge: reg.bridge.clone() });
                        reg.plugins.push(Arc::new(Plugin { manifest, dir: folder, bundled: *bundled, source, account, importer }));
                    }
                    Err(e) => reg.failed.push(Failed { name, error: e.to_string() }),
                }
            }
        }
        reg
    }

    pub fn get(&self, id: &str) -> Result<&Arc<Plugin>> {
        self.plugins.iter().find(|p| p.manifest.id == id).ok_or_else(|| AppError::NotFound(format!("No plugin {id}")))
    }
}

fn read_manifest(folder: &Path) -> Result<Manifest> {
    let m: Manifest = serde_json::from_slice(&std::fs::read(folder.join("manifest.json"))?)?;
    if m.api != API_VERSION {
        return Err(AppError::Plugin(format!("Built for plugin API {}, the launcher speaks {API_VERSION}", m.api)));
    }
    if m.id.is_empty() || !m.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        return Err(AppError::Plugin(format!("Bad plugin id: {}", m.id)));
    }
    for s in &m.contributes.settings {
        if s.key.is_empty() || !s.key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
            return Err(AppError::Plugin(format!("Bad setting key: {}", s.key)));
        }
        if s.kind == SettingKind::Select && s.options.is_empty() {
            return Err(AppError::Plugin(format!("Select setting {} has no options", s.key)));
        }
    }
    if !folder.join(&m.main).is_file() {
        return Err(AppError::Plugin(format!("{} is missing", m.main)));
    }
    Ok(m)
}

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
    /// Why the plugin did not load; it is then off.
    pub error: Option<String>,
}

pub fn get(state: &AppState, id: &str) -> Result<Arc<Plugin>> {
    state.plugins.read().unwrap().get(id).cloned()
}

pub fn list(state: &AppState) -> Vec<PluginEntry> {
    let off = storage::load_disabled_plugins(state);
    let reg = state.plugins.read().unwrap();
    let loaded = reg.plugins.iter().map(|p| {
        let m = &p.manifest;
        PluginEntry {
            id: m.id.clone(),
            name: m.name.clone(),
            version: m.version.clone(),
            description: m.description.clone(),
            enabled: !off.contains(&m.id),
            bundled: p.bundled,
            main: m.main.clone(),
            permissions: m.permissions.clone(),
            source: m.contributes.source.as_ref().map(|s| SourceInfo { id: m.id.clone(), name: m.name.clone(), sorts: s.sorts.clone(), categories: s.categories.clone() }),
            pages: m.contributes.pages.clone(),
            instance_tabs: m.contributes.instance_tabs.clone(),
            settings: m.contributes.settings.clone(),
            account: m.contributes.account.clone(),
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
        error: Some(f.error.clone()),
    });
    loaded.chain(failed).collect()
}

/// Re-scans the plugin folders on disk without restarting the launcher.
pub fn reload(state: &AppState) -> Vec<PluginEntry> {
    let (dirs, bridge) = {
        let reg = state.plugins.read().unwrap();
        (reg.dirs.clone(), reg.bridge.clone())
    };
    *state.plugins.write().unwrap() = Registry::load(&dirs, bridge);
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
    let mut off = storage::load_disabled_plugins(state);
    if off.iter().any(|d| d == id) {
        off.retain(|d| d != id);
        let _ = storage::save_disabled_plugins(state, &off);
    }
    Ok(reload(state))
}

/// An enabled plugin by id.
pub fn enabled(state: &AppState, id: &str) -> Result<Arc<Plugin>> {
    let found = get(state, id)?;
    if storage::load_disabled_plugins(state).iter().any(|d| d == id) {
        return Err(AppError::Unsupported(format!("{} is turned off", found.manifest.name)));
    }
    Ok(found)
}

/// Every plugin the user has not turned off, in load order.
pub fn all_enabled(state: &AppState) -> Vec<Arc<Plugin>> {
    let off = storage::load_disabled_plugins(state);
    state.plugins.read().unwrap().plugins.iter().filter(|p| !off.contains(&p.manifest.id)).cloned().collect()
}

pub fn set_enabled(state: &AppState, id: &str, enabled: bool) -> Result<()> {
    get(state, id)?;
    let mut off = storage::load_disabled_plugins(state);
    off.retain(|d| d != id);
    if !enabled {
        off.push(id.into());
    }
    storage::save_disabled_plugins(state, &off)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        *state.plugins.write().unwrap() = Registry::load(&[(dir.clone(), true), (dir, false)], bridge);
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
        set_enabled(&state, "good", true).unwrap();
        assert!(enabled(&state, "good").is_ok());
        assert!(set_enabled(&state, "nope", true).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
