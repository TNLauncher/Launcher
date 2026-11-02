//! `manifest.json`: what a plugin declares it adds and what it may touch. Mirrored in packages/plugin-api/index.d.ts.
use super::api::{Choice, ProjectKind};
use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

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
    /// Makes the plugin a game runtime: a game that runs instead of Java Minecraft (`tn.runtimes.register`). Needs `programs`.
    pub runtime: Option<RuntimeSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSpec {
    /// One line under the name in the new-instance dialog.
    #[serde(default)]
    pub hint: String,
    /// Material Symbols name.
    #[serde(default = "default_runtime_icon")]
    pub icon: String,
    /// Starts only for a Microsoft account (one that owns Minecraft: Java Edition).
    #[serde(default)]
    pub requires_microsoft: bool,
}

fn default_runtime_icon() -> String {
    "rocket_launch".into()
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
    /// Run programs the plugin downloads (game runtimes). Runs code on the computer.
    #[serde(default)]
    pub programs: bool,
}

/// Reads and checks a plugin folder's manifest.
pub(super) fn read(folder: &Path) -> Result<Manifest> {
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
    if m.contributes.runtime.is_some() && !m.permissions.programs {
        return Err(AppError::Plugin("A game runtime needs the programs permission".into()));
    }
    if !folder.join(&m.main).is_file() {
        return Err(AppError::Plugin(format!("{} is missing", m.main)));
    }
    Ok(m)
}
