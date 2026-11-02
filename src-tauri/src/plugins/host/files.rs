//! A plugin's files over `plugin://localhost/<id>/<file>`, with the SDK and theme injected into its HTML
//! and a Content-Security-Policy built from its manifest.
use crate::error::{AppError, Result};
use crate::plugins::{Manifest, Plugin};
use crate::state::AppState;
use tauri::Manager;

/// The runtime every frame gets: `window.tn`.
const SDK: &str = include_str!("../sdk.js");
/// The launcher's look, so plugin pages can match it with plain HTML.
const THEME: [&str; 2] = [include_str!("../../../../src/styles/tokens.css"), include_str!("../../../../src/styles/base.css")];
/// As in index.html: text swaps in its font, icons stay hidden until theirs arrives (no ligature words).
const FONTS: [&str; 2] = [
    "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap",
    "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block",
];
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

fn find_head_end(html: &str) -> Option<usize> {
    let lower = html.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut pos = 0;
    while let Some(off) = lower[pos..].find("<head") {
        let start = pos + off;
        let after = bytes.get(start + 5).copied();
        if matches!(after, Some(b'>' | b' ' | b'\t' | b'\r' | b'\n')) {
            return Some(start + lower[start..].find('>')? + 1);
        }
        pos = start + 5;
    }
    None
}

/// Where the SDK and theme go in the plugin HTML at `rel`. The frame's origin is opaque, so every load
/// is cross-origin: WebKitGTK only serves CORS-mode requests from the custom scheme, hence `crossorigin`.
/// The color-scheme meta comes first: until the frame's scheme matches the launcher's (dark), its canvas
/// is painted opaque white, and the stylesheets that would set it wait on the network.
fn inject(html: &str, rel: &str) -> String {
    let up = "../".repeat(rel.matches('/').count());
    let [text, icons] = FONTS;
    let head = format!(
        r#"<meta name="color-scheme" content="dark"><script src="{up}__tn/sdk.js" crossorigin></script><link rel="stylesheet" href="{up}__tn/theme.css" crossorigin><link rel="stylesheet" href="{text}"><link rel="stylesheet" href="{icons}">"#
    );
    match find_head_end(html) {
        Some(i) => format!("{}{head}{}", &html[..i], &html[i..]),
        None => format!("{head}{html}"),
    }
}

/// `path` is `/<plugin id>/<file>`; `__tn/*` are the launcher's own files.
pub fn serve(state: &AppState, path: &str) -> Result<File> {
    let (id, rel) = path.trim_start_matches('/').split_once('/').ok_or_else(|| AppError::NotFound(path.into()))?;
    let plugin = crate::plugins::enabled(state, id)?;
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
    Ok(plugin.dir.join(crate::paths::safe_rel(rel)?))
}

/// Answers one `plugin://` request; `path` is the URI path, still percent-encoded.
pub fn protocol(app: tauri::AppHandle, path: &str, responder: tauri::UriSchemeResponder) {
    let path = percent_encoding::percent_decode_str(path).decode_utf8_lossy().into_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let res = match serve(&app.state::<AppState>(), &path) {
            Ok(f) => {
                // Plugin frames are sandboxed (opaque origin), so their module scripts load cross-origin.
                let mut b = tauri::http::Response::builder().header("Content-Type", f.mime).header("Access-Control-Allow-Origin", "*")
                    // Plugin files change on disk between runs; never serve a stale copy.
                    .header("Cache-Control", "no-store");
                if let Some(csp) = f.csp {
                    b = b.header("Content-Security-Policy", csp);
                }
                b.body(f.bytes)
            }
            Err(_) => tauri::http::Response::builder().status(404).body(Vec::new()),
        };
        responder.respond(res.expect("static response parts"));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn injects_sdk_into_head() {
        let out = inject("<!doctype html><HEAD lang=en><title>x</title></HEAD>", "ui/page.html");
        assert!(out.starts_with(r#"<!doctype html><HEAD lang=en><meta name="color-scheme" content="dark"><script src="../__tn/sdk.js" crossorigin>"#), "{out}");
        let with_header = inject("<header>top</header><head><title>x</title></head>", "page.html");
        assert!(with_header.starts_with(r#"<header>top</header><head><meta name="color-scheme" content="dark"><script src="__tn/sdk.js" crossorigin>"#), "{with_header}");
        assert!(inject("<p>hi</p>", "page.html").starts_with(r#"<meta name="color-scheme" content="dark"><script src="__tn/sdk.js" crossorigin>"#));
        assert!(inject("<p>hi</p>", "page.html").ends_with("<p>hi</p>"));
    }
}
