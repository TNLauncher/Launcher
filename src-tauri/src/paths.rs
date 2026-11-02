//! Where things live on disk, and the checks every path from IPC or a plugin goes through.
use crate::error::{AppError, Result};
use crate::models::ContentKind;
use std::path::{Component, Path, PathBuf};

/// A single file name from the frontend or a plugin: no separators, no hidden files.
pub fn safe_file(name: &str) -> Result<&str> {
    if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
        return Err(AppError::Invalid(format!("Bad file name: {name}")));
    }
    Ok(name)
}

/// An untrusted relative path: plain components only, so joining it never escapes the base dir.
pub fn safe_rel(path: &str) -> Result<&Path> {
    let p = Path::new(path);
    if path.is_empty() || !p.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(AppError::Invalid(format!("Bad path: {path}")));
    }
    Ok(p)
}

/// On-disk layout under the app data dir.
pub struct Paths {
    pub root: PathBuf,
}

impl Paths {
    pub fn settings_file(&self) -> PathBuf {
        self.root.join("settings.json")
    }
    pub fn accounts_file(&self) -> PathBuf {
        self.root.join("accounts.json")
    }
    /// The single Microsoft sign-in of earlier builds; read once to migrate.
    pub fn account_file(&self) -> PathBuf {
        self.root.join("account.json")
    }
    /// Plugins the user added; bundled ones live in the app's resources.
    pub fn plugins_dir(&self) -> PathBuf {
        self.root.join("plugins")
    }
    /// What a plugin stores (`storage.json`) and its settings (`settings.json`). Ids are checked at load.
    pub fn plugin_data_dir(&self, id: &str) -> PathBuf {
        self.root.join("plugin-data").join(id)
    }
    pub fn plugins_file(&self) -> PathBuf {
        self.root.join("disabled-plugins.json")
    }
    pub fn favorites_file(&self) -> PathBuf {
        self.root.join("favorites.json")
    }
    /// Skin textures by URL hash, and each account's last known skin.
    pub fn skins_dir(&self) -> PathBuf {
        self.root.join("cache").join("skins")
    }
    pub fn instances_file(&self) -> PathBuf {
        self.root.join("instances.json")
    }
    /// Ids come back over IPC, so only `[A-Za-z0-9-]` is accepted to keep them inside `instances/`.
    pub fn instance_dir(&self, id: &str) -> Result<PathBuf> {
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return Err(AppError::Invalid(format!("Bad instance id: {id}")));
        }
        Ok(self.root.join("instances").join(id))
    }
    pub fn mods_dir(&self, id: &str) -> Result<PathBuf> {
        self.content_dir(id, ContentKind::Mod)
    }
    pub fn content_dir(&self, id: &str, kind: ContentKind) -> Result<PathBuf> {
        Ok(self.instance_dir(id)?.join(kind.dir()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_escaping_names_and_paths() {
        assert!(safe_file("../evil.jar").is_err());
        assert!(safe_file(".hidden").is_err());
        assert!(safe_file("sodium-0.6.jar").is_ok());
        assert!(safe_rel("../evil.jar").is_err());
        assert!(safe_rel("/etc/passwd").is_err());
        assert!(safe_rel("").is_err());
        assert!(safe_rel("mods/sodium.jar").is_ok());
    }
}
