//! What a plugin registered in its frame (`tn.sources.register` and the like), as typed Rust handles.
//! Everything a plugin returns is untrusted data: the services that use it still check paths and download hosts.
use super::api::*;
use super::bridge::Bridge;
use crate::error::{AppError, Result};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

/// One object a plugin registered: `target` is its kind (`source`, `account`, `importer`, `runtime`).
pub struct Remote {
    plugin: String,
    target: &'static str,
    bridge: Arc<Bridge>,
}

impl Remote {
    pub fn new(plugin: &str, target: &'static str, bridge: Arc<Bridge>) -> Self {
        Self { plugin: plugin.into(), target, bridge }
    }

    async fn call<O: DeserializeOwned>(&self, method: &'static str, args: Vec<Value>) -> Result<O> {
        let v = self.bridge.call(&self.plugin, self.target, method, args).await?;
        serde_json::from_value(v).map_err(|e| AppError::Plugin(format!("{}.{method} returned bad data: {e}", self.plugin)))
    }
}

fn arg(v: impl Serialize) -> Value {
    serde_json::to_value(v).expect("plain data serializes")
}

/// A catalog of projects to search and install from (Modrinth, CurseForge...).
pub struct Source(pub Remote);

impl Source {
    pub async fn search(&self, q: &SearchQuery) -> Result<Page> {
        self.0.call("search", vec![arg(q)]).await
    }
    pub async fn project(&self, id: &str) -> Result<Project> {
        self.0.call("project", vec![arg(id)]).await
    }
    /// Any number of ids, in any order.
    pub async fn projects(&self, ids: &[String]) -> Result<Vec<ProjectSummary>> {
        self.0.call("projects", vec![arg(ids)]).await
    }
    /// Newest first.
    pub async fn versions(&self, project: &str, f: &VersionFilter) -> Result<Vec<Version>> {
        self.0.call("versions", vec![arg(project), arg(f)]).await
    }
    /// Keyed by the given hash (the source's `hash` kind); unknown files are missing from the map.
    pub async fn identify(&self, hashes: &[String]) -> Result<HashMap<String, Identified>> {
        self.0.call("identify", vec![arg(hashes)]).await
    }
    /// `root` holds the archive's top-level text files (its manifest), by name.
    pub async fn plan_pack(&self, root: &HashMap<String, String>) -> Result<PackPlan> {
        self.0.call("planPack", vec![arg(root)]).await
    }
}

/// A modpack format reader. Its plan is untrusted like a source's.
pub struct Importer(pub Remote);

impl Importer {
    /// `root`: the archive's text files at the top and one folder down, by path. Throws for formats it does not read.
    pub async fn plan(&self, root: &HashMap<String, String>) -> Result<PackPlan> {
        self.0.call("plan", vec![arg(root)]).await
    }
}

/// An account provider. Its answers are untrusted: see `services::account`.
pub struct Account(pub Remote);

impl Account {
    /// `fields` are the sign-in form's values by key.
    pub async fn login(&self, fields: Value) -> Result<Login> {
        self.0.call("login", vec![fields]).await
    }
    /// `account` is `{ name, uuid, data }` as stored.
    pub async fn session(&self, account: Value) -> Result<PluginSession> {
        self.0.call("session", vec![account]).await
    }
    /// Optional: the account's skin, or null.
    pub async fn skin(&self, account: Value) -> Result<Option<Skin>> {
        self.0.call("skin", vec![account]).await
    }
}

/// A game that runs instead of Java Minecraft. It only describes files and command lines;
/// `services::runtime` checks, downloads and runs them.
pub struct Runtime(pub Remote);

impl Runtime {
    /// Builds to offer, newest first.
    pub async fn versions(&self) -> Result<Vec<RuntimeVersion>> {
        self.0.call("versions", vec![]).await
    }
    /// `ctx`: `{ version, os, arch }`.
    pub async fn install(&self, ctx: Value) -> Result<RuntimeInstall> {
        self.0.call("install", vec![ctx]).await
    }
    /// `ctx`: `{ version, os, arch, width, height, fullscreen, world }`.
    pub async fn launch(&self, ctx: Value) -> Result<RuntimeLaunch> {
        self.0.call("launch", vec![ctx]).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn round_trips_and_reports_errors() {
        // A frontend that answers synchronously: `search` gets an empty page, anything else fails.
        let bridge: Arc<Bridge> = Arc::new_cyclic(|weak: &std::sync::Weak<Bridge>| {
            let weak = weak.clone();
            Bridge::new(move |c| {
                let answer = match c.method {
                    "search" => Ok(serde_json::json!({ "hits": [], "offset": 0, "total": 0 })),
                    _ => Err("boom".to_string()),
                };
                weak.upgrade().unwrap().reply(c.id, answer);
            })
        });
        bridge.listening();
        let src = Source(Remote::new("p", "source", bridge));
        let q: SearchQuery = serde_json::from_value(serde_json::json!({ "kind": "mod", "limit": 5 })).unwrap();
        assert_eq!(src.search(&q).await.unwrap().total, 0);
        let err = src.project("x").await.unwrap_err().to_string();
        assert!(err.contains("p.project: boom"), "{err}");
    }
}
