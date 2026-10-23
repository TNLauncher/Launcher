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
    /// Modpack the instance was created from; `None` = made by hand.
    pub pack: Option<PackRef>,
    /// Pre-plugin builds stored a Modrinth project here; read once and moved into `pack`.
    #[serde(skip_serializing)]
    pub(crate) modpack_id: String,
    #[serde(skip_serializing)]
    pub(crate) modpack_version: String,
}

impl Instance {
    /// Moves the pre-plugin Modrinth fields into `pack`.
    pub fn migrate(&mut self) {
        if self.pack.is_none() && !self.modpack_id.is_empty() {
            let project = std::mem::take(&mut self.modpack_id);
            self.pack = Some(PackRef { source: "modrinth".into(), project, version: std::mem::take(&mut self.modpack_version) });
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackRef {
    /// Content source plugin id.
    pub source: String,
    pub project: String,
    /// Version number as shown to the user.
    pub version: String,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Screenshot {
    pub file: String,
    pub size: u64,
    /// Unix seconds of the file's last change.
    pub taken: u64,
}

#[cfg(test)]
mod tests {
    #[test]
    fn migrates_modrinth_fields() {
        let mut i: super::Instance = serde_json::from_str(r#"{"id":"a","modpackId":"P1","modpackVersion":"2.0"}"#).unwrap();
        i.migrate();
        assert_eq!(i.pack, Some(super::PackRef { source: "modrinth".into(), project: "P1".into(), version: "2.0".into() }));
        let json = serde_json::to_string(&i).unwrap();
        assert!(!json.contains("modpackId"), "{json}");
        let mut plain: super::Instance = serde_json::from_str(r#"{"id":"b","modpackId":""}"#).unwrap();
        plain.migrate();
        assert_eq!(plain.pack, None);
    }
}
