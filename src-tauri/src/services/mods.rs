//! Content files inside an instance: mod jars, resource and shader pack zips.
//! Disabled files are renamed to `*.disabled`, which Minecraft and the loaders skip.
use crate::error::{AppError, Result};
use crate::minecraft::http;
use crate::models::{ContentKind, ModFile};
use crate::state::AppState;
use sha1::{Digest, Sha1};
use std::collections::HashMap;

const DISABLED: &str = ".disabled";
const ALLOWED_DOWNLOAD_HOST: &str = "https://cdn.modrinth.com/";

/// File names come from the frontend: no separators, no hidden files.
fn safe_file(name: &str) -> Result<&str> {
    if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
        return Err(AppError::Invalid(format!("Bad file name: {name}")));
    }
    Ok(name)
}

pub fn list(state: &AppState, id: &str, kind: ContentKind) -> Result<Vec<ModFile>> {
    let dir = state.paths.content_dir(id, kind)?;
    let Ok(entries) = std::fs::read_dir(dir) else { return Ok(vec![]) };
    let disabled_ext = format!("{}{DISABLED}", kind.ext());
    let mut files: Vec<ModFile> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| {
            let file = e.file_name().to_string_lossy().to_string();
            let enabled = file.ends_with(kind.ext());
            (enabled || file.ends_with(&disabled_ext)).then(|| ModFile { size: e.metadata().map(|m| m.len()).unwrap_or(0), file, enabled })
        })
        .collect();
    files.sort_by_key(|m| m.file.to_lowercase());
    Ok(files)
}

/// SHA-1 of every listed file, keyed by file name: Modrinth identifies projects by it.
pub fn hashes(state: &AppState, id: &str, kind: ContentKind) -> Result<HashMap<String, String>> {
    let dir = state.paths.content_dir(id, kind)?;
    list(state, id, kind)?
        .into_iter()
        .map(|f| {
            let mut hasher = Sha1::new();
            std::io::copy(&mut std::fs::File::open(dir.join(&f.file))?, &mut hasher)?;
            let hex = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
            Ok((f.file, hex))
        })
        .collect()
}

pub fn toggle(state: &AppState, id: &str, kind: ContentKind, file: &str) -> Result<()> {
    let dir = state.paths.content_dir(id, kind)?;
    let file = safe_file(file)?;
    let target = match file.strip_suffix(DISABLED) {
        Some(enabled) => enabled.to_string(),
        None => format!("{file}{DISABLED}"),
    };
    std::fs::rename(dir.join(file), dir.join(target))?;
    Ok(())
}

pub fn delete(state: &AppState, id: &str, kind: ContentKind, file: &str) -> Result<()> {
    std::fs::remove_file(state.paths.content_dir(id, kind)?.join(safe_file(file)?))?;
    Ok(())
}

pub async fn install(state: &AppState, id: &str, kind: ContentKind, url: &str, file: &str) -> Result<()> {
    if !url.starts_with(ALLOWED_DOWNLOAD_HOST) {
        return Err(AppError::Invalid("Only Modrinth downloads are allowed".into()));
    }
    let path = state.paths.content_dir(id, kind)?.join(safe_file(file)?);
    http::download(&state.http, url, &path, None).await
}

/// Icon path declared in `fabric.mod.json` / `quilt.mod.json`: a string or a `{ "size": path }` map.
fn icon_path(meta: &serde_json::Value) -> Option<String> {
    match meta {
        serde_json::Value::String(s) => Some(s.trim_start_matches("./").trim_start_matches('/').into()),
        serde_json::Value::Object(sizes) => {
            let (_, largest) = sizes.iter().max_by_key(|(k, _)| k.parse::<u32>().unwrap_or(0))?;
            icon_path(largest)
        }
        _ => None,
    }
}

/// The mod's own icon from inside its jar, as `(bytes, mime)`.
pub fn icon(state: &AppState, id: &str, file: &str) -> Result<(Vec<u8>, &'static str)> {
    use std::io::Read;
    let jar = std::fs::File::open(state.paths.mods_dir(id)?.join(safe_file(file)?))?;
    let mut zip = zip::ZipArchive::new(jar)?;
    let meta = |zip: &mut zip::ZipArchive<std::fs::File>, name: &str| -> Option<serde_json::Value> {
        serde_json::from_reader(zip.by_name(name).ok()?).ok()
    };
    let path = meta(&mut zip, "fabric.mod.json")
        .and_then(|m| icon_path(&m["icon"]))
        .or_else(|| meta(&mut zip, "quilt.mod.json").and_then(|m| icon_path(&m["quilt_loader"]["metadata"]["icon"])))
        .ok_or_else(|| AppError::NotFound("Mod has no icon".into()))?;
    let mut bytes = Vec::new();
    zip.by_name(&path)?.read_to_end(&mut bytes)?;
    let mime = if path.ends_with(".jpg") || path.ends_with(".jpeg") { "image/jpeg" } else { "image/png" };
    Ok((bytes, mime))
}

#[cfg(test)]
mod tests {
    #[test]
    fn picks_largest_icon() {
        let v = serde_json::json!({ "16": "a.png", "128": "./b.png", "32": "c.png" });
        assert_eq!(super::icon_path(&v).as_deref(), Some("b.png"));
        assert_eq!(super::icon_path(&serde_json::json!("assets/x/icon.png")).as_deref(), Some("assets/x/icon.png"));
        assert_eq!(super::icon_path(&serde_json::Value::Null), None);
    }

    #[test]
    fn lists_and_hashes_by_kind() {
        use crate::models::ContentKind;
        let root = std::env::temp_dir().join(format!("tn-content-{}", std::process::id()));
        let state = crate::state::AppState::new(root.clone()).unwrap();
        let dir = state.paths.content_dir("inst", ContentKind::Resourcepack).unwrap();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.zip"), "abc").unwrap();
        std::fs::write(dir.join("b.zip.disabled"), "abc").unwrap();
        std::fs::write(dir.join("notes.txt"), "x").unwrap();

        let files = super::list(&state, "inst", ContentKind::Resourcepack).unwrap();
        assert_eq!(files.iter().map(|f| (f.file.as_str(), f.enabled)).collect::<Vec<_>>(), [("a.zip", true), ("b.zip.disabled", false)]);
        assert_eq!(super::hashes(&state, "inst", ContentKind::Resourcepack).unwrap()["a.zip"], "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert!(super::list(&state, "inst", ContentKind::Mod).unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_path_traversal() {
        assert!(super::safe_file("../evil.jar").is_err());
        assert!(super::safe_file(".hidden").is_err());
        assert!(super::safe_file("sodium-0.6.jar").is_ok());
    }
}
