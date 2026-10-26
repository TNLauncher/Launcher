//! What a mod jar says about itself: ids, version, required mods and conflicts.
//! Each loader reads its own metadata file, so a jar is read the way the instance's loader would read it.
use crate::models::Loader;
use serde::Serialize;
use serde_json::Value;
use std::io::{Cursor, Read, Seek};
use zip::ZipArchive;

/// Bundled jars inside bundled jars: Fabric API nests one level, a few mods two.
const MAX_DEPTH: u32 = 3;

/// A version requirement as the mod wrote it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "lowercase")]
pub enum Range {
    Any,
    /// Fabric/Quilt: any of these predicates, each a space-separated AND (`>=1.2 <2`).
    Fabric(Vec<String>),
    /// Forge/NeoForge maven range: `[1.2,2)`, `[1.2,)`, a bare version is only a recommendation.
    Maven(String),
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Dep {
    pub id: String,
    pub range: Range,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModMeta {
    pub id: String,
    pub name: String,
    pub version: String,
    /// Other ids the jar answers to, with versions: its `provides` and the jars bundled inside it.
    pub provides: Vec<(String, String)>,
    pub depends: Vec<Dep>,
    pub breaks: Vec<Dep>,
    /// Mixin configs at the jar root, to tie a failing mixin to its mod.
    pub mixins: Vec<String>,
}

#[derive(Debug)]
pub enum Scan {
    Mod(ModMeta),
    /// A mod for another loader, named for the user.
    Foreign(&'static str),
    /// No metadata: a library, a Forge 1.12 coremod, or not a jar at all.
    Unknown,
}

/// Reads a jar the way `loader` would. Errors only when the file is not a readable zip.
pub fn scan<R: Read + Seek>(jar: R, loader: Loader) -> zip::result::ZipResult<Scan> {
    let mut zip = ZipArchive::new(jar)?;
    Ok(scan_zip(&mut zip, loader, 0))
}

fn scan_zip<R: Read + Seek>(zip: &mut ZipArchive<R>, loader: Loader, depth: u32) -> Scan {
    let fabric = text(zip, "fabric.mod.json");
    let quilt = text(zip, "quilt.mod.json");
    let neo = text(zip, "META-INF/neoforge.mods.toml");
    let forge = text(zip, "META-INF/mods.toml");
    let legacy = text(zip, "mcmod.info");
    let meta = match loader {
        Loader::Fabric => fabric.as_deref().and_then(parse_fabric),
        Loader::Quilt => quilt.as_deref().and_then(parse_quilt).or_else(|| fabric.as_deref().and_then(parse_fabric)),
        Loader::Forge => forge.as_deref().map(|t| parse_toml(t, zip)).or_else(|| legacy.as_deref().and_then(parse_mcmod)),
        Loader::NeoForge => neo.or(forge).as_deref().map(|t| parse_toml(t, zip)),
        Loader::Vanilla | Loader::LiteLoader => None,
    };
    let Some(mut meta) = meta else {
        let foreign = if fabric.is_some() {
            "Fabric"
        } else if quilt.is_some() {
            "Quilt"
        } else if text(zip, "META-INF/neoforge.mods.toml").is_some() {
            "NeoForge"
        } else if text(zip, "META-INF/mods.toml").is_some() || legacy.is_some() {
            "Forge"
        } else {
            return Scan::Unknown;
        };
        return Scan::Foreign(foreign);
    };
    if depth < MAX_DEPTH {
        for path in nested(zip, fabric.as_deref(), quilt.as_deref()) {
            let Some(bytes) = raw(zip, &path) else { continue };
            let Ok(mut inner) = ZipArchive::new(Cursor::new(bytes)) else { continue };
            if let Scan::Mod(m) = scan_zip(&mut inner, loader, depth + 1) {
                meta.provides.push((m.id, m.version));
                meta.provides.extend(m.provides);
            }
        }
    }
    meta.mixins = (0..zip.len())
        .filter_map(|i| zip.name_for_index(i).map(String::from))
        .filter(|n| !n.contains('/') && n.ends_with(".json") && n.contains("mixins"))
        .collect();
    Scan::Mod(meta)
}

fn text<R: Read + Seek>(zip: &mut ZipArchive<R>, name: &str) -> Option<String> {
    let mut s = String::new();
    zip.by_name(name).ok()?.read_to_string(&mut s).ok()?;
    Some(s)
}

fn raw<R: Read + Seek>(zip: &mut ZipArchive<R>, name: &str) -> Option<Vec<u8>> {
    let mut b = Vec::new();
    zip.by_name(name).ok()?.read_to_end(&mut b).ok()?;
    Some(b)
}

/// Paths of the jars bundled inside: Fabric `jars`, Quilt `quilt_loader.jars`, Forge/NeoForge Jar-in-Jar.
fn nested<R: Read + Seek>(zip: &mut ZipArchive<R>, fabric: Option<&str>, quilt: Option<&str>) -> Vec<String> {
    let json = |t: Option<&str>| t.and_then(|t| serde_json::from_str::<Value>(t).ok()).unwrap_or(Value::Null);
    let mut out: Vec<String> = json(fabric)["jars"].as_array().into_iter().flatten().filter_map(|j| j["file"].as_str().map(String::from)).collect();
    out.extend(json(quilt)["quilt_loader"]["jars"].as_array().into_iter().flatten().filter_map(|j| j.as_str().map(String::from)));
    let jij = json(text(zip, "META-INF/jarjar/metadata.json").as_deref());
    out.extend(jij["jars"].as_array().into_iter().flatten().filter_map(|j| j["path"].as_str().map(String::from)));
    out
}

fn str_of(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

fn fabric_deps(v: &Value) -> Vec<Dep> {
    v.as_object()
        .into_iter()
        .flatten()
        .map(|(id, r)| {
            let preds: Vec<String> = match r {
                Value::String(s) => vec![s.clone()],
                Value::Array(a) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
                _ => vec![],
            };
            Dep { id: id.clone(), range: if preds.is_empty() || preds.iter().any(|p| p.trim() == "*") { Range::Any } else { Range::Fabric(preds) } }
        })
        .collect()
}

fn parse_fabric(text: &str) -> Option<ModMeta> {
    let v: Value = serde_json::from_str(text).ok()?;
    let id = v["id"].as_str()?.to_string();
    Some(ModMeta {
        name: v["name"].as_str().map_or_else(|| id.clone(), String::from),
        version: str_of(&v["version"]),
        provides: v["provides"].as_array().into_iter().flatten().filter_map(|p| p.as_str()).map(|p| (p.to_string(), str_of(&v["version"]))).collect(),
        depends: fabric_deps(&v["depends"]),
        breaks: fabric_deps(&v["breaks"]),
        id,
        ..Default::default()
    })
}

/// Quilt lists dependencies as `"id"` or `{ id, versions, optional }`.
fn quilt_deps(v: &Value) -> Vec<Dep> {
    v.as_array()
        .into_iter()
        .flatten()
        .filter_map(|d| match d {
            Value::String(id) => Some(Dep { id: id.clone(), range: Range::Any }),
            Value::Object(o) if o.get("optional").and_then(Value::as_bool) != Some(true) => {
                let preds: Vec<String> = match o.get("versions") {
                    Some(Value::String(s)) => vec![s.clone()],
                    Some(Value::Array(a)) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
                    _ => vec![],
                };
                let id = o.get("id")?.as_str()?.split(':').next_back()?.to_string();
                Some(Dep { id, range: if preds.is_empty() { Range::Any } else { Range::Fabric(preds) } })
            }
            _ => None,
        })
        .collect()
}

fn parse_quilt(text: &str) -> Option<ModMeta> {
    let v: Value = serde_json::from_str(text).ok()?;
    let q = &v["quilt_loader"];
    let id = q["id"].as_str()?.to_string();
    let version = str_of(&q["version"]);
    Some(ModMeta {
        name: q["metadata"]["name"].as_str().map_or_else(|| id.clone(), String::from),
        provides: q["provides"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|p| match p {
                Value::String(s) => Some((s.clone(), version.clone())),
                o => Some((o["id"].as_str()?.to_string(), o["version"].as_str().map_or_else(|| version.clone(), String::from))),
            })
            .collect(),
        depends: quilt_deps(&q["depends"]),
        breaks: quilt_deps(&q["breaks"]),
        version,
        id,
        ..Default::default()
    })
}

/// Forge 1.12 `mcmod.info`: a list of mods, or `{ modList: [...] }`. No dependencies worth trusting.
fn parse_mcmod(text: &str) -> Option<ModMeta> {
    let v: Value = serde_json::from_str(text).ok()?;
    let first = v.as_array().or_else(|| v["modList"].as_array())?.first()?;
    let id = first["modid"].as_str()?.to_string();
    Some(ModMeta { name: first["name"].as_str().map_or_else(|| id.clone(), String::from), version: str_of(&first["version"]), id, ..Default::default() })
}

/// Tables of a TOML file as `(header, key/value pairs)`, in order. Only what `mods.toml` uses:
/// `[[array]]` and `[table]` headers, string/bool/number values, `'''` multi-line strings.
fn toml_tables(text: &str) -> Vec<(String, Vec<(String, String)>)> {
    let mut tables: Vec<(String, Vec<(String, String)>)> = vec![(String::new(), vec![])];
    let mut lines = text.lines();
    while let Some(line) = lines.next() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') {
            let name = line.trim_start_matches('[').split(']').next().unwrap_or_default().trim();
            tables.push((name.to_string(), vec![]));
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        let value = value.trim();
        let value = if let Some(q) = ["'''", "\"\"\""].into_iter().find(|q| value.starts_with(q)) {
            let mut body = value[3..].to_string();
            while !body.contains(q) {
                match lines.next() {
                    Some(l) => body = body + "\n" + l,
                    None => break,
                }
            }
            body.split(q).next().unwrap_or_default().to_string()
        } else if let Some(q) = value.chars().next().filter(|c| *c == '"' || *c == '\'') {
            value[1..].split(q).next().unwrap_or_default().to_string()
        } else {
            value.split('#').next().unwrap_or_default().trim().to_string()
        };
        if let Some(t) = tables.last_mut() {
            t.1.push((key.trim().trim_matches('"').to_string(), value));
        }
    }
    tables
}

fn parse_toml<R: Read + Seek>(text: &str, zip: &mut ZipArchive<R>) -> ModMeta {
    let tables = toml_tables(text);
    let get = |kv: &[(String, String)], k: &str| kv.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone());
    // `${file.jarVersion}` is filled from the manifest at build time; some jars leave it to the loader.
    let jar_version = text_manifest_version(zip);
    let version_of = |kv: &[(String, String)]| {
        let v = get(kv, "version").unwrap_or_default();
        if v.contains("${") { jar_version.clone().unwrap_or_default() } else { v }
    };
    let mods: Vec<&Vec<(String, String)>> = tables.iter().filter(|(n, _)| n == "mods").map(|(_, kv)| kv).collect();
    let mut meta = ModMeta::default();
    for (i, kv) in mods.iter().enumerate() {
        let Some(id) = get(kv, "modId") else { continue };
        if i == 0 {
            meta.name = get(kv, "displayName").unwrap_or_else(|| id.clone());
            meta.version = version_of(kv);
            meta.id = id;
        } else {
            meta.provides.push((id, version_of(kv)));
        }
    }
    for (name, kv) in &tables {
        if !name.starts_with("dependencies.") {
            continue;
        }
        let Some(id) = get(kv, "modId") else { continue };
        if get(kv, "side").is_some_and(|s| s.eq_ignore_ascii_case("server")) {
            continue;
        }
        let range = get(kv, "versionRange").map_or(Range::Any, |r| if r.trim().is_empty() || r.trim() == "*" { Range::Any } else { Range::Maven(r) });
        let kind = get(kv, "type").map(|t| t.to_lowercase());
        let dep = Dep { id, range };
        match kind.as_deref() {
            Some("required") => meta.depends.push(dep),
            Some("incompatible") => meta.breaks.push(dep),
            None if get(kv, "mandatory").as_deref() == Some("true") => meta.depends.push(dep),
            _ => {}
        }
    }
    meta
}

fn text_manifest_version<R: Read + Seek>(zip: &mut ZipArchive<R>) -> Option<String> {
    text(zip, "META-INF/MANIFEST.MF")?
        .lines()
        .find_map(|l| l.strip_prefix("Implementation-Version:"))
        .map(|v| v.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn jar(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, body) in files {
            z.start_file(*name, SimpleFileOptions::default()).unwrap();
            z.write_all(body).unwrap();
        }
        z.finish().unwrap().into_inner()
    }

    #[test]
    fn reads_fabric_with_bundled_jars() {
        let inner = jar(&[("fabric.mod.json", br#"{"id":"fabric-api-base","version":"0.4.1"}"#)]);
        let outer = jar(&[
            ("fabric.mod.json", br#"{"id":"fabric-api","name":"Fabric API","version":"0.92.0","provides":["fabric"],"depends":{"fabricloader":">=0.14","minecraft":["1.20.1"]},"breaks":{"optifabric":"<1.13"},"jars":[{"file":"META-INF/jars/base.jar"}]}"#),
            ("META-INF/jars/base.jar", &inner),
            ("fabric-api.mixins.json", b"{}"),
        ]);
        let Scan::Mod(m) = scan(Cursor::new(outer.clone()), Loader::Fabric).unwrap() else { panic!() };
        assert_eq!((m.id.as_str(), m.name.as_str(), m.version.as_str()), ("fabric-api", "Fabric API", "0.92.0"));
        assert!(m.provides.contains(&("fabric".into(), "0.92.0".into())));
        assert!(m.provides.contains(&("fabric-api-base".into(), "0.4.1".into())), "bundled jars provide their ids");
        assert_eq!(m.depends.len(), 2);
        assert_eq!(m.breaks[0], Dep { id: "optifabric".into(), range: Range::Fabric(vec!["<1.13".into()]) });
        assert_eq!(m.mixins, ["fabric-api.mixins.json"]);
        assert!(matches!(scan(Cursor::new(outer), Loader::Forge).unwrap(), Scan::Foreign("Fabric")));
    }

    #[test]
    fn reads_forge_toml() {
        let toml = r#"
modLoader="javafml" # the loader
loaderVersion="[47,)"
[[mods]]
modId="walkers"
version="${file.jarVersion}"
displayName="Walkers"
description='''
A mod. [not a table]
version = "nope"
'''
[[dependencies.walkers]]
    modId="forge"
    mandatory=true
    versionRange="[47,)"
[[dependencies.walkers]]
    modId="craftedcore"
    mandatory=true
    versionRange="[5.8.1,)"
    side="BOTH"
[[dependencies.walkers]]
    modId="jei"
    mandatory=false
[[dependencies.walkers]]
    modId="servercore"
    mandatory=true
    side="SERVER"
[[dependencies.walkers]]
    modId="optifine"
    type="incompatible"
"#;
        let bytes = jar(&[("META-INF/mods.toml", toml.as_bytes()), ("META-INF/MANIFEST.MF", b"Manifest-Version: 1.0\r\nImplementation-Version: 3.1\r\n")]);
        let Scan::Mod(m) = scan(Cursor::new(bytes.clone()), Loader::Forge).unwrap() else { panic!() };
        assert_eq!((m.id.as_str(), m.name.as_str(), m.version.as_str()), ("walkers", "Walkers", "3.1"));
        assert_eq!(m.depends.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(), ["forge", "craftedcore"]);
        assert_eq!(m.breaks[0].id, "optifine");
        assert!(matches!(scan(Cursor::new(bytes), Loader::NeoForge).unwrap(), Scan::Mod(_)), "NeoForge before 1.20.5 reads mods.toml");
        assert!(matches!(scan(Cursor::new(jar(&[("a.class", b"")])), Loader::Fabric).unwrap(), Scan::Unknown));
        assert!(scan(Cursor::new(b"not a zip".to_vec()), Loader::Fabric).is_err());
    }
}
