//! `tn.sources`: catalogs are public, so any plugin may browse the enabled sources.
use super::{params, Cx};
use crate::error::Result;
use crate::plugins::api::{SearchQuery, VersionFilter};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Search {
    source: String,
    query: SearchQuery,
}

#[derive(Deserialize)]
struct Versions {
    source: String,
    project: String,
    filter: VersionFilter,
}

pub async fn handle(cx: &Cx<'_>, method: &str, p: Value) -> Result<Value> {
    match method {
        "sources.search" => {
            let s: Search = params(p)?;
            Ok(serde_json::to_value(crate::plugins::enabled(cx.state, &s.source)?.source()?.search(&s.query).await?)?)
        }
        "sources.versions" => {
            let v: Versions = params(p)?;
            Ok(serde_json::to_value(crate::plugins::enabled(cx.state, &v.source)?.source()?.versions(&v.project, &v.filter).await?)?)
        }
        _ => super::unknown(method),
    }
}
