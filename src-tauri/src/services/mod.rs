//! Use cases. Commands call these; these call `minecraft` and `storage`.

pub mod account;
pub mod discord;
pub mod doctor;
pub mod instances;
pub mod launcher;
pub mod modpacks;
pub mod mods;
pub mod screenshots;
pub mod skins;

/// Unix time in seconds.
pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()
}
