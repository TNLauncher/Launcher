use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum AfterLaunch {
    #[default]
    Hide,
    Keep,
    Close,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// Empty = use the Java runtime the launcher downloads.
    pub java_path: String,
    pub ram_mb: u32,
    pub jvm_args: String,
    pub width: u32,
    pub height: u32,
    pub fullscreen: bool,
    pub after_launch: AfterLaunch,
    pub username: String,
}

pub const DEFAULT_JVM_ARGS: &str =
    "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC";

impl Default for Settings {
    fn default() -> Self {
        Self {
            java_path: String::new(),
            ram_mb: 4096,
            jvm_args: DEFAULT_JVM_ARGS.into(),
            width: 1280,
            height: 720,
            fullscreen: false,
            after_launch: AfterLaunch::Hide,
            username: "Player".into(),
        }
    }
}

impl Settings {
    /// Offline-mode name, falling back to "Player" when unset or invalid.
    pub fn player_name(&self) -> &str {
        let n = self.username.trim();
        let valid = (3..=16).contains(&n.len()) && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
        if valid {
            n
        } else {
            "Player"
        }
    }
}
