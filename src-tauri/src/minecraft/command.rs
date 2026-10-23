//! Builds the `java ...` process from a resolved version JSON.
use super::auth::Session;
use super::rules::{self, Features};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;

pub struct LaunchOptions<'a> {
    pub java: &'a Path,
    pub root: &'a Path,
    pub game_dir: &'a Path,
    pub natives: &'a Path,
    pub classpath: &'a [PathBuf],
    pub session: &'a Session,
    pub ram_mb: u32,
    pub jvm_args: &'a str,
    pub width: u32,
    pub height: u32,
    pub fullscreen: bool,
}

pub fn build(version: &Value, o: &LaunchOptions) -> Command {
    let sep = if cfg!(windows) { ";" } else { ":" };
    let classpath = o.classpath.iter().map(|p| p.to_string_lossy()).collect::<Vec<_>>().join(sep);
    let vars = json!({
        "auth_player_name": o.session.name,
        "version_name": version["id"],
        "game_directory": o.game_dir,
        "assets_root": o.root.join("assets"),
        "game_assets": o.root.join("assets"),
        "assets_index_name": version["assetIndex"]["id"],
        "auth_uuid": o.session.uuid,
        "auth_access_token": o.session.token,
        "auth_session": o.session.token,
        "clientid": "",
        "auth_xuid": "",
        "user_type": o.session.user_type,
        "user_properties": "{}",
        "version_type": version["type"],
        "resolution_width": o.width.to_string(),
        "resolution_height": o.height.to_string(),
        "natives_directory": o.natives,
        "library_directory": o.root.join("libraries"),
        "classpath_separator": sep,
        "classpath": classpath,
        "launcher_name": "TNLauncher",
        "launcher_version": env!("CARGO_PKG_VERSION"),
    });
    let substitute = |s: &str| {
        let mut out = s.to_string();
        for (k, v) in vars.as_object().unwrap() {
            let v = v.as_str().map(String::from).unwrap_or_else(|| v.to_string());
            out = out.replace(&format!("${{{k}}}"), &v);
        }
        out
    };
    let features = Features { custom_resolution: !o.fullscreen };
    let collect = |args: &Value| -> Vec<String> {
        let mut out = vec![];
        for a in args.as_array().into_iter().flatten() {
            if let Some(s) = a.as_str() {
                out.push(substitute(s));
            } else if rules::allowed(a.get("rules"), features) {
                match &a["value"] {
                    Value::String(s) => out.push(substitute(s)),
                    Value::Array(xs) => out.extend(xs.iter().filter_map(Value::as_str).map(&substitute)),
                    _ => {}
                }
            }
        }
        out
    };

    // Pre-1.13 versions use a flat `minecraftArguments` string and no JVM argument list.
    let (jvm, game) = match version.get("minecraftArguments").and_then(Value::as_str) {
        Some(legacy) => (
            vec![format!("-Djava.library.path={}", o.natives.display()), "-cp".into(), classpath.clone()],
            legacy.split_whitespace().map(substitute).collect(),
        ),
        None => (collect(&version["arguments"]["jvm"]), collect(&version["arguments"]["game"])),
    };

    let mut cmd = Command::new(o.java);
    cmd.current_dir(o.game_dir)
        .arg(format!("-Xmx{}M", o.ram_mb))
        .args(o.jvm_args.split_whitespace())
        .args(&o.session.jvm_args)
        .args(jvm)
        .arg(version["mainClass"].as_str().unwrap_or_default())
        .args(game);
    if o.fullscreen {
        cmd.arg("--fullscreen");
    }
    cmd
}
