//! JSON persistence. Writes go through a temp file + rename so a crash never leaves half a file.
use crate::error::Result;
use crate::minecraft::auth::Account;
use crate::models::{Instance, Settings};
use crate::state::AppState;
use serde::{de::DeserializeOwned, Serialize};
use std::path::Path;

fn read<T: DeserializeOwned + Default>(path: &Path) -> T {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn write<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

pub fn load_settings(state: &AppState) -> Settings {
    read(&state.paths.settings_file())
}

pub fn save_settings(state: &AppState, settings: &Settings) -> Result<()> {
    write(&state.paths.settings_file(), settings)
}

// ponytail: tokens sit in plain JSON like most launchers do; move to the OS keyring if that matters.
pub fn load_account(state: &AppState) -> Option<Account> {
    read(&state.paths.account_file())
}

pub fn save_account(state: &AppState, account: Option<&Account>) -> Result<()> {
    write(&state.paths.account_file(), &account)
}

pub fn load_instances(state: &AppState) -> Vec<Instance> {
    read(&state.paths.instances_file())
}

/// Locked read-modify-write of the instance list.
pub fn update_instances<R>(state: &AppState, f: impl FnOnce(&mut Vec<Instance>) -> R) -> Result<R> {
    let _guard = state.store_lock.lock().unwrap();
    let path = state.paths.instances_file();
    let mut list: Vec<Instance> = read(&path);
    let out = f(&mut list);
    write(&path, &list)?;
    Ok(out)
}
