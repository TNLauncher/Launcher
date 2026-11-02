//! Use cases. Commands call these; these call `minecraft` and `storage`.

pub mod account;
pub mod content;
pub mod discord;
pub mod export;
pub mod favorites;
pub mod repair;
pub mod instances;
pub mod launcher;
pub mod logs;
pub mod modpacks;
pub mod runtime;
pub mod screenshots;
pub mod worlds;
pub mod skins;

/// Unix time in seconds.
pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()
}
