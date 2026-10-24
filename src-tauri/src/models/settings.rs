use super::InstanceSettings;
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
        }
    }
}

impl Settings {
    /// These settings with an instance's overrides applied.
    pub fn for_instance(&self, o: &InstanceSettings) -> Self {
        Self {
            java_path: o.java_path.clone().unwrap_or_else(|| self.java_path.clone()),
            ram_mb: o.ram_mb.unwrap_or(self.ram_mb),
            jvm_args: o.jvm_args.clone().unwrap_or_else(|| self.jvm_args.clone()),
            width: o.width.unwrap_or(self.width),
            height: o.height.unwrap_or(self.height),
            fullscreen: o.fullscreen.unwrap_or(self.fullscreen),
            ..self.clone()
        }
    }
}
