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
pub async fn request(state: &AppState, plugin: &str, method: &str, params: Value) -> Result<Value> {
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
