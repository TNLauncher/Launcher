//! Fabric and Quilt metadata APIs (they share the same shape).
use super::http::get_json;
use crate::error::{AppError, Result};
use crate::models::Loader;

fn meta_base(loader: Loader) -> Option<&'static str> {
    match loader {
        Loader::Fabric => Some("https://meta.fabricmc.net/v2"),
        Loader::Quilt => Some("https://meta.quiltmc.org/v3"),
        Loader::Vanilla => None,
    }
}

/// Newest stable loader version for `game`; empty for vanilla.
pub async fn latest(c: &reqwest::Client, game: &str, loader: Loader) -> Result<String> {
    let Some(base) = meta_base(loader) else { return Ok(String::new()) };
    let list = get_json(c, &format!("{base}/versions/loader/{game}")).await?;
    let list = list.as_array().ok_or_else(|| AppError::Invalid("Bad loader list".into()))?;
    let is_stable = |e: &&serde_json::Value| {
        e["loader"]["stable"].as_bool().unwrap_or(true) && !e["loader"]["version"].as_str().unwrap_or("").contains("beta")
    };
    let pick = list
        .iter()
        .find(is_stable)
        .or(list.first())
        .ok_or_else(|| AppError::Unsupported(format!("{loader:?} does not support Minecraft {game} yet")))?;
    Ok(pick["loader"]["version"].as_str().unwrap_or_default().to_string())
}

/// Launcher profile JSON that inherits from the vanilla version.
pub fn profile_url(loader: Loader, game: &str, loader_version: &str) -> Option<String> {
    meta_base(loader).map(|base| format!("{base}/versions/loader/{game}/{loader_version}/profile/json"))
}
