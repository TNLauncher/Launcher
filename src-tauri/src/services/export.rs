//! Instance archives for export plugins: the plugin says what goes in, the launcher writes the zip
//! to a place the user picked, so a plugin never writes outside it.
use crate::error::{AppError, Result};
use crate::state::AppState;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Component, Path};
use zip::write::SimpleFileOptions;

/// Never part of an export: launcher bookkeeping, not the game's.
const ALWAYS_SKIP: [&str; 3] = [".natives", "launcher.log", ".pack-files.json"];

/// What `tn.instances.export` takes.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Spec {
    /// Suggested in the save dialog, e.g. `My pack.mrpack`.
    pub file_name: String,
    /// Archive folder the instance's files go under, e.g. `overrides`; "" = the archive root.
    #[serde(default)]
    pub root: String,
    /// Text files the plugin adds (manifests), by archive path.
    #[serde(default)]
    pub files: BTreeMap<String, String>,
    /// Instance paths (`saves`, `mods/a.jar`) left out, with everything under them.
    #[serde(default)]
    pub skip: Vec<String>,
}

/// Plugin paths are untrusted: plain relative components only.
fn check(path: &str) -> Result<()> {
    if Path::new(path).components().all(|c| matches!(c, Component::Normal(_))) {
        Ok(())
    } else {
        Err(AppError::Invalid(format!("Bad archive path: {path}")))
    }
}

fn skipped(rel: &str, skip: &[String]) -> bool {
    ALWAYS_SKIP.contains(&rel) || skip.iter().any(|s| rel == s || rel.strip_prefix(s.as_str()).is_some_and(|r| r.starts_with('/')))
}

/// Writes the archive to `dest`; a half-written file is removed on error.
pub fn write(state: &AppState, id: &str, spec: &Spec, dest: &Path) -> Result<()> {
    check(&spec.root)?;
    spec.files.keys().try_for_each(|k| if k.is_empty() { Err(AppError::Invalid("Empty archive path".into())) } else { check(k) })?;
    let dir = state.paths.instance_dir(id)?;
    let out = (|| {
        let mut zip = zip::ZipWriter::new(std::io::BufWriter::new(std::fs::File::create(dest)?));
        let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(true);
        for (name, text) in &spec.files {
            zip.start_file(name.as_str(), opts)?;
            zip.write_all(text.as_bytes())?;
        }
        add_dir(&mut zip, opts, &dir, "", spec)?;
        zip.finish()?.flush()?;
        Ok(())
    })();
    if out.is_err() {
        let _ = std::fs::remove_file(dest);
    }
    out
}

fn add_dir<W: Write + std::io::Seek>(zip: &mut zip::ZipWriter<W>, opts: SimpleFileOptions, dir: &Path, rel: &str, spec: &Spec) -> Result<()> {
    for entry in std::fs::read_dir(dir.join(rel))? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let rel = if rel.is_empty() { name } else { format!("{rel}/{name}") };
        if skipped(&rel, &spec.skip) {
            continue;
        }
        if entry.path().is_dir() {
            add_dir(zip, opts, dir, &rel, spec)?;
        } else {
            let path = if spec.root.is_empty() { rel } else { format!("{}/{rel}", spec.root) };
            zip.start_file(path, opts)?;
            std::io::copy(&mut std::fs::File::open(entry.path())?, zip)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn writes_what_the_spec_asks() {
        let root = std::env::temp_dir().join(format!("tn-export-{}", std::process::id()));
        let state = AppState::new(root.clone()).unwrap();
        let dir = state.paths.instance_dir("i").unwrap();
        for f in ["mods/a.jar", "mods/b.jar", "saves/w/level.dat", "options.txt", "launcher.log"] {
            std::fs::create_dir_all(dir.join(f).parent().unwrap()).unwrap();
            std::fs::write(dir.join(f), f).unwrap();
        }
        let spec: Spec = serde_json::from_value(serde_json::json!({
            "fileName": "x.mrpack", "root": "overrides",
            "files": { "modrinth.index.json": "{}" },
            "skip": ["saves", "mods/a.jar", "mod"]
        }))
        .unwrap();
        let dest = root.join("x.mrpack");
        write(&state, "i", &spec, &dest).unwrap();
        let mut zip = zip::ZipArchive::new(std::fs::File::open(&dest).unwrap()).unwrap();
        let mut names: Vec<_> = zip.file_names().map(String::from).collect();
        names.sort();
        assert_eq!(names, ["modrinth.index.json", "overrides/mods/b.jar", "overrides/options.txt"]);
        let mut s = String::new();
        zip.by_name("overrides/mods/b.jar").unwrap().read_to_string(&mut s).unwrap();
        assert_eq!(s, "mods/b.jar");

        let bad: Spec = serde_json::from_value(serde_json::json!({ "fileName": "x", "files": { "../evil": "" } })).unwrap();
        assert!(write(&state, "i", &bad, &root.join("bad.zip")).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
