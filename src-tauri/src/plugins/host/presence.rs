//! `tn.presence`: the Discord status. Needs `presence`.
use super::{params, Cx};
use crate::error::{AppError, Result};
use crate::services::discord::{Discord, Presence};
use serde_json::Value;
use tauri::Manager;

pub fn handle(cx: &Cx<'_>, method: &str, p: Value) -> Result<Value> {
    match method {
        "presence.set" => {
            let p: Presence = params(p)?;
            if !p.valid() {
                return Err(AppError::Invalid("Discord status lines must be 2–128 characters".into()));
            }
            cx.app.state::<Discord>().set(Some(p));
        }
        "presence.clear" => cx.app.state::<Discord>().set(None),
        _ => return super::unknown(method),
    }
    Ok(Value::Null)
}
