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

#[cfg(test)]
mod tests {
    #[test]
    fn rejects_path_traversal() {
        assert!(super::safe_file("../evil.jar").is_err());
        assert!(super::safe_file(".hidden").is_err());
        assert!(super::safe_file("sodium-0.6.jar").is_ok());
    }
}
