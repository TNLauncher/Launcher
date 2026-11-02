//! The data a plugin and the launcher exchange: what content sources, account providers, importers and game
//! runtimes return (see `remote`). Every type here crosses JSON both ways: keep it plain data.
//! Mirrored for plugin authors in packages/plugin-api/index.d.ts.
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// What a project is; content kinds share `ContentKind`'s names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectKind {
    Mod,
    Resourcepack,
    Shader,
    Modpack,
}

impl From<crate::models::ContentKind> for ProjectKind {
    fn from(k: crate::models::ContentKind) -> Self {
        use crate::models::ContentKind as C;
        match k {
            C::Mod => Self::Mod,
            C::Resourcepack => Self::Resourcepack,
            C::Shader => Self::Shader,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Choice {
    pub id: String,
    pub label: String,
}

impl Choice {
    pub fn new(id: &str, label: &str) -> Self {
        Self { id: id.into(), label: label.into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub kind: ProjectKind,
    #[serde(default)]
    pub query: String,
    pub game_version: Option<String>,
    /// For content: the instance's loader. For modpacks: a filter, `None` = any the launcher runs.
    pub loader: Option<String>,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub sort: String,
    #[serde(default)]
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub author: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub downloads: u64,
    pub follows: u64,
    pub categories: Vec<String>,
    /// Supported Minecraft versions, oldest first.
    pub game_versions: Vec<String>,
    /// ISO date.
    pub updated: String,
    pub banner_url: Option<String>,
    /// 0xRRGGBB.
    pub color: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub hits: Vec<Hit>,
    pub offset: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub label: String,
    /// Material icon name.
    pub icon: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Image {
    pub url: String,
    pub raw_url: String,
    pub featured: bool,
    pub title: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub title: String,
    pub description: String,
    /// Markdown; HTML inside it is allowed and sanitized by the UI.
    pub body: String,
    pub icon_url: Option<String>,
    pub color: Option<u32>,
    pub published: String,
    pub license: Option<String>,
    /// The project's page on the source first.
    pub links: Vec<Link>,
    pub gallery: Vec<Image>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub kind: String,
    pub url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Release,
    Beta,
    Alpha,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionFile {
    pub url: String,
    pub filename: String,
    pub primary: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DependencyKind {
    Required,
    Optional,
    Incompatible,
    Embedded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
    pub project_id: Option<String>,
    /// Set for files not hosted on the source.
    pub file_name: Option<String>,
    pub kind: DependencyKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub id: String,
    pub name: String,
    pub number: String,
    pub channel: Channel,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub published: String,
    pub changelog: Option<String>,
    pub files: Vec<VersionFile>,
    pub dependencies: Vec<Dependency>,
}

impl Version {
    pub fn primary_file(&self) -> Option<&VersionFile> {
        self.files.iter().find(|f| f.primary).or(self.files.first())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionFilter {
    pub kind: ProjectKind,
    pub game_version: Option<String>,
    pub loader: Option<String>,
}

/// A local file the source recognised by its hash.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identified {
    pub project_id: String,
    pub version_number: String,
}

/// What a modpack archive asks for. The launcher downloads and unpacks it; the source only describes it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackPlan {
    pub name: String,
    pub game_version: String,
    /// `fabric`, `quilt`, or empty for vanilla.
    pub loader: String,
    pub loader_version: String,
    pub files: Vec<PackFile>,
    /// Archive folders copied over the instance, later ones win.
    pub overrides: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackFile {
    /// Relative to the instance; checked by the launcher.
    pub path: String,
    /// Mirrors; the first one on an allowed host is used.
    pub urls: Vec<String>,
    pub size: Option<u64>,
    /// With no `urls`: the page where the user downloads it by hand (its author does not allow launchers).
    #[serde(default)]
    pub page: Option<String>,
    /// Hex SHA-1, when the pack lists one: downloads are checked against it and repairs rehash with it.
    #[serde(default)]
    pub sha1: Option<String>,
}

// Account providers (`tn.accounts.register`).

/// What `login` returns: who signed in, and whatever the plugin keeps to start sessions later.
#[derive(Debug, Deserialize)]
pub struct Login {
    pub name: String,
    pub uuid: String,
    #[serde(default)]
    pub data: Value,
}

/// What `session` returns before each launch.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSession {
    pub name: String,
    pub uuid: String,
    pub token: String,
    /// `mojang` (Yggdrasil) or `legacy`.
    pub user_type: String,
    /// Replaces the stored `data`, e.g. after a token refresh.
    #[serde(default)]
    pub data: Value,
    pub java_agent: Option<JavaAgent>,
}

/// A jar the launcher downloads (from the plugin's download hosts) and loads with `-javaagent:<jar>=<options>`.
#[derive(Debug, Deserialize)]
pub struct JavaAgent {
    pub url: String,
    pub filename: String,
    #[serde(default)]
    pub options: String,
}

/// A skin texture: what `skin` returns, and what the UI renders.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Skin {
    pub url: String,
    /// Alex model: 3px arms.
    #[serde(default)]
    pub slim: bool,
}

// Game runtimes (`tn.runtimes.register`).

/// A build a runtime offers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeVersion {
    /// Becomes a folder name: no slashes, no leading dot.
    pub id: String,
    /// The Minecraft version whose files the build needs.
    pub minecraft: String,
    #[serde(default)]
    pub stable: bool,
}

/// What `install` returns: the files of one build, put in its folder once.
#[derive(Debug, Deserialize)]
pub struct RuntimeInstall {
    pub files: Vec<RuntimeFile>,
}

/// A file from the plugin's download hosts, checked against `sha256`; `extract` unpacks a `.zip` or `.tar.gz` and drops it.
#[derive(Debug, Deserialize)]
pub struct RuntimeFile {
    pub url: String,
    pub filename: String,
    pub sha256: String,
    #[serde(default)]
    pub extract: bool,
}

/// What `launch` returns before each start. Arguments may hold `${...}` placeholders (see `services::runtime`).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLaunch {
    /// Download the Minecraft server jar too (`${mc.serverJar}`).
    #[serde(default)]
    pub server_jar: bool,
    /// Run in order before the game, e.g. building its resources from Minecraft's files.
    #[serde(default)]
    pub steps: Vec<RuntimeStep>,
    pub game: RuntimeProgram,
}

#[derive(Debug, Deserialize)]
pub struct RuntimeStep {
    /// Shown while it runs.
    pub title: String,
    /// Relative to the build's folder.
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Arguments of a quick run of `program`: exit code 0 skips the step.
    pub check: Option<Vec<String>>,
    /// Stdout is JSON lines: `{"fraction"}`, `{"message"}`, `{"error"}`.
    #[serde(default)]
    pub progress: Option<ProgressFormat>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProgressFormat {
    Json,
}

#[derive(Debug, Deserialize)]
pub struct RuntimeProgram {
    /// Relative to the build's folder.
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// How the game gets the account: `stdin` writes `{name, uuid, access_token, user_type}` and closes it.
    pub session: Option<SessionPass>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionPass {
    Stdin,
}
