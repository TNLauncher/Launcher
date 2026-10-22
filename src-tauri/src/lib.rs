//! TNLauncher backend.
//!
//! Layers, top to bottom:
//! - `commands`  — thin `#[tauri::command]` adapters: parse IPC input, call a service.
//! - `services`  — use cases (create instance, launch, manage mods); own all side effects.
//! - `minecraft` — protocol knowledge: Mojang/Fabric/Quilt metadata, installs, JVM command.
//! - `storage`   — JSON persistence of settings and instances.
//! - `models`, `state`, `error` — shared types; `config` — build-time `TN_*` settings from .env.

pub mod commands;
pub mod config;
pub mod error;
pub mod minecraft;
pub mod models;
pub mod services;
pub mod state;
pub mod storage;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            app.manage(state::AppState::new(root)?);
            app.manage(services::discord::Discord::spawn());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::get_state,
            commands::settings::save_settings,
            commands::net::fetch_json,
            commands::account::microsoft_login,
            commands::account::microsoft_logout,
            commands::instances::create_instance,
            commands::instances::rename_instance,
            commands::instances::delete_instance,
            commands::instances::open_instance_dir,
            commands::game::launch,
            commands::mods::list_mods,
            commands::mods::toggle_mod,
            commands::mods::delete_mod,
            commands::mods::install_mod,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TNLauncher");
}
