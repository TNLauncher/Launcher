//! Per-plugin JSON: what `tn.storage` keeps and the values of the plugin's declared settings.
use super::{Plugin, SettingKind};
use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::storage;
use serde_json::{Map, Value};

/// Cap on a plugin's `storage.json`.
const MAX_STORAGE: usize = 1024 * 1024;
const MAX_SETTING: usize = 4096;

fn file(state: &AppState, plugin: &Plugin, name: &str) -> std::path::PathBuf {
    state.paths.plugin_data_dir(&plugin.manifest.id).join(name)
}

/// Locked read-modify-write of one of the plugin's files.
fn update<R>(state: &AppState, plugin: &Plugin, name: &str, f: impl FnOnce(&mut Map<String, Value>) -> Result<R>) -> Result<R> {
    let _guard = state.store_lock.lock().unwrap();
    let path = file(state, plugin, name);
    let mut map: Map<String, Value> = storage::read(&path);
    let out = f(&mut map)?;
    std::fs::create_dir_all(path.parent().expect("file in plugin dir"))?;
    storage::write(&path, &map)?;
    Ok(out)
}

pub fn storage_get(state: &AppState, plugin: &Plugin, key: &str) -> Value {
    storage::read::<Map<String, Value>>(&file(state, plugin, "storage.json")).remove(key).unwrap_or(Value::Null)
}

/// `null` removes the key.
pub fn storage_set(state: &AppState, plugin: &Plugin, key: &str, value: Value) -> Result<()> {
    update(state, plugin, "storage.json", |map| {
        match value {
            Value::Null => map.remove(key),
            v => map.insert(key.into(), v),
        };
        if serde_json::to_vec(map)?.len() > MAX_STORAGE {
            return Err(AppError::Plugin(format!("{} storage is over {} KiB", plugin.manifest.name, MAX_STORAGE / 1024)));
        }
        Ok(())
    })
}

/// Every declared setting, defaulted when unset.
pub fn settings(state: &AppState, plugin: &Plugin) -> Map<String, Value> {
    let saved: Map<String, Value> = storage::read(&file(state, plugin, "settings.json"));
    plugin
        .manifest
        .contributes
        .settings
        .iter()
        .map(|s| {
            let default = if s.kind == SettingKind::Toggle { Value::Bool(false) } else { Value::String(String::new()) };
            (s.key.clone(), saved.get(&s.key).cloned().unwrap_or(default))
        })
        .collect()
}

/// Only declared keys, with values of the declared type.
pub fn set_setting(state: &AppState, plugin: &Plugin, key: &str, value: Value) -> Result<()> {
    let spec = plugin.manifest.contributes.settings.iter().find(|s| s.key == key).ok_or_else(|| AppError::Invalid(format!("No setting {key}")))?;
    let ok = match (&value, spec.kind) {
        (Value::Bool(_), SettingKind::Toggle) => true,
        (Value::String(s), SettingKind::Text | SettingKind::Secret) => s.len() <= MAX_SETTING,
        _ => false,
    };
    if !ok {
        return Err(AppError::Invalid(format!("Bad value for {}", spec.label)));
    }
    update(state, plugin, "settings.json", |map| {
        map.insert(key.into(), value);
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::Manifest;
    use serde_json::json;

    #[test]
    fn stores_and_validates() {
        let root = std::env::temp_dir().join(format!("tn-plugin-data-{}", std::process::id()));
        let state = AppState::new(root.clone()).unwrap();
        let manifest: Manifest = serde_json::from_value(json!({
            "id": "p", "name": "P", "version": "1", "api": 1,
            "contributes": { "settings": [{ "key": "apiKey", "label": "API key", "type": "secret" }, { "key": "on", "label": "On", "type": "toggle" }] }
        }))
        .unwrap();
        let plugin = Plugin { manifest, dir: root.clone(), bundled: false, source: None };

        assert_eq!(storage_get(&state, &plugin, "k"), Value::Null);
        storage_set(&state, &plugin, "k", json!({ "a": 1 })).unwrap();
        assert_eq!(storage_get(&state, &plugin, "k"), json!({ "a": 1 }));
        storage_set(&state, &plugin, "k", Value::Null).unwrap();
        assert_eq!(storage_get(&state, &plugin, "k"), Value::Null);
        assert!(storage_set(&state, &plugin, "big", json!("x".repeat(MAX_STORAGE))).is_err());

        assert_eq!(settings(&state, &plugin), json!({ "apiKey": "", "on": false }).as_object().unwrap().clone());
        set_setting(&state, &plugin, "apiKey", json!("secret")).unwrap();
        assert!(set_setting(&state, &plugin, "on", json!("yes")).is_err());
        assert!(set_setting(&state, &plugin, "nope", json!(true)).is_err());
        assert_eq!(settings(&state, &plugin)["apiKey"], "secret");
        std::fs::remove_dir_all(root).unwrap();
    }
}
