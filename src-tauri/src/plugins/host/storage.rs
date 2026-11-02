//! `tn.storage` (the plugin's own key-value store) and `tn.settings` (its declared settings). Open to every plugin.
use super::{params, Cx};
use crate::error::{AppError, Result};
use crate::plugins::data;
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Entry {
    key: String,
    /// `null` (or missing) removes the key.
    #[serde(default)]
    value: Value,
}

pub fn handle(cx: &Cx<'_>, method: &str, p: Value) -> Result<Value> {
    match method {
        "storage.get" => {
            let e: Entry = params(p)?;
            Ok(data::storage_get(cx.state, &cx.plugin, check_key(&e.key)?))
        }
        "storage.set" => {
            let e: Entry = params(p)?;
            data::storage_set(cx.state, &cx.plugin, check_key(&e.key)?, e.value)?;
            Ok(Value::Null)
        }
        "settings.get" => Ok(Value::Object(data::settings(cx.state, &cx.plugin))),
        _ => super::unknown(method),
    }
}

fn check_key(k: &str) -> Result<&str> {
    if k.is_empty() || k.len() > 256 {
        return Err(AppError::Invalid("Bad storage key".into()));
    }
    Ok(k)
}
