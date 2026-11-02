//! `tn.net.fetch`: HTTP from Rust, so a frame never needs network access of its own. Only the manifest's hosts.
use super::{params, Cx};
use crate::error::{AppError, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

/// Biggest response `tn.net.fetch` hands to a plugin.
const MAX_RESPONSE: usize = 32 * 1024 * 1024;

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

pub async fn handle(cx: &Cx<'_>, method: &str, p: Value) -> Result<Value> {
    match method {
        "net.fetch" => fetch(cx, params(p)?).await,
        _ => super::unknown(method),
    }
}

async fn fetch(cx: &Cx<'_>, init: FetchInit) -> Result<Value> {
    let m = &cx.plugin.manifest;
    if !host_allowed(&m.permissions.hosts, &init.url) {
        return Err(AppError::Plugin(format!("{} may not connect to {}", m.name, init.url)));
    }
    let method = reqwest::Method::from_bytes(init.method.as_deref().unwrap_or("GET").as_bytes()).map_err(|e| AppError::Invalid(e.to_string()))?;
    let mut req = cx.state.http.request(method, &init.url);
    for (k, v) in &init.headers {
        req = req.header(k, v);
    }
    if let Some(body) = init.body {
        req = req.body(body);
    }
    let res = req.send().await?;
    let status = res.status().as_u16();
    let headers: HashMap<String, String> = res
        .headers()
        .iter()
        .filter_map(|(k, v)| Some((k.as_str().to_ascii_lowercase(), v.to_str().ok()?.to_string())))
        .collect();
    let content_type = headers.get("content-type").cloned().unwrap_or_default();
    let bytes = res.bytes().await?;
    if bytes.len() > MAX_RESPONSE {
        return Err(AppError::Plugin(format!("Response from {} is too big", init.url)));
    }
    use base64::{engine::general_purpose::STANDARD, Engine};
    Ok(json!({
        "status": status,
        "contentType": content_type,
        "headers": headers,
        "body": String::from_utf8_lossy(&bytes),
        "bodyBase64": STANDARD.encode(&bytes),
    }))
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
}
