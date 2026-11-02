//! The plugin store: `index.json` (built by TNLauncher/Plugins) lists plugin zips to install into the user plugin folder.
//! The index is untrusted beyond its host: a zip is only fetched from next to the index, must match its SHA-256,
//! and its own manifest must be the one the index promised.
use super::manifest::{self, Manifest, API_VERSION};
use super::PluginEntry;
use crate::config::PLUGIN_INDEX_URL;
use crate::error::{AppError, Result};
use crate::minecraft::http;
use crate::paths::safe_file;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::Path;

/// One plugin the store offers. Mirrored in src/api/sources.ts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreEntry {
    pub manifest: Manifest,
    pub url: String,
    pub sha256: String,
    pub size: u64,
}

/// Plugins in the store this launcher can run; entries it can't read (a newer index format) are left out.
pub async fn index(state: &AppState) -> Result<Vec<StoreEntry>> {
    let v = http::get_json(&state.http, PLUGIN_INDEX_URL).await?;
    let Some(Value::Array(list)) = v.get("plugins").cloned() else {
        return Err(AppError::Plugin("The plugin store's index has no plugin list".into()));
    };
    Ok(list.into_iter().filter_map(|e| serde_json::from_value::<StoreEntry>(e).ok()).filter(|e| e.manifest.api == API_VERSION).collect())
}

/// Installs or updates `id` from the store and reloads plugins. The plugin's stored data and settings are kept.
pub async fn install(state: &AppState, id: &str) -> Result<Vec<PluginEntry>> {
    safe_file(id)?;
    let entry = index(state).await?.into_iter().find(|e| e.manifest.id == id).ok_or_else(|| AppError::NotFound(format!("The store has no plugin {id}")))?;
    let existing = super::get(state, id).ok();
    if let Some(p) = existing.as_ref().filter(|p| p.bundled) {
        return Err(AppError::Invalid(format!("{} is built-in", p.manifest.name)));
    }
    let base = &PLUGIN_INDEX_URL[..PLUGIN_INDEX_URL.rfind('/').map_or(0, |i| i + 1)];
    if !entry.url.starts_with(base) {
        return Err(AppError::Invalid(format!("{} is not an allowed download", entry.url)));
    }
    let bytes = http::fetch_bytes(&state.http, &entry.url).await?;
    let staging = state.paths.root.join("cache").join("plugin-install").join(id);
    let st = staging.clone();
    tokio::task::spawn_blocking(move || unpack(&bytes, &entry, &st)).await.map_err(|e| AppError::Unsupported(e.to_string()))??;
    // A plugin the user dropped in by hand may sit in a folder of another name; replace that one.
    let dest = existing.map_or_else(|| state.paths.plugins_dir().join(id), |p| p.dir.clone());
    if dest.exists() {
        std::fs::remove_dir_all(&dest)?;
    }
    std::fs::create_dir_all(state.paths.plugins_dir())?;
    std::fs::rename(&staging, &dest)?;
    Ok(super::reload(state))
}

/// Checks the zip against its entry and unpacks it into a fresh `dir`.
fn unpack(bytes: &[u8], entry: &StoreEntry, dir: &Path) -> Result<()> {
    if !http::hex(&Sha256::digest(bytes)).eq_ignore_ascii_case(&entry.sha256) {
        return Err(AppError::Invalid(format!("{} does not match its checksum", entry.url)));
    }
    if dir.exists() {
        std::fs::remove_dir_all(dir)?;
    }
    std::fs::create_dir_all(dir)?;
    // The zip crate refuses entries that point outside `dir`.
    zip::ZipArchive::new(std::io::Cursor::new(bytes))?.extract(dir)?;
    let m = manifest::read(dir)?;
    if m.id != entry.manifest.id || m.version != entry.manifest.version {
        return Err(AppError::Plugin(format!("The download is {} {}, the store promised {} {}", m.id, m.version, entry.manifest.id, entry.manifest.version)));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn zip(manifest: &Value) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        w.start_file("manifest.json", opts).unwrap();
        w.write_all(manifest.to_string().as_bytes()).unwrap();
        w.start_file("main.js", opts).unwrap();
        w.write_all(b"export function activate() {}").unwrap();
        w.finish().unwrap().into_inner()
    }

    fn entry(id: &str, bytes: &[u8]) -> StoreEntry {
        let manifest = serde_json::from_value(serde_json::json!({ "id": id, "name": id, "version": "1.0.0", "api": API_VERSION })).unwrap();
        StoreEntry { manifest, url: "u".into(), sha256: http::hex(&Sha256::digest(bytes)), size: bytes.len() as u64 }
    }

    #[test]
    fn unpacks_only_what_the_index_promised() {
        let dir = std::env::temp_dir().join(format!("tn-store-{}", std::process::id()));
        let bytes = zip(&serde_json::json!({ "id": "good", "name": "Good", "version": "1.0.0", "api": API_VERSION }));

        unpack(&bytes, &entry("good", &bytes), &dir).unwrap();
        assert!(dir.join("main.js").is_file());

        let mut bad = entry("good", &bytes);
        bad.sha256 = "00".into();
        assert!(unpack(&bytes, &bad, &dir).unwrap_err().to_string().contains("checksum"));

        assert!(unpack(&bytes, &entry("other", &bytes), &dir).unwrap_err().to_string().contains("promised"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
