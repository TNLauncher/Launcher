//! Version JSON resolution: vanilla manifest + optional loader profile merged on top.
use super::{http::get_json, loader};
use crate::error::{AppError, Result};
use crate::models::Loader;
use serde_json::Value;
use std::path::Path;

pub const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

pub async fn resolve(c: &reqwest::Client, root: &Path, game: &str, loader: Loader, loader_version: &str) -> Result<Value> {
    let manifest = get_json(c, MANIFEST_URL).await?;
    let url = manifest["versions"]
        .as_array()
        .and_then(|v| v.iter().find(|x| x["id"] == game))
        .and_then(|x| x["url"].as_str())
        .ok_or_else(|| AppError::NotFound(format!("Unknown Minecraft version {game}")))?;
    let base = get_json(c, url).await?;

    let dir = root.join("versions").join(game);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(format!("{game}.json")), base.to_string())?;

    match loader::profile_url(loader, game, loader_version) {
        Some(url) => Ok(merge(base, &get_json(c, &url).await?)),
        None => Ok(base),
    }
}

/// Applies an `inheritsFrom` child profile over its parent: libraries first, main class, extra args.
pub fn merge(mut base: Value, child: &Value) -> Value {
    let mut libs = child["libraries"].as_array().cloned().unwrap_or_default();
    libs.extend(base["libraries"].as_array().cloned().unwrap_or_default());
    base["libraries"] = Value::Array(libs);
    if child["mainClass"].is_string() {
        base["mainClass"] = child["mainClass"].clone();
    }
    for kind in ["game", "jvm"] {
        if let (Some(extra), Some(args)) = (child["arguments"][kind].as_array(), base["arguments"][kind].as_array_mut()) {
            args.extend(extra.iter().cloned());
        }
    }
    base
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn child_libraries_come_first_and_main_class_wins() {
        let base = json!({"libraries": [{"name": "a:vanilla:1"}], "mainClass": "net.minecraft.Main", "arguments": {"game": ["--x"], "jvm": []}});
        let child = json!({"libraries": [{"name": "b:loader:1"}], "mainClass": "Knot", "arguments": {"jvm": ["-Dfabric"]}});
        let v = super::merge(base, &child);
        assert_eq!(v["libraries"][0]["name"], "b:loader:1");
        assert_eq!(v["mainClass"], "Knot");
        assert_eq!(v["arguments"]["jvm"][0], "-Dfabric");
        assert_eq!(v["arguments"]["game"][0], "--x");
    }
}
