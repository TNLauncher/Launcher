use crate::error::{AppError, Result};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;

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
}

impl AppState {
    pub fn new(root: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&root)?;
        Ok(Self {
            paths: Paths { root },
            http: http_client()?,
            store_lock: Mutex::new(()),
            running: Mutex::new(HashSet::new()),
            games: Mutex::new(HashMap::new()),
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
    pub fn account_file(&self) -> PathBuf {
        self.root.join("account.json")
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
        Ok(self.instance_dir(id)?.join("mods"))
    }
}
