//! The contract between the launcher and a content source (Modrinth, CurseForge...).
//! Sources are JS plugins (see `js`), so every type here crosses JSON both ways: keep it plain data.
//! Mirrored for plugin authors in packages/plugin-api/index.d.ts.
use crate::error::Result;
use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
}

/// A catalog of projects to search and install from. Methods return boxed futures so sources are object-safe.
pub trait ContentSource: Send + Sync {
    fn search<'a>(&'a self, q: &'a SearchQuery) -> BoxFuture<'a, Result<Page>>;
    fn project<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<Project>>;
    /// Any number of ids, in any order.
    fn projects<'a>(&'a self, ids: &'a [String]) -> BoxFuture<'a, Result<Vec<ProjectSummary>>>;
    /// Newest first.
    fn versions<'a>(&'a self, project: &'a str, f: &'a VersionFilter) -> BoxFuture<'a, Result<Vec<Version>>>;
    // ponytail: SHA-1 only, which is what Modrinth needs; CurseForge identifies by murmur2, add a hash kind to the manifest then.
    /// Keyed by the given SHA-1; unknown files are missing from the map.
    fn identify<'a>(&'a self, sha1: &'a [String]) -> BoxFuture<'a, Result<HashMap<String, Identified>>>;
    /// `root` holds the archive's top-level text files (its manifest), by name.
    fn plan_pack<'a>(&'a self, root: &'a HashMap<String, String>) -> BoxFuture<'a, Result<PackPlan>>;
}
