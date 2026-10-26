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
    // WebKitGTK's DMABUF renderer shows a stale frame when an opacity/transform/filter animation
    // or transition ends, so every animation flashes its start state. Keep a user's own setting.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        // SAFETY: runs first in `run`, before Tauri or WebKit start any threads.
        unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            let state = state::AppState::new(root)?;
            let handle = app.handle().clone();
            let bridge = plugins::js::Bridge::new(move |call| {
                let _ = handle.emit_to("main", "plugin-call", call);
            });
            let bundled = app.path().resource_dir()?.join("plugins");
            *state.plugins.write().unwrap() = plugins::Registry::load(&[(bundled, true), (state.paths.plugins_dir(), false)], std::sync::Arc::new(bridge));
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
            commands::mods::list_content,
            commands::mods::identify_content,
            commands::mods::toggle_content,
            commands::mods::delete_content,
            commands::mods::install_content,
            commands::plugins::list_plugins,
            commands::plugins::reload_plugins,
            commands::plugins::remove_plugin,
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

