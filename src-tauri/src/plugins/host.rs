//! What a plugin frame can reach: its own files over `plugin://<id>/...`, and the requests it sends
//! through the bridge (`tn.*` in the SDK), each checked against its manifest.
use super::{Manifest, Plugin};
use crate::error::{AppError, Result};
use crate::state::AppState;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Component, Path};

/// The runtime every frame gets: `window.tn`.
const SDK: &str = include_str!("sdk.js");
/// The launcher's look, so plugin pages can match it with plain HTML.
const THEME: [&str; 2] = [include_str!("../../../src/styles/tokens.css"), include_str!("../../../src/styles/base.css")];
const FONTS: &str = "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500;600&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block";
/// Biggest response `tn.net.fetch` hands to a plugin.
const MAX_RESPONSE: usize = 32 * 1024 * 1024;
/// How the `plugin` scheme shows up per platform (custom scheme on Linux/macOS, http on Windows).
const SELF: &str = "plugin: http://plugin.localhost https://plugin.localhost";

pub struct File {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
    /// Set for HTML: the page's Content-Security-Policy.
    pub csp: Option<String>,
}

fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

/// No network but through the bridge (`connect-src 'none'`); images only from the plugin's hosts.
fn csp(m: &Manifest) -> String {
    let hosts: Vec<String> = m.permissions.hosts.iter().map(|h| format!("https://{h}")).collect();
    let hosts = hosts.join(" ");
    format!(
        "default-src 'none'; script-src {SELF} 'unsafe-inline'; style-src {SELF} 'unsafe-inline' https://fonts.googleapis.com; \
         font-src {SELF} https://fonts.gstatic.com data:; img-src {SELF} data: blob: {hosts}; media-src {SELF} {hosts}; \
         connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"
    )
}

/// Where the SDK and theme go in the plugin HTML at `rel`. The frame's origin is opaque, so every load
/// is cross-origin: WebKitGTK only serves CORS-mode requests from the custom scheme, hence `crossorigin`.
fn inject(html: &str, rel: &str) -> String {
    let up = "../".repeat(rel.matches('/').count());
    let head = format!(
        r#"<script src="{up}__tn/sdk.js" crossorigin></script><link rel="stylesheet" href="{FONTS}"><link rel="stylesheet" href="{up}__tn/theme.css" crossorigin>"#
    );
    // After `<head ...>`; ASCII lowercasing keeps byte offsets.
    let lower = html.to_ascii_lowercase();
    match lower.find("<head").and_then(|i| Some(i + lower[i..].find('>')? + 1)) {
        Some(i) => format!("{}{head}{}", &html[..i], &html[i..]),
        None => format!("{head}{html}"),
    }
}

