use crate::error::Result;
use crate::paths::Paths;
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
    pub imports: Mutex<HashMap<String, futures_util::future::AbortHandle>>,
    pub plugins: RwLock<Registry>,
}

impl AppState {
    pub fn new(root: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&root)?;
        let http = http_client()?;
        Ok(Self {
            paths: Paths { root },
            // Replaced in setup, where plugin folders and the window are known.
            plugins: RwLock::new(Registry::empty(std::sync::Arc::new(crate::plugins::bridge::Bridge::new(|_| {})))),
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
