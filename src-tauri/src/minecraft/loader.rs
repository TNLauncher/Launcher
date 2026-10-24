//! Loader metadata: Fabric/Quilt meta APIs (same shape), Forge/NeoForge mavens, LiteLoader via Prism's meta.
use super::http::get_json;
use crate::error::{AppError, Result};
use crate::models::Loader;
use serde::Serialize;
use serde_json::Value;
use std::cmp::Ordering;

const FORGE_PROMOS: &str = "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
const FORGE_METADATA: &str = "https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json";
const FORGE_MAVEN: &str = "https://maven.minecraftforge.net/net/minecraftforge/forge";
/// Oldest Forge whose installer has the headless `--installClient` and the `{game}-forge-{v}` id.
// ponytail: build cut-off from memory of the 1.12.2 installer switch; lower it if older builds turn out to install.
const FORGE_OLDEST: (&str, &str) = ("1.12.2", "14.23.5.2851");
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

/// One loader release for a game version.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Build {
    pub version: String,
    /// Recommended for players: Forge's promoted build, everyone else's non-beta.
    pub stable: bool,
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

/// Numeric comparison of dotted versions; a `-beta`/`-rc` suffix sorts before its release.
pub fn cmp_version(a: &str, b: &str) -> Ordering {
    let nums = |s: &str| s.split(|c: char| !c.is_ascii_digit()).filter(|x| !x.is_empty()).map(|x| x.parse().unwrap_or(0u64)).collect::<Vec<_>>();
    let (ac, ap) = a.split_once('-').map_or((a, None), |(c, p)| (c, Some(p)));
    let (bc, bp) = b.split_once('-').map_or((b, None), |(c, p)| (c, Some(p)));
    nums(ac).cmp(&nums(bc)).then_with(|| match (ap, bp) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(x), Some(y)) => nums(x).cmp(&nums(y)),
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

/// The game a NeoForge version is for, the inverse of [`neoforge_prefix`]; `None` for April Fools builds.
fn neoforge_game(v: &str) -> Option<String> {
    let core = v.split('-').next()?;
    let p: Vec<u32> = core.split('.').map(|x| x.parse().ok()).collect::<Option<_>>()?;
    let trim = |s: String, last: u32| if last == 0 { s } else { format!("{s}.{last}") };
    match p.as_slice() {
        [0, ..] => None,
        [major @ ..26, minor, _] => Some(trim(format!("1.{major}"), *minor)),
        [year, release, patch, _] => Some(trim(format!("{year}.{release}"), *patch)),
        _ => None,
    }
}

fn strings(v: &Value) -> impl Iterator<Item = &str> {
    v.as_array().into_iter().flatten().filter_map(Value::as_str)
}

/// Game versions the loader has builds for; `None` for vanilla, which runs them all.
pub async fn games(c: &reqwest::Client, loader: Loader) -> Result<Option<Vec<String>>> {
    let list = match loader {
        Loader::Vanilla => return Ok(None),
        Loader::Fabric | Loader::Quilt => {
            let list = get_json(c, &format!("{}/versions/game", meta_base(loader).unwrap_or_default())).await?;
            list.as_array().into_iter().flatten().filter_map(|g| g["version"].as_str().map(String::from)).collect()
        }
        Loader::Forge => {
            let meta = get_json(c, FORGE_METADATA).await?;
            let keys = meta.as_object().into_iter().flatten().map(|(k, _)| k.clone());
            keys.filter(|g| cmp_version(g, FORGE_OLDEST.0).is_ge()).collect()
        }
        Loader::NeoForge => {
            let mut games: Vec<String> = strings(&get_json(c, NEOFORGE_VERSIONS).await?["versions"]).filter_map(neoforge_game).collect();
            games.dedup();
            games
        }
        Loader::LiteLoader => {
            let index = get_json(c, &format!("{LITELOADER_META}/index.json")).await?;
            index["versions"]
                .as_array()
                .into_iter()
                .flatten()
                .flat_map(|v| v["requires"].as_array().into_iter().flatten())
                .filter(|r| r["uid"] == "net.minecraft")
                .filter_map(|r| r["equals"].as_str().map(String::from))
                .collect()
        }
    };
    Ok(Some(list))
}

/// Loader builds for `game`, newest first; empty for vanilla.
pub async fn builds(c: &reqwest::Client, game: &str, loader: Loader) -> Result<Vec<Build>> {
    let mut list: Vec<Build> = match loader {
        Loader::Vanilla => return Ok(vec![]),
        Loader::Fabric | Loader::Quilt => {
            let list = get_json(c, &format!("{}/versions/loader/{game}", meta_base(loader).unwrap_or_default())).await?;
            list.as_array()
                .into_iter()
                .flatten()
                .filter_map(|e| {
                    let version = e["loader"]["version"].as_str()?.to_string();
                    let stable = e["loader"]["stable"].as_bool().unwrap_or(true) && !version.contains('-');
                    Some(Build { version, stable })
                })
                .collect()
        }
        Loader::Forge => {
            let (meta, promos) = futures::try_join!(get_json(c, FORGE_METADATA), get_json(c, FORGE_PROMOS))?;
            let recommended = promos["promos"][format!("{game}-recommended")].as_str().unwrap_or_default().to_string();
            strings(&meta[game])
                .filter_map(|v| v.strip_prefix(&format!("{game}-")))
                .filter(|v| game != FORGE_OLDEST.0 || cmp_version(v, FORGE_OLDEST.1).is_ge())
                .map(|v| Build { version: v.into(), stable: v == recommended })
                .collect()
        }
        Loader::NeoForge => {
            let prefix = neoforge_prefix(game);
            strings(&get_json(c, NEOFORGE_VERSIONS).await?["versions"])
                .filter(|v| v.starts_with(&prefix))
                .map(|v| Build { version: v.into(), stable: !v.contains("beta") })
                .collect()
        }
        Loader::LiteLoader => {
            let index = get_json(c, &format!("{LITELOADER_META}/index.json")).await?;
            index["versions"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|v| v["requires"].as_array().into_iter().flatten().any(|r| r["uid"] == "net.minecraft" && r["equals"] == game))
                .filter_map(|v| Some(Build { version: v["version"].as_str()?.into(), stable: v["type"] == "release" }))
                .collect()
        }
    };
    // Quilt's meta comes in no particular order.
    list.sort_by(|a, b| cmp_version(&b.version, &a.version));
    Ok(list)
}

/// Newest stable loader version for `game`, else the newest at all; empty for vanilla.
pub async fn latest(c: &reqwest::Client, game: &str, loader: Loader) -> Result<String> {
    if loader == Loader::Vanilla {
        return Ok(String::new());
    }
    let list = builds(c, game, loader).await?;
    list.iter().find(|b| b.stable).or(list.first()).map(|b| b.version.clone()).ok_or_else(|| unsupported(loader, game))
}

pub fn profile(loader: Loader, game: &str, v: &str) -> Profile {
    match loader {
        Loader::Vanilla => Profile::None,
        Loader::Fabric | Loader::Quilt => {
            Profile::Url(format!("{}/versions/loader/{game}/{v}/profile/json", meta_base(loader).unwrap_or_default()))
        }
        Loader::LiteLoader => Profile::Url(format!("{LITELOADER_META}/{v}.json")),
        Loader::Forge => Profile::Installer { url: format!("{FORGE_MAVEN}/{game}-{v}/forge-{game}-{v}-installer.jar"), id: format!("{game}-forge-{v}") },
        Loader::NeoForge => Profile::Installer { url: format!("{NEOFORGE_MAVEN}/{v}/neoforge-{v}-installer.jar"), id: format!("neoforge-{v}") },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neoforge_prefixes() {
        assert_eq!(neoforge_prefix("1.21.1"), "21.1.");
        assert_eq!(neoforge_prefix("1.21"), "21.0.");
        assert_eq!(neoforge_prefix("26.1"), "26.1.0.");
        assert_eq!(neoforge_prefix("26.1.1"), "26.1.1.");
    }

    #[test]
    fn neoforge_games_round_trip() {
        for (v, game) in [("21.1.264", "1.21.1"), ("21.0.167", "1.21"), ("20.2.3-beta", "1.20.2"), ("26.1.0.5", "26.1"), ("26.1.1.2", "26.1.1")] {
            assert_eq!(neoforge_game(v).as_deref(), Some(game));
            assert!(v.starts_with(&neoforge_prefix(game)), "{v} vs {game}");
        }
        assert_eq!(neoforge_game("0.25w14craftmine.3-beta"), None);
    }

    #[test]
    fn versions_sort_numerically() {
        let mut v = ["0.20.0-beta.9", "0.24.0", "0.9.1", "0.24.0-beta.2", "0.29.1"];
        v.sort_by(|a, b| cmp_version(b, a));
        assert_eq!(v, ["0.29.1", "0.24.0", "0.24.0-beta.2", "0.20.0-beta.9", "0.9.1"]);
        assert!(cmp_version("14.23.5.2859", "14.23.5.2851").is_gt());
    }
}
