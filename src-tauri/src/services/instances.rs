use crate::error::{AppError, Result};
use crate::minecraft::loader;
use crate::models::{Instance, InstanceSettings, Loader};
use crate::state::AppState;
use crate::storage;
use std::collections::HashMap;

pub fn list(state: &AppState) -> Vec<Instance> {
    storage::load_instances(state)
}

pub fn get(state: &AppState, id: &str) -> Result<Instance> {
    list(state).into_iter().find(|i| i.id == id).ok_or_else(|| AppError::NotFound("Instance not found".into()))
}

pub async fn create(state: &AppState, name: &str, version: &str, loader: Loader) -> Result<Instance> {
    let loader_version = loader::latest(&state.http, version, loader).await?;
    let instance = new(name, version, loader, loader_version);
    add(state, &instance)?;
    Ok(instance)
}

/// An instance with a fresh id; nothing is stored until `add`.
pub fn new(name: &str, version: &str, loader: Loader, loader_version: String) -> Instance {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
    let name = name.trim();
    Instance {
        id: format!("{nanos:x}"),
        name: if name.is_empty() { version.into() } else { name.into() },
        version: version.into(),
        loader,
        loader_version,
        created: super::now(),
        ..Default::default()
    }
}

pub fn add(state: &AppState, instance: &Instance) -> Result<()> {
    std::fs::create_dir_all(state.paths.mods_dir(&instance.id)?)?;
    storage::update_instances(state, |list| list.push(instance.clone()))
}

pub fn update(state: &AppState, id: &str, f: impl FnOnce(&mut Instance)) -> Result<()> {
    storage::update_instances(state, |list| list.iter_mut().find(|i| i.id == id).map(f))?
        .ok_or_else(|| AppError::NotFound("Instance not found".into()))
}

pub fn rename(state: &AppState, id: &str, name: &str) -> Result<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("Name cannot be empty".into()));
    }
    update(state, id, |i| i.name = name.into())
}

/// Max size of a stored icon; the frontend downscales before sending.
const MAX_ICON_LEN: usize = 256 * 1024;

pub fn set_icon(state: &AppState, id: &str, icon: &str) -> Result<()> {
    if !(icon.is_empty() || icon.starts_with("data:image/")) || icon.len() > MAX_ICON_LEN {
        return Err(AppError::Invalid("Icon must be a small image".into()));
    }
    update(state, id, |i| i.icon = icon.into())
}

pub fn set_settings(state: &AppState, id: &str, settings: InstanceSettings) -> Result<()> {
    update(state, id, |i| i.settings = settings)
}

pub fn delete(state: &AppState, id: &str) -> Result<()> {
    if state.is_running(id) {
        return Err(AppError::Conflict("Close the game before deleting this instance".into()));
    }
    let dir = state.paths.instance_dir(id)?;
    storage::update_instances(state, |list| list.retain(|i| i.id != id))?;
    if dir.exists() {
        std::fs::remove_dir_all(dir)?;
    }
    Ok(())
}

/// Number of enabled mod jars per instance.
pub fn mod_counts(state: &AppState, instances: &[Instance]) -> HashMap<String, usize> {
    instances
        .iter()
        .map(|i| {
            let n = state
                .paths
                .mods_dir(&i.id)
                .ok()
                .and_then(|d| std::fs::read_dir(d).ok())
                .map(|d| d.filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().ends_with(".jar")).count())
                .unwrap_or(0);
            (i.id.clone(), n)
        })
        .collect()
}
