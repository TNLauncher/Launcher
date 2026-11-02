//! `tn.content`: an instance's mods, resource packs and shaders. Hashing and identifying need `instances`;
//! installing, switching and deleting need `content` too, and wait until the game is closed.
use super::{params, Cx};
use crate::error::{AppError, Result};
use crate::models::ContentKind;
use crate::plugins::HashAlgo;
use crate::services::content;
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Files {
    instance: String,
    kind: ContentKind,
    /// `content.identify` only.
    source: Option<String>,
}

#[derive(Deserialize)]
struct Install {
    instance: String,
    source: String,
    kind: ContentKind,
    project: String,
    version: Option<String>,
    replace: Option<String>,
}

#[derive(Deserialize)]
struct File {
    instance: String,
    kind: ContentKind,
    file: String,
    #[serde(default)]
    enabled: Option<bool>,
}

pub async fn handle(cx: &Cx<'_>, method: &str, p: Value) -> Result<Value> {
    let state = cx.state;
    if matches!(method, "content.install" | "content.setEnabled" | "content.delete") && p.get("instance").and_then(Value::as_str).is_some_and(|id| state.is_running(id)) {
        return Err(AppError::Conflict("Close the game first".into()));
    }
    match method {
        "content.hashes" => {
            let f: Files = params(p)?;
            Ok(serde_json::to_value(content::hashes(state, &f.instance, f.kind, HashAlgo::Sha1)?)?)
        }
        "content.identify" => {
            let f: Files = params(p)?;
            let source = f.source.ok_or_else(|| AppError::Invalid("Missing source".into()))?;
            let algo = crate::plugins::enabled(state, &source)?.manifest.contributes.source.as_ref().map(|s| s.hash).unwrap_or_default();
            let hashes = content::hashes(state, &f.instance, f.kind, algo)?;
            Ok(serde_json::to_value(content::identify(state, &source, hashes).await?)?)
        }
        "content.install" => {
            let i: Install = params(p)?;
            // Projects already installed, so the new one's dependencies are not added twice.
            let skip = if i.kind == ContentKind::Mod { content::installed_projects(state, &i.source, &i.instance).await?.0 } else { vec![] };
            content::install(state, &i.source, &i.instance, i.kind, &i.project, i.version.as_deref(), i.replace.as_deref(), &skip).await?;
            Ok(Value::Null)
        }
        "content.setEnabled" => {
            let f: File = params(p)?;
            let want = f.enabled.ok_or_else(|| AppError::Invalid("Missing enabled".into()))?;
            let now = content::list(state, &f.instance, f.kind)?.into_iter().find(|x| x.file == f.file).ok_or_else(|| AppError::NotFound(format!("No file {}", f.file)))?;
            if now.enabled != want {
                content::toggle(state, &f.instance, f.kind, &f.file)?;
            }
            Ok(Value::Null)
        }
        "content.delete" => {
            let f: File = params(p)?;
            content::delete(state, &f.instance, f.kind, &f.file)?;
            Ok(Value::Null)
        }
        _ => super::unknown(method),
    }
}
