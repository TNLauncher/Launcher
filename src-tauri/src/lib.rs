//! TNLauncher backend: a small core that installs and runs Minecraft, and a plugin host that lets
//! sandboxed JS plugins add the rest (content sources, accounts, importers, runtimes, pages).
//!
//! Layers, top to bottom:
//! - `commands`  — thin `#[tauri::command]` adapters: parse IPC input, call a service.
//! - `services`  — use cases by domain (instances, content, launcher, logs, modpacks, repair...); own all side effects.
//! - `plugins`   — the plugin host: manifests and registry, calls into plugin frames (`remote`), requests from them (`host`).
//! - `minecraft` — protocol knowledge: Mojang and mod loader metadata, installs, JVM command. No Tauri types.
//! - `storage`   — JSON persistence of settings and instances; `paths` — the on-disk layout and untrusted-path checks.
//! - `models`, `state`, `error`, `events` — shared types; `config` — build-time `TN_*` settings from .env.

pub mod commands;
pub mod config;
pub mod error;
pub mod events;
pub mod minecraft;
pub mod models;
pub mod paths;
pub mod plugins;
pub mod services;
pub mod state;
pub mod storage;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // `plugin://localhost/<id>/<file>`: a plugin's files, with the SDK and a CSP built from its manifest.
        .register_asynchronous_uri_scheme_protocol("plugin", |ctx, req, responder| plugins::host::protocol(ctx.app_handle().clone(), req.uri().path(), responder))
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            let state = state::AppState::new(root)?;
            let handle = app.handle().clone();
            let bridge = plugins::bridge::Bridge::new(move |call| {
                let _ = handle.emit_to("main", events::PLUGIN_CALL, call);
            });
            let bundled = app.path().resource_dir()?.join("plugins");
            *state.plugins.write().unwrap() = plugins::Registry::load(&[(bundled, true), (state.paths.plugins_dir(), false)], storage::load_disabled_plugins(&state), std::sync::Arc::new(bridge));
            app.manage(state);
            app.manage(services::discord::Discord::spawn());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::get_state,
            commands::settings::save_settings,
            commands::net::fetch_json,
            commands::favorites::list_favorites,
            commands::favorites::set_favorite,
            commands::account::list_accounts,
            commands::account::select_account,
            commands::account::remove_account,
            commands::account::microsoft_login,
            commands::account::plugin_login,
            commands::account::account_skin,
            commands::instances::create_instance,
            commands::instances::create_runtime_instance,
            commands::instances::runtime_versions,
            commands::instances::loader_games,
            commands::instances::loader_builds,
            commands::instances::import_modpack,
            commands::instances::import_modpack_file,
            commands::instances::cancel_modpack_import,
            commands::instances::rename_instance,
            commands::instances::set_instance_icon,
            commands::instances::set_instance_settings,
            commands::instances::copy_instance,
            commands::instances::set_instance_group,
            commands::instances::delete_instance,
            commands::instances::open_instance_dir,
            commands::instances::list_screenshots,
            commands::instances::delete_screenshot,
            commands::instances::screenshot_bytes,
            commands::instances::mod_icon,
            commands::instances::list_worlds,
            commands::instances::world_icon,
            commands::instances::delete_world,
            commands::instances::copy_world,
            commands::game::launch,
            commands::game::stop_game,
            commands::game::read_game_log,
            commands::game::read_crash_report,
            commands::content::list_content,
            commands::content::identify_content,
            commands::content::toggle_content,
            commands::content::delete_content,
            commands::content::install_content,
            commands::plugins::list_plugins,
            commands::plugins::reload_plugins,
            commands::plugins::remove_plugin,
            commands::plugins::plugin_store,
            commands::plugins::install_plugin,
            commands::plugins::set_plugin_enabled,
            commands::plugins::open_plugins_dir,
            commands::plugins::plugin_host_ready,
            commands::plugins::plugin_settings,
            commands::plugins::set_plugin_setting,
            commands::plugins::plugin_reply,
            commands::plugins::plugin_request,
            commands::plugins::source_search,
            commands::plugins::source_project,
            commands::plugins::source_projects,
            commands::plugins::source_versions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TNLauncher");
}

