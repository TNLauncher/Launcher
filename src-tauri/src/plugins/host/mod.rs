//! What a plugin frame can reach: its own files over `plugin://<id>/...` (`files`), and the requests it sends
//! through the bridge (`tn.*` in the SDK). Every request goes through [`request`], which finds the plugin that
//! sent it, checks the method against the manifest's permissions with [`need`], and hands it to the module of
//! its namespace (`net`, `storage`, `instances`, `content`, `sources`, `presence`).
//!
//! Adding a `tn.*` method:
//! 1. give it a [`Need`] in [`need`] (methods it does not list are open to every plugin);
//! 2. handle it in its namespace module, parsing params into a `#[derive(Deserialize)]` struct with [`params`];
//! 3. expose it in `plugins/sdk.js` and type it in packages/plugin-api/index.d.ts.
mod content;
mod files;
mod instances;
mod net;
mod presence;
mod sources;
mod storage;

pub use files::protocol;
pub use net::host_allowed;

use super::{Manifest, Plugin};
use crate::error::{AppError, Result};
use crate::state::AppState;
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::Value;
use std::sync::Arc;
use tauri::Emitter;

/// Who is asking, and what for: handed to every namespace handler.
pub(crate) struct Cx<'a> {
    pub app: &'a tauri::AppHandle,
    pub state: &'a AppState,
    pub plugin: Arc<Plugin>,
}

/// What a method needs from the manifest's `permissions`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Need {
    Any,
    /// `instances`: read instances.
    Instances,
    /// `instances` and `content`: change an instance. The UI reloads it after one succeeds.
    Content,
    /// `presence`: set the Discord status.
    Presence,
}

fn need(method: &str) -> Need {
    match method {
        "instances.list" | "instances.get" | "instances.readLog" | "instances.crashReports" | "instances.mods" | "instances.missingFiles"
        | "instances.launchSettings" | "instances.export" | "content.hashes" | "content.identify" => Need::Instances,
        "instances.repair" | "instances.restoreFiles" | "instances.change" | "content.install" | "content.setEnabled" | "content.delete" => Need::Content,
        "presence.set" | "presence.clear" => Need::Presence,
        _ => Need::Any,
    }
}

fn check(m: &Manifest, need: Need) -> Result<()> {
    let p = &m.permissions;
    let denied = match need {
        Need::Instances if !p.instances => Some("read instances"),
        Need::Content if !(p.instances && p.content) => Some("change instances"),
        Need::Presence if !p.presence => Some("set the Discord status"),
        _ => None,
    };
    denied.map_or(Ok(()), |what| Err(AppError::Plugin(format!("{} may not {what}", m.name))))
}

/// A request a plugin frame sent through the bridge. `plugin` is who the frontend saw send it.
pub async fn request(app: &tauri::AppHandle, state: &AppState, plugin: &str, method: &str, params: Value) -> Result<Value> {
    let plugin = super::enabled(state, plugin)?;
    let need = need(method);
    check(&plugin.manifest, need)?;
    let instance = params.get("instance").or_else(|| params.get("id")).and_then(Value::as_str).map(String::from);
    let cx = Cx { app, state, plugin };
    let out = match method.split_once('.').map_or(method, |(ns, _)| ns) {
        "net" => net::handle(&cx, method, params).await,
        "storage" | "settings" => storage::handle(&cx, method, params),
        "instances" => instances::handle(&cx, method, params).await,
        "content" => content::handle(&cx, method, params).await,
        "sources" => sources::handle(&cx, method, params).await,
        "presence" => presence::handle(&cx, method, params),
        "open" => open(&cx, params),
        "log" => {
            eprintln!("[plugin {}] {}", cx.plugin.manifest.id, params.as_str().unwrap_or(&params.to_string()));
            Ok(Value::Null)
        }
        _ => unknown(method),
    };
    if let (Ok(_), Need::Content, Some(id)) = (&out, need, instance) {
        let _ = app.emit(crate::events::INSTANCE_CHANGED, id);
    }
    out
}

/// A link the user follows: web pages only, opened in the system browser.
fn open(cx: &Cx<'_>, p: Value) -> Result<Value> {
    #[derive(Deserialize)]
    struct Open {
        url: String,
    }
    let url = params::<Open>(p)?.url;
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::Plugin(format!("{} may only open web links", cx.plugin.manifest.name)));
    }
    tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| AppError::Unsupported(e.to_string()))?;
    Ok(Value::Null)
}

/// `{ id }`: the params of most `tn.instances` methods.
#[derive(Deserialize)]
struct Id {
    id: String,
}

/// A request's params as `T`; plugin input is untrusted, so a mismatch is the plugin's error, not ours.
fn params<T: DeserializeOwned>(v: Value) -> Result<T> {
    serde_json::from_value(v).map_err(|e| AppError::Invalid(format!("Bad request: {e}")))
}

fn unknown(method: &str) -> Result<Value> {
    Err(AppError::Plugin(format!("Unknown request {method}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permissions_gate_methods() {
        let manifest = |perms: Value| -> Manifest {
            serde_json::from_value(serde_json::json!({ "id": "p", "name": "P", "version": "1", "api": 1, "permissions": perms })).unwrap()
        };
        let none = manifest(serde_json::json!({}));
        let reader = manifest(serde_json::json!({ "instances": true }));
        let writer = manifest(serde_json::json!({ "instances": true, "content": true }));
        let content_only = manifest(serde_json::json!({ "content": true }));

        assert!(check(&none, need("storage.get")).is_ok());
        assert!(check(&none, need("sources.search")).is_ok());
        assert!(check(&none, need("instances.list")).is_err());
        assert!(check(&reader, need("instances.list")).is_ok());
        assert!(check(&reader, need("content.identify")).is_ok());
        assert!(check(&reader, need("content.install")).is_err());
        assert!(check(&content_only, need("content.install")).is_err());
        assert!(check(&writer, need("instances.repair")).is_ok());
        assert!(check(&writer, need("presence.set")).is_err());
        assert!(check(&none, need("instances.repair")).unwrap_err().to_string().contains("P may not change instances"));
    }
}
