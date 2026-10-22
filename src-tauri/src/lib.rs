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
        // `modicon://localhost/<instance id>/<jar file>` -> the icon packed inside that mod jar.
        .register_asynchronous_uri_scheme_protocol("modicon", |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let path = percent_encoding::percent_decode_str(req.uri().path()).decode_utf8_lossy().into_owned();
                let icon = path
                    .trim_start_matches('/')
                    .split_once('/')
                    .ok_or(())
                    .and_then(|(id, file)| services::mods::icon(&app.state::<state::AppState>(), id, file).map_err(|_| ()));
                let res = match icon {
                    Ok((bytes, mime)) => tauri::http::Response::builder().header("Content-Type", mime).body(bytes),
                    Err(()) => tauri::http::Response::builder().status(404).body(Vec::new()),
                };
                responder.respond(res.expect("static response parts"));
            });
        })
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
            commands::instances::import_modpack,
            commands::instances::rename_instance,
            commands::instances::set_instance_icon,
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
