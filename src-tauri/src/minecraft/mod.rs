//! Everything that knows how Minecraft is distributed and started.
//! No Tauri types in here: the module is usable from tests and other frontends.

pub mod auth;
pub mod command;
pub mod http;
pub mod install;
pub mod installer;
pub mod java;
pub mod loader;
pub mod rules;
pub mod version;

use serde::Serialize;

/// Install/launch phases reported to the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Resolving,
    Java,
    Loader,
    Libraries,
    Assets,
    Starting,
}

/// Progress callback: `(stage, done, total)`; `total == 0` means indeterminate.
pub type Progress<'a> = &'a (dyn Fn(Stage, usize, usize) + Sync);