/// `path` is `/<plugin id>/<file>`; `__tn/*` are the launcher's own files.
pub fn serve(state: &AppState, path: &str) -> Result<File> {
    let (id, rel) = path.trim_start_matches('/').split_once('/').ok_or_else(|| AppError::NotFound(path.into()))?;
    let plugin = super::enabled(state, id)?;
    let m = &plugin.manifest;
    let html = |text: String| File { bytes: text.into_bytes(), mime: "text/html; charset=utf-8", csp: Some(csp(m)) };
    let text = |text: String, mime| File { bytes: text.into_bytes(), mime, csp: None };
    Ok(match rel {
        "__tn/sdk.js" => text(SDK.into(), "text/javascript; charset=utf-8"),
        "__tn/theme.css" => text(THEME.join("\n") + "\nbody { overflow: auto; background: transparent; }\n", "text/css; charset=utf-8"),
        // The hidden frame that runs `main`.
        "__tn/background.html" => html(inject(r#"<!doctype html><html><head><script type="module" src="boot.js"></script></head></html>"#, rel)),
        "__tn/boot.js" => text(format!("import({}).then(tn.__activate, tn.__fail);", serde_json::to_string(&format!("../{}", m.main))?), "text/javascript; charset=utf-8"),
        _ => {
            let bytes = std::fs::read(plugin_file(&plugin, rel)?)?;
            match mime(rel) {
                m if m.starts_with("text/html") => html(inject(&String::from_utf8_lossy(&bytes), rel)),
                mime => File { bytes, mime, csp: None },
            }
        }
    })
}

fn plugin_file(plugin: &Plugin, rel: &str) -> Result<std::path::PathBuf> {
    let p = Path::new(rel);
    if rel.is_empty() || !p.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(AppError::Invalid(format!("Bad plugin path: {rel}")));
    }
    Ok(plugin.dir.join(p))
}

/// `host` matches an entry exactly or through a leading `*.`.
pub fn host_allowed(hosts: &[String], url: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(url) else { return false };
    let Some(host) = url.host_str() else { return false };
    url.scheme() == "https"
        && hosts.iter().any(|h| match h.strip_prefix("*.") {
            Some(base) => host.ends_with(&format!(".{base}")),
            None => host == h,
        })
}

/// Instances as plugins see them: plus `mods`, the number of enabled mod jars; minus launch settings (env may hold secrets).
fn with_mods(state: &AppState, list: Vec<crate::models::Instance>) -> Result<Value> {
    let counts = crate::services::instances::mod_counts(state, &list);
    let mut v = serde_json::to_value(&list)?;
    for i in v.as_array_mut().into_iter().flatten() {
        let n = i["id"].as_str().and_then(|id| counts.get(id)).copied().unwrap_or(0);
        i["mods"] = n.into();
        i.as_object_mut().map(|o| o.remove("settings"));
    }
    Ok(v)
}

fn str_param(params: &Value, name: &str) -> Result<String> {
    params.get(name).and_then(Value::as_str).map(String::from).ok_or_else(|| AppError::Invalid(format!("Missing {name}")))
}

fn key(params: &Value) -> Result<String> {
    let k = str_param(params, "key")?;
    if k.is_empty() || k.len() > 256 {
        return Err(AppError::Invalid("Bad storage key".into()));
    }
    Ok(k)
}

#[derive(Deserialize)]
struct FetchInit {
    url: String,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    body: Option<String>,
}

/// A request a plugin frame sent through the bridge. `plugin` is who the frontend saw send it.
pub async fn request(app: &tauri::AppHandle, state: &AppState, plugin: &str, method: &str, params: Value) -> Result<Value> {
    use tauri::Manager;
    let plugin = super::enabled(state, plugin)?;
    let m = &plugin.manifest;
    match method {
        "net.fetch" => {
            let init: FetchInit = serde_json::from_value(params)?;
            if !host_allowed(&m.permissions.hosts, &init.url) {
                return Err(AppError::Plugin(format!("{} may not connect to {}", m.name, init.url)));
            }
            let method = reqwest::Method::from_bytes(init.method.as_deref().unwrap_or("GET").as_bytes()).map_err(|e| AppError::Invalid(e.to_string()))?;
            let mut req = state.http.request(method, &init.url);
            for (k, v) in &init.headers {
                req = req.header(k, v);
            }
            if let Some(body) = init.body {
                req = req.body(body);
            }
            let res = req.send().await?;
            let status = res.status().as_u16();
            let content_type = res.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
            let bytes = res.bytes().await?;
            if bytes.len() > MAX_RESPONSE {
                return Err(AppError::Plugin(format!("Response from {} is too big", init.url)));
            }
            Ok(json!({ "status": status, "contentType": content_type, "body": String::from_utf8_lossy(&bytes) }))
        }
        "storage.get" => Ok(super::data::storage_get(state, &plugin, &key(&params)?)),
        "storage.set" => {
            super::data::storage_set(state, &plugin, &key(&params)?, params.get("value").cloned().unwrap_or(Value::Null))?;
            Ok(Value::Null)
        }
        "settings.get" => Ok(Value::Object(super::data::settings(state, &plugin))),
        "instances.list" | "instances.get" if !m.permissions.instances => Err(AppError::Plugin(format!("{} may not read instances", m.name))),
        "instances.list" => with_mods(state, crate::services::instances::list(state)),
        "instances.get" => {
            let one = vec![crate::services::instances::get(state, &str_param(&params, "id")?)?];
            Ok(with_mods(state, one)?.as_array_mut().and_then(|a| a.pop()).unwrap_or(Value::Null))
        }
        "presence.set" | "presence.clear" if !m.permissions.presence => Err(AppError::Plugin(format!("{} may not set the Discord status", m.name))),
        "presence.set" => {
            let p: crate::services::discord::Presence = serde_json::from_value(params)?;
            if !p.valid() {
                return Err(AppError::Invalid("Discord status lines must be 2–128 characters".into()));
            }
            app.state::<crate::services::discord::Discord>().set(Some(p));
            Ok(Value::Null)
        }
        "presence.clear" => {
            app.state::<crate::services::discord::Discord>().set(None);
            Ok(Value::Null)
        }
        // A link the user follows: web pages only, opened in the system browser.
        "open" => {
            let url = str_param(&params, "url")?;
            if !(url.starts_with("https://") || url.starts_with("http://")) {
                return Err(AppError::Plugin(format!("{} may only open web links", m.name)));
            }
            tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| AppError::Unsupported(e.to_string()))?;
            Ok(Value::Null)
        }
        "log" => {
            eprintln!("[plugin {}] {}", m.id, params.as_str().unwrap_or(&params.to_string()));
            Ok(Value::Null)
        }
        _ => Err(AppError::Plugin(format!("Unknown request {method}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_hosts() {
        let hosts = vec!["api.modrinth.com".to_string(), "*.example.com".to_string()];
        assert!(host_allowed(&hosts, "https://api.modrinth.com/v2/search"));
        assert!(host_allowed(&hosts, "https://a.b.example.com/x"));
        assert!(!host_allowed(&hosts, "https://example.com/x"));
        assert!(!host_allowed(&hosts, "http://api.modrinth.com/v2"));
        assert!(!host_allowed(&hosts, "https://api.modrinth.com.evil.io/"));
        assert!(!host_allowed(&hosts, "https://evil.io/?api.modrinth.com"));
    }

    #[test]
    fn injects_sdk_into_head() {
        let out = inject("<!doctype html><HEAD lang=en><title>x</title></HEAD>", "ui/page.html");
        assert!(out.starts_with(r#"<!doctype html><HEAD lang=en><script src="../__tn/sdk.js" crossorigin>"#), "{out}");
        assert!(inject("<p>hi</p>", "page.html").starts_with(r#"<script src="__tn/sdk.js" crossorigin>"#));
        assert!(inject("<p>hi</p>", "page.html").ends_with("<p>hi</p>"));
    }
}
