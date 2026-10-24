//! Version JSON resolution: vanilla manifest + optional loader profile merged on top.
use super::loader::{self, Profile};
use super::{http::get_json, installer, Progress};
use crate::error::{AppError, Result};
use crate::models::Loader;
use serde_json::Value;
use std::path::Path;

pub const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

/// The vanilla version JSON, also saved where loader installers look for it.
pub async fn base(c: &reqwest::Client, root: &Path, game: &str) -> Result<Value> {
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
    Ok(base)
}

/// `base` with the loader's profile merged on top; Forge/NeoForge run their installer with `java` on first use.
pub async fn with_loader(c: &reqwest::Client, root: &Path, base: Value, loader: Loader, loader_version: &str, java: &Path, progress: Progress<'_>) -> Result<Value> {
    let game = base["id"].as_str().unwrap_or_default();
    let child = match loader::profile(loader, game, loader_version) {
        Profile::None => return Ok(base),
        Profile::Url(url) => get_json(c, &url).await?,
        Profile::Installer { url, id } => installer::ensure(c, root, java, &url, &id, progress).await?,
    };
    Ok(merge(base, &child))
}

/// Applies an `inheritsFrom` child profile over its parent: libraries first, main class, extra args.
/// Pre-1.13 profiles replace `minecraftArguments` whole (Forge) or add tweakers to it (Prism's LiteLoader).
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
    if child["minecraftArguments"].is_string() {
        base["minecraftArguments"] = child["minecraftArguments"].clone();
    }
    if let Some(legacy) = base["minecraftArguments"].as_str() {
        let tweaks: String = child["+tweakers"].as_array().into_iter().flatten().filter_map(Value::as_str).map(|t| format!(" --tweakClass {t}")).collect();
        base["minecraftArguments"] = Value::String(legacy.to_string() + &tweaks);
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

    #[test]
    fn legacy_arguments_are_replaced_or_tweaked() {
        let base = json!({"minecraftArguments": "--username x"});
        assert_eq!(super::merge(base.clone(), &json!({"minecraftArguments": "--forge"}))["minecraftArguments"], "--forge");
        assert_eq!(super::merge(base, &json!({"+tweakers": ["Lite"]}))["minecraftArguments"], "--username x --tweakClass Lite");
    }
}
