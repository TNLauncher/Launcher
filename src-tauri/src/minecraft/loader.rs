//! Loader metadata: Fabric/Quilt meta APIs (same shape), Forge/NeoForge mavens, LiteLoader via Prism's meta.
use super::http::get_json;
use crate::error::{AppError, Result};
use crate::models::Loader;
use serde_json::Value;

const FORGE_PROMOS: &str = "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
const FORGE_MAVEN: &str = "https://maven.minecraftforge.net/net/minecraftforge/forge";
const NEOFORGE_VERSIONS: &str = "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";
const NEOFORGE_MAVEN: &str = "https://maven.neoforged.net/releases/net/neoforged/neoforge";
/// The original LiteLoader site no longer serves 1.12.x; Prism keeps working profiles.
const LITELOADER_META: &str = "https://meta.prismlauncher.org/v1/com.mumfrey.liteloader";

/// Where the profile that goes over the vanilla version comes from.
pub enum Profile {
    None,
    /// A ready launcher profile JSON.
    Url(String),
    /// An official installer that writes `versions/{id}/{id}.json` itself.
    Installer { url: String, id: String },
}

fn meta_base(loader: Loader) -> Option<&'static str> {
    match loader {
        Loader::Fabric => Some("https://meta.fabricmc.net/v2"),
        Loader::Quilt => Some("https://meta.quiltmc.org/v3"),
        _ => None,
    }
}

fn unsupported(loader: Loader, game: &str) -> AppError {
    AppError::Unsupported(match loader {
        // Abandoned in 2017: newer versions never come.
        Loader::LiteLoader => format!("LiteLoader only runs Minecraft 1.5.2 to 1.12.2, not {game}"),
        _ => format!("{loader:?} does not support Minecraft {game} yet"),
    })
}

/// NeoForge drops the leading `1.` and pads to the game's part count: 1.21 → `21.0.`, 26.1 → `26.1.0.`.
fn neoforge_prefix(game: &str) -> String {
    let (g, parts) = match game.strip_prefix("1.") {
        Some(g) => (g, 2),
        None => (game, 3),
    };
    let mut p = g.to_string();
    for _ in g.split('.').count()..parts {
        p.push_str(".0");
    }
    p + "."
}

/// Newest stable loader version for `game`; empty for vanilla.
pub async fn latest(c: &reqwest::Client, game: &str, loader: Loader) -> Result<String> {
    let found = match loader {
        Loader::Vanilla => return Ok(String::new()),
        Loader::Fabric | Loader::Quilt => {
            let base = meta_base(loader).unwrap_or_default();
            let list = get_json(c, &format!("{base}/versions/loader/{game}")).await?;
            let list = list.as_array().ok_or_else(|| AppError::Invalid("Bad loader list".into()))?;
            let is_stable = |e: &&Value| {
                e["loader"]["stable"].as_bool().unwrap_or(true) && !e["loader"]["version"].as_str().unwrap_or("").contains("beta")
            };
            list.iter().find(is_stable).or(list.first()).and_then(|e| e["loader"]["version"].as_str()).map(String::from)
        }
        Loader::Forge => {
            let promos = get_json(c, FORGE_PROMOS).await?;
            let p = &promos["promos"];
            p[format!("{game}-recommended")].as_str().or(p[format!("{game}-latest")].as_str()).map(String::from)
        }
        Loader::NeoForge => {
            let list = get_json(c, NEOFORGE_VERSIONS).await?;
            let prefix = neoforge_prefix(game);
            let matching: Vec<&str> = list["versions"].as_array().into_iter().flatten().filter_map(Value::as_str).filter(|v| v.starts_with(&prefix)).collect();
            // The list is oldest first.
            matching.iter().rev().find(|v| !v.contains("beta")).or(matching.last()).map(|v| v.to_string())
        }
        Loader::LiteLoader => {
            let index = get_json(c, &format!("{LITELOADER_META}/index.json")).await?;
            index["versions"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|v| v["requires"].as_array().into_iter().flatten().any(|r| r["uid"] == "net.minecraft" && r["equals"] == game))
                .and_then(|v| v["version"].as_str())
                .map(String::from)
        }
    };
    found.filter(|v| !v.is_empty()).ok_or_else(|| unsupported(loader, game))
}

pub fn profile(loader: Loader, game: &str, v: &str) -> Profile {
    match loader {
        Loader::Vanilla => Profile::None,
        Loader::Fabric | Loader::Quilt => {
            Profile::Url(format!("{}/versions/loader/{game}/{v}/profile/json", meta_base(loader).unwrap_or_default()))
        }
        Loader::LiteLoader => Profile::Url(format!("{LITELOADER_META}/{v}.json")),
        // ponytail: the id format of 1.12.2+ installers; older Forge names its version differently and is not supported.
        Loader::Forge => Profile::Installer { url: format!("{FORGE_MAVEN}/{game}-{v}/forge-{game}-{v}-installer.jar"), id: format!("{game}-forge-{v}") },
        Loader::NeoForge => Profile::Installer { url: format!("{NEOFORGE_MAVEN}/{v}/neoforge-{v}-installer.jar"), id: format!("neoforge-{v}") },
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn neoforge_prefixes() {
        assert_eq!(super::neoforge_prefix("1.21.1"), "21.1.");
        assert_eq!(super::neoforge_prefix("1.21"), "21.0.");
        assert_eq!(super::neoforge_prefix("26.1"), "26.1.0.");
        assert_eq!(super::neoforge_prefix("26.1.1"), "26.1.1.");
    }
}
