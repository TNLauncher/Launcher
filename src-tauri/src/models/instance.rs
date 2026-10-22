use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Loader {
    #[default]
    Vanilla,
    Fabric,
    Quilt,
}

/// A separate game directory with its own version, loader, mods and worlds.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub version: String,
    pub loader: Loader,
    pub loader_version: String,
    /// Unix seconds, 0 = never.
    pub last_played: u64,
    pub play_seconds: u64,
    /// Unix seconds; 0 for instances made before this field existed.
    pub created: u64,
    /// `data:image/...` URL picked by the user; empty = loader icon.
    pub icon: String,
    /// Modrinth project the instance was created from; empty = made by hand.
    pub modpack_id: String,
    pub modpack_version: String,
}

/// Files the player adds to an instance; each kind has its own folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContentKind {
    Mod,
    Resourcepack,
    Shader,
}

impl ContentKind {
    pub fn dir(self) -> &'static str {
        match self {
            Self::Mod => "mods",
            Self::Resourcepack => "resourcepacks",
            Self::Shader => "shaderpacks",
        }
    }

    pub fn ext(self) -> &'static str {
        match self {
            Self::Mod => ".jar",
            Self::Resourcepack | Self::Shader => ".zip",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModFile {
    pub file: String,
    pub enabled: bool,
    pub size: u64,
}
