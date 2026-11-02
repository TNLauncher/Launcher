//! Loaded plugins: each folder's manifest plus handles to what its frame registered, and which ones are on.
use super::bridge::Bridge;
use super::manifest::{self, Manifest};
use super::remote::{Account, Importer, Remote, Runtime, Source};
use crate::error::{AppError, Result};
use std::path::PathBuf;
use std::sync::Arc;

pub struct Plugin {
    pub manifest: Manifest,
    pub dir: PathBuf,
    /// Shipped with the launcher rather than added by the user.
    pub bundled: bool,
    pub source: Option<Source>,
    pub account: Option<Account>,
    pub importer: Option<Importer>,
    pub runtime: Option<Runtime>,
}

impl Plugin {
    /// Whether the launcher may download `url` for this plugin.
    pub fn may_download(&self, url: &str) -> bool {
        self.manifest.permissions.downloads.iter().any(|h| url.starts_with(h.as_str()))
    }

    /// The account provider, or an error naming the plugin.
    pub fn account(&self) -> Result<&Account> {
        self.account.as_ref().ok_or_else(|| AppError::Unsupported(format!("{} is not an account provider", self.manifest.name)))
    }

    /// The content source, or an error naming the plugin.
    pub fn source(&self) -> Result<&Source> {
        self.source.as_ref().ok_or_else(|| AppError::Unsupported(format!("{} is not a content source", self.manifest.name)))
    }

    /// The game runtime, or an error naming the plugin.
    pub fn runtime(&self) -> Result<&Runtime> {
        self.runtime.as_ref().ok_or_else(|| AppError::Unsupported(format!("{} is not a game runtime", self.manifest.name)))
    }
}

/// A plugin folder that could not be loaded.
pub struct Failed {
    pub name: String,
    pub error: String,
}

pub struct Registry {
    pub dirs: Vec<(PathBuf, bool)>,
    pub plugins: Vec<Arc<Plugin>>,
    pub failed: Vec<Failed>,
    /// Ids the user switched off; mirrors `disabled-plugins.json`, which is only read at startup.
    pub disabled: Vec<String>,
    pub bridge: Arc<Bridge>,
}

impl Registry {
    pub fn empty(bridge: Arc<Bridge>) -> Self {
        Self { dirs: vec![], plugins: vec![], failed: vec![], disabled: vec![], bridge }
    }

    /// Loads every plugin folder in `dirs` as `(dir, bundled)`; the first plugin with an id wins.
    pub fn load(dirs: &[(PathBuf, bool)], disabled: Vec<String>, bridge: Arc<Bridge>) -> Self {
        let mut reg = Self { dirs: dirs.to_vec(), plugins: vec![], failed: vec![], disabled, bridge };
        for (dir, bundled) in dirs {
            let Ok(entries) = std::fs::read_dir(dir) else { continue };
            let mut folders: Vec<PathBuf> = entries.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir()).collect();
            folders.sort();
            for folder in folders {
                let name = folder.file_name().unwrap_or_default().to_string_lossy().into_owned();
                match manifest::read(&folder) {
                    Ok(m) if reg.plugins.iter().any(|p| p.manifest.id == m.id) => {
                        reg.failed.push(Failed { name: m.name, error: format!("Another plugin already uses the id {}", m.id) })
                    }
                    Ok(manifest) => {
                        let c = &manifest.contributes;
                        let remote = |target| Remote::new(&manifest.id, target, reg.bridge.clone());
                        let source = c.source.as_ref().map(|_| Source(remote("source")));
                        let account = c.account.as_ref().map(|_| Account(remote("account")));
                        let importer = c.importer.then(|| Importer(remote("importer")));
                        let runtime = c.runtime.as_ref().map(|_| Runtime(remote("runtime")));
                        reg.plugins.push(Arc::new(Plugin { manifest, dir: folder, bundled: *bundled, source, account, importer, runtime }));
                    }
                    Err(e) => reg.failed.push(Failed { name, error: e.to_string() }),
                }
            }
        }
        reg
    }

    pub fn get(&self, id: &str) -> Result<&Arc<Plugin>> {
        self.plugins.iter().find(|p| p.manifest.id == id).ok_or_else(|| AppError::NotFound(format!("No plugin {id}")))
    }

    pub fn is_enabled(&self, id: &str) -> bool {
        !self.disabled.iter().any(|d| d == id)
    }
}
