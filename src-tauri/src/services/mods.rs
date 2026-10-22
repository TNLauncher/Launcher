//! Mod jars inside an instance. Disabled mods are renamed to `*.jar.disabled`.
use crate::error::{AppError, Result};
use crate::minecraft::http;
use crate::models::ModFile;
use crate::state::AppState;

const DISABLED: &str = ".disabled";
const ALLOWED_DOWNLOAD_HOST: &str = "https://cdn.modrinth.com/";

/// File names come from the frontend: no separators, no hidden files.
fn safe_file(name: &str) -> Result<&str> {
    if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
        return Err(AppError::Invalid(format!("Bad file name: {name}")));
    }
    Ok(name)
}

pub fn list(state: &AppState, id: &str) -> Result<Vec<ModFile>> {
    let dir = state.paths.mods_dir(id)?;
    let Ok(entries) = std::fs::read_dir(dir) else { return Ok(vec![]) };
    let mut mods: Vec<ModFile> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let file = e.file_name().to_string_lossy().to_string();
            let enabled = file.ends_with(".jar");
            (enabled || file.ends_with(".jar.disabled")).then(|| ModFile { size: e.metadata().map(|m| m.len()).unwrap_or(0), file, enabled })
        })
        .collect();
    mods.sort_by_key(|m| m.file.to_lowercase());
    Ok(mods)
}

pub fn toggle(state: &AppState, id: &str, file: &str) -> Result<()> {
    let dir = state.paths.mods_dir(id)?;
    let file = safe_file(file)?;
    let target = match file.strip_suffix(DISABLED) {
        Some(enabled) => enabled.to_string(),
        None => format!("{file}{DISABLED}"),
    };
    std::fs::rename(dir.join(file), dir.join(target))?;
    Ok(())
}

pub fn delete(state: &AppState, id: &str, file: &str) -> Result<()> {
    std::fs::remove_file(state.paths.mods_dir(id)?.join(safe_file(file)?))?;
    Ok(())
}

pub async fn install(state: &AppState, id: &str, url: &str, file: &str) -> Result<()> {
    if !url.starts_with(ALLOWED_DOWNLOAD_HOST) {
        return Err(AppError::Invalid("Only Modrinth downloads are allowed".into()));
    }
    let path = state.paths.mods_dir(id)?.join(safe_file(file)?);
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
    fn rejects_path_traversal() {
        assert!(super::safe_file("../evil.jar").is_err());
        assert!(super::safe_file(".hidden").is_err());
        assert!(super::safe_file("sodium-0.6.jar").is_ok());
    }
}
