//! `tn.instances`: reading instances (needs `instances`), and repairing or changing them (needs `content` too).
use super::{params, Cx, Id};
use crate::error::Result;
use crate::models::Instance;
use crate::services::{content, export, instances, logs, repair};
use crate::state::AppState;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{Emitter, Manager};

#[derive(Deserialize)]
struct Export {
    id: String,
    spec: export::Spec,
}

#[derive(Deserialize)]
struct Files {
    id: String,
    dir: String,
}

#[derive(Deserialize)]
struct Change {
    id: String,
    change: instances::Change,
}

pub async fn handle(cx: &Cx<'_>, method: &str, p: Value) -> Result<Value> {
    let state = cx.state;
    match method {
        "instances.list" => with_mods(state, instances::list(state)),
        "instances.get" => {
            let one = vec![instances::get(state, &params::<Id>(p)?.id)?];
            Ok(with_mods(state, one)?.as_array_mut().and_then(|a| a.pop()).unwrap_or(Value::Null))
        }
        "instances.readLog" => Ok(Value::String(logs::read_log(state, &params::<Id>(p)?.id)?)),
        "instances.crashReports" => Ok(Value::String(logs::crash_reports(state, &params::<Id>(p)?.id)?)),
        "instances.files" => {
            let Files { id, dir } = params(p)?;
            Ok(serde_json::to_value(file_names(&cx.state.paths.instance_dir(&id)?.join(crate::paths::safe_rel(&dir)?))?)?)
        }
        "instances.mods" => Ok(serde_json::to_value(content::scan_mods(state, &params::<Id>(p)?.id)?)?),
        "instances.missingFiles" => Ok(serde_json::to_value(repair::missing_files(state, &params::<Id>(p)?.id).await?)?),
        "instances.launchSettings" => Ok(serde_json::to_value(instances::launch_facts(state, &params::<Id>(p)?.id)?)?),
        "instances.export" => export_to_file(cx, params(p)?).await,
        "instances.repair" => {
            let id = params::<Id>(p)?.id;
            let plugin = &cx.plugin.manifest.id;
            // Progress goes to this plugin's frames as the `repair-progress` event.
            let report = repair::repair(cx.app, &id, &|progress| {
                let _ = cx.app.emit(crate::events::PLUGIN_EVENT, json!({ "plugin": plugin, "name": "repair-progress", "payload": { "instance": id, "progress": progress } }));
            })
            .await?;
            Ok(serde_json::to_value(report)?)
        }
        "instances.restoreFiles" => Ok(repair::restore_files(state, &params::<Id>(p)?.id).await?.into()),
        "instances.change" => {
            let c: Change = params(p)?;
            Ok(Value::String(instances::change(state, &c.id, c.change).await?))
        }
        _ => super::unknown(method),
    }
}

/// Instances as plugins see them: plus `mods`, the number of enabled mod jars; minus launch settings (env may hold secrets).
fn with_mods(state: &AppState, list: Vec<Instance>) -> Result<Value> {
    let counts = instances::mod_counts(state, &list);
    let mut v = serde_json::to_value(&list)?;
    for i in v.as_array_mut().into_iter().flatten() {
        let n = i["id"].as_str().and_then(|id| counts.get(id)).copied().unwrap_or(0);
        i["mods"] = n.into();
        i.as_object_mut().map(|o| o.remove("settings"));
    }
    Ok(v)
}

/// The user picks where the archive goes; the plugin never names a path. `null` when the user cancels.
async fn export_to_file(cx: &Cx<'_>, Export { id, spec }: Export) -> Result<Value> {
    use tauri_plugin_dialog::DialogExt;
    instances::get(cx.state, &id)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = cx.app.dialog().file().set_file_name(&spec.file_name);
    if let Some((_, ext)) = spec.file_name.rsplit_once('.') {
        dialog = dialog.add_filter(ext, &[ext]);
    }
    dialog.save_file(move |p| drop(tx.send(p)));
    let Some(dest) = rx.await.ok().flatten().and_then(|p| p.into_path().ok()) else { return Ok(Value::Null) };
    let (handle, out) = (cx.app.clone(), dest.clone());
    tauri::async_runtime::spawn_blocking(move || export::write(&handle.state::<AppState>(), &id, &spec, &out)).await??;
    Ok(Value::String(dest.to_string_lossy().into()))
}

/// Names of the files in `dir`, sorted; none when it doesn't exist.
fn file_names(dir: &std::path::Path) -> Result<Vec<String>> {
    let Ok(read) = std::fs::read_dir(dir) else { return Ok(vec![]) };
    let mut names = vec![];
    for e in read {
        let e = e?;
        if e.file_type()?.is_file() {
            names.push(e.file_name().to_string_lossy().into_owned());
        }
    }
    names.sort();
    Ok(names)
}
