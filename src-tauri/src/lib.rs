//! TNLauncher backend.
//!
//! Layers, top to bottom:
//! - `commands`  — thin `#[tauri::command]` adapters: parse IPC input, call a service.
//! - `services`  — use cases (create instance, launch, manage mods); own all side effects.
//! - `minecraft` — protocol knowledge: Mojang and mod loader metadata, installs, JVM command.
//! - `plugins`   — JS plugins in sandboxed frames; Rust serves them and checks what they ask for.
//! - `storage`   — JSON persistence of settings and instances.
//! - `models`, `state`, `error` — shared types; `config` — build-time `TN_*` settings from .env.

pub mod commands;
pub mod config;
pub mod error;
pub mod minecraft;
pub mod models;
pub mod plugins;
pub mod services;
pub mod state;
pub mod storage;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // `instance://localhost/<what>/<instance id>/<file>`: `modicon` -> the icon packed inside that
        // mod jar, `screenshot` -> that screenshot.
        .register_asynchronous_uri_scheme_protocol("instance", |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let path = percent_encoding::percent_decode_str(req.uri().path()).decode_utf8_lossy().into_owned();
                let state = app.state::<state::AppState>();
                let found = match path.trim_start_matches('/').splitn(3, '/').collect::<Vec<_>>()[..] {
                    ["modicon", id, file] => services::mods::icon(&state, id, file).ok(),
                    ["screenshot", id, file] => services::screenshots::read(&state, id, file).ok().map(|b| (b, "image/png")),
                    _ => None,
                };
                let res = match found {
                    Some((bytes, mime)) => tauri::http::Response::builder().header("Content-Type", mime).body(bytes),
                    None => tauri::http::Response::builder().status(404).body(Vec::new()),
                };
                responder.respond(res.expect("static response parts"));
            });
        })
        // `plugin://localhost/<id>/<file>`: a plugin's files, with the SDK and a CSP built from its manifest.
        .register_asynchronous_uri_scheme_protocol("plugin", |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let path = percent_encoding::percent_decode_str(req.uri().path()).decode_utf8_lossy().into_owned();
                let res = match plugins::host::serve(&app.state::<state::AppState>(), &path) {
                    Ok(f) => {
                        // Plugin frames are sandboxed (opaque origin), so their module scripts load cross-origin.
                        let mut b = tauri::http::Response::builder().header("Content-Type", f.mime).header("Access-Control-Allow-Origin", "*")
                            // Plugin files change on disk between runs; never serve a stale copy.
                            .header("Cache-Control", "no-store");
                        if let Some(csp) = f.csp {
                            b = b.header("Content-Security-Policy", csp);
                        }
                        b.body(f.bytes)
                    }
                    Err(_) => tauri::http::Response::builder().status(404).body(Vec::new()),
                };
                responder.respond(res.expect("static response parts"));
            });
        })
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            let mut state = state::AppState::new(root)?;
            let handle = app.handle().clone();
            let bridge = plugins::js::Bridge::new(move |call| {
                let _ = handle.emit_to("main", "plugin-call", call);
            });
            let bundled = app.path().resource_dir()?.join("plugins");
            state.plugins = plugins::Registry::load(&[(bundled, true), (state.paths.plugins_dir(), false)], std::sync::Arc::new(bridge));
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
            commands::instances::loader_games,
            commands::instances::loader_builds,
            commands::instances::import_modpack,
            commands::instances::cancel_modpack_import,
            commands::instances::rename_instance,
            commands::instances::set_instance_icon,
            commands::instances::set_instance_settings,
            commands::instances::delete_instance,
            commands::instances::open_instance_dir,
            commands::instances::list_screenshots,
            commands::instances::delete_screenshot,
            commands::game::launch,
            commands::game::stop_game,
            commands::game::read_game_log,
            commands::mods::list_content,
            commands::mods::identify_content,
            commands::mods::toggle_content,
            commands::mods::delete_content,
            commands::mods::install_content,
            commands::plugins::list_plugins,
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
