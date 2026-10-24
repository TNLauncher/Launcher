use crate::error::{AppError, Result};
use crate::models::ContentKind;
use crate::plugins::Registry;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Child;
use std::sync::{Mutex, RwLock};

/// Shared backend state, registered with `app.manage` and injected into commands.
pub struct AppState {
    pub paths: Paths,
    pub http: reqwest::Client,
    /// Serializes read-modify-write cycles on the JSON store.
    pub store_lock: Mutex<()>,
    /// Instance ids that are currently installing or running.
    pub running: Mutex<HashSet<String>>,
    /// Live game processes by instance id; held so the UI can stop them.
    pub games: Mutex<HashMap<String, Child>>,
    /// Modpack imports in flight by project id; aborting one cancels it.
    pub imports: Mutex<HashMap<String, futures::future::AbortHandle>>,
    pub plugins: RwLock<Registry>,
}

impl AppState {
    pub fn new(root: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&root)?;
        let http = http_client()?;
        Ok(Self {
            paths: Paths { root },
            // Replaced in setup, where plugin folders and the window are known.
            plugins: RwLock::new(Registry::empty(std::sync::Arc::new(crate::plugins::js::Bridge::new(|_| {})))),
            http,
            store_lock: Mutex::new(()),
            running: Mutex::new(HashSet::new()),
            games: Mutex::new(HashMap::new()),
            imports: Mutex::new(HashMap::new()),
        })
    }

    pub fn is_running(&self, id: &str) -> bool {
        self.running.lock().unwrap().contains(id)
    }
}

pub fn http_client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(concat!("thenofis/TNLauncher/", env!("CARGO_PKG_VERSION")))
        .build()?)
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
