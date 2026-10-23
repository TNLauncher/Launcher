//! Content sources implemented by JS plugins. A plugin runs in a sandboxed iframe of the main window,
//! so a call goes out as a `plugin-call` event, the frontend forwards it to the plugin's frame, and
//! the answer comes back through the `plugin_reply` command. Everything the plugin returns is
//! untrusted data: the services that use it still check paths and download hosts.
use super::api::*;
use crate::error::{AppError, Result};
use futures::future::BoxFuture;
use futures::FutureExt;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::oneshot;

/// A plugin that does not answer by then is treated as failed.
const TIMEOUT: Duration = Duration::from_secs(60);

/// Payload of the `plugin-call` event.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Call {
    pub id: u64,
    pub plugin: String,
    /// What the plugin registered: `source` or `account`.
    pub target: &'static str,
    pub method: &'static str,
    /// Positional arguments of the plugin function.
    pub args: Vec<Value>,
}

type Reply = std::result::Result<Value, String>;

/// Calls in flight to plugin frames.
pub struct Bridge {
    emit: Box<dyn Fn(Call) + Send + Sync>,
    next: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    /// Calls made before the frontend listens; `None` once it does.
    early: Mutex<Option<Vec<Call>>>,
}

impl Bridge {
    /// `emit` delivers a call to the frontend; tests answer it directly.
    pub fn new(emit: impl Fn(Call) + Send + Sync + 'static) -> Self {
        Self { emit: Box::new(emit), next: AtomicU64::new(1), pending: Mutex::new(HashMap::new()), early: Mutex::new(Some(vec![])) }
    }

    /// The frontend listens for `plugin-call` now: deliver what waited.
    pub fn listening(&self) {
        let early = self.early.lock().unwrap().take().unwrap_or_default();
        early.into_iter().for_each(|c| (self.emit)(c));
    }

    fn send(&self, call: Call) {
        let mut early = self.early.lock().unwrap();
        match early.as_mut() {
            Some(queue) => queue.push(call),
            None => {
                drop(early);
                (self.emit)(call);
            }
        }
    }

    pub async fn call(&self, plugin: &str, target: &'static str, method: &'static str, args: Vec<Value>) -> Result<Value> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        self.send(Call { id, plugin: plugin.into(), target, method, args });
        let answer = tokio::time::timeout(TIMEOUT, rx).await;
        self.pending.lock().unwrap().remove(&id);
        match answer {
            Ok(Ok(Ok(v))) => Ok(v),
            Ok(Ok(Err(e))) => Err(AppError::Plugin(format!("{plugin}.{method}: {e}"))),
            Ok(Err(_)) => Err(AppError::Plugin(format!("{plugin}.{method}: no answer"))),
            Err(_) => Err(AppError::Plugin(format!("{plugin}.{method} did not answer in {}s", TIMEOUT.as_secs()))),
        }
    }

    /// Answer from the frontend; unknown ids (timed out) are dropped.
    pub fn reply(&self, id: u64, answer: Reply) {
        if let Some(tx) = self.pending.lock().unwrap().remove(&id) {
            let _ = tx.send(answer);
        }
    }
}

pub struct JsSource {
    pub plugin: String,
    pub bridge: Arc<Bridge>,
}

impl JsSource {
    fn call<O: DeserializeOwned>(&self, method: &'static str, args: Vec<Value>) -> BoxFuture<'_, Result<O>> {
        async move {
            let v = self.bridge.call(&self.plugin, "source", method, args).await?;
            serde_json::from_value(v).map_err(|e| AppError::Plugin(format!("{}.{method} returned bad data: {e}", self.plugin)))
        }
        .boxed()
    }
}

fn arg(v: impl Serialize) -> Value {
    serde_json::to_value(v).expect("plain data serializes")
}

impl ContentSource for JsSource {
    fn search<'a>(&'a self, q: &'a SearchQuery) -> BoxFuture<'a, Result<Page>> {
        self.call("search", vec![arg(q)])
    }
    fn project<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<Project>> {
        self.call("project", vec![arg(id)])
    }
    fn projects<'a>(&'a self, ids: &'a [String]) -> BoxFuture<'a, Result<Vec<ProjectSummary>>> {
        self.call("projects", vec![arg(ids)])
    }
    fn versions<'a>(&'a self, project: &'a str, f: &'a VersionFilter) -> BoxFuture<'a, Result<Vec<Version>>> {
        self.call("versions", vec![arg(project), arg(f)])
    }
    fn identify<'a>(&'a self, sha1: &'a [String]) -> BoxFuture<'a, Result<HashMap<String, Identified>>> {
        self.call("identify", vec![arg(sha1)])
    }
    fn plan_pack<'a>(&'a self, root: &'a HashMap<String, String>) -> BoxFuture<'a, Result<PackPlan>> {
        self.call("planPack", vec![arg(root)])
    }
}

/// An account provider plugin (`tn.accounts.register`). Its answers are untrusted: see `services::account`.
pub struct JsAccount {
    pub plugin: String,
    pub bridge: Arc<Bridge>,
}

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

impl JsAccount {
    async fn call<O: DeserializeOwned>(&self, method: &'static str, args: Vec<Value>) -> Result<O> {
        let v = self.bridge.call(&self.plugin, "account", method, args).await?;
        serde_json::from_value(v).map_err(|e| AppError::Plugin(format!("{}.{method} returned bad data: {e}", self.plugin)))
    }

    /// `fields` are the sign-in form's values by key.
    pub async fn login(&self, fields: Value) -> Result<Login> {
        self.call("login", vec![fields]).await
    }

    /// `account` is `{ name, uuid, data }` as stored.
    pub async fn session(&self, account: Value) -> Result<PluginSession> {
        self.call("session", vec![account]).await
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
        let src = JsSource { plugin: "p".into(), bridge };
        let q: SearchQuery = serde_json::from_value(serde_json::json!({ "kind": "mod", "limit": 5 })).unwrap();
        assert_eq!(src.search(&q).await.unwrap().total, 0);
        let err = src.project("x").await.unwrap_err().to_string();
        assert!(err.contains("p.project: boom"), "{err}");
    }
}
