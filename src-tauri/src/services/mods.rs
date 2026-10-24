//! Content files inside an instance: mod jars, resource and shader pack zips.
//! Mods are disabled by renaming to `*.disabled`, which the loaders skip. Packs stay in place:
//! the game keeps the active resource packs in `options.txt`, Iris the one active shader in
//! `config/iris.properties`. A `*.disabled` pack (older launcher builds) still lists as off.
use crate::error::{AppError, Result};
use crate::minecraft::http;
use crate::models::{ContentKind, Loader, ModFile};
use crate::plugins::{
    self,
    api::{DependencyKind, ProjectSummary, VersionFilter},
    HashAlgo,
};
use crate::services::instances;
use crate::state::AppState;
use serde::Serialize;
use sha1::{Digest, Sha1};
use std::collections::{HashMap, HashSet};
use std::path::Path;

const DISABLED: &str = ".disabled";

/// File names come from the frontend: no separators, no hidden files.
pub(crate) fn safe_file(name: &str) -> Result<&str> {
    if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
        return Err(AppError::Invalid(format!("Bad file name: {name}")));
    }
    Ok(name)
}

pub fn list(state: &AppState, id: &str, kind: ContentKind) -> Result<Vec<ModFile>> {
    let dir = state.paths.content_dir(id, kind)?;
    let Ok(entries) = std::fs::read_dir(dir) else { return Ok(vec![]) };
    let disabled_ext = format!("{}{DISABLED}", kind.ext());
    let active = active(&state.paths.instance_dir(id)?, kind)?;
    let mut files: Vec<ModFile> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| {
            let file = e.file_name().to_string_lossy().to_string();
            let present = file.ends_with(kind.ext());
            let enabled = present && active.as_ref().is_none_or(|a| a.contains(&file));
            (present || file.ends_with(&disabled_ext)).then(|| ModFile { size: e.metadata().map(|m| m.len()).unwrap_or(0), file, enabled })
        })
        .collect();
    files.sort_by_key(|m| m.file.to_lowercase());
    Ok(files)
}

/// Hash of every listed file, keyed by file name: content sources identify projects by it.
pub fn hashes(state: &AppState, id: &str, kind: ContentKind, algo: HashAlgo) -> Result<HashMap<String, String>> {
    let dir = state.paths.content_dir(id, kind)?;
    list(state, id, kind)?
        .into_iter()
        .map(|f| {
            let path = dir.join(&f.file);
            let hash = match algo {
                HashAlgo::Sha1 => {
                    let mut hasher = Sha1::new();
                    std::io::copy(&mut std::fs::File::open(path)?, &mut hasher)?;
                    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
                }
                // ponytail: reads the whole file into memory; jars are small, stream it if packs get huge.
                HashAlgo::Murmur2 => curseforge_fingerprint(&std::fs::read(path)?).to_string(),
            };
            Ok((f.file, hash))
        })
        .collect()
}

/// CurseForge's file fingerprint: 32-bit MurmurHash2, seed 1, over the bytes minus tab, LF, CR and space.
pub fn curseforge_fingerprint(data: &[u8]) -> u32 {
    const M: u32 = 0x5bd1_e995;
    let bytes: Vec<u8> = data.iter().copied().filter(|b| !matches!(b, 9 | 10 | 13 | 32)).collect();
    let mut h: u32 = 1 ^ bytes.len() as u32;
    let (chunks, tail) = bytes.as_chunks::<4>();
    for c in chunks {
        let mut k = u32::from_le_bytes(*c).wrapping_mul(M);
        k ^= k >> 24;
        h = h.wrapping_mul(M) ^ k.wrapping_mul(M);
    }
    if !tail.is_empty() {
        for (i, b) in tail.iter().enumerate() {
            h ^= (*b as u32) << (8 * i);
        }
        h = h.wrapping_mul(M);
    }
    h ^= h >> 13;
    h = h.wrapping_mul(M);
    h ^ (h >> 15)
}

pub fn toggle(state: &AppState, id: &str, kind: ContentKind, file: &str) -> Result<()> {
    let dir = state.paths.content_dir(id, kind)?;
    let file = safe_file(file)?;
    if kind == ContentKind::Mod {
        let target = match file.strip_suffix(DISABLED) {
            Some(enabled) => enabled.to_string(),
            None => format!("{file}{DISABLED}"),
        };
        std::fs::rename(dir.join(file), dir.join(target))?;
        return Ok(());
    }
    let instance = state.paths.instance_dir(id)?;
    let (file, on) = match file.strip_suffix(DISABLED) {
        Some(plain) => {
            std::fs::rename(dir.join(file), dir.join(plain))?;
            (plain, true)
        }
        None if dir.join(file).is_file() => (file, !active(&instance, kind)?.is_some_and(|a| a.contains(file))),
        None => return Err(AppError::NotFound(format!("{file} is gone"))),
    };
    match kind {
        ContentKind::Resourcepack => set_resource_pack(&instance.join("options.txt"), file, on),
        _ => set_shader(&instance.join("config").join("iris.properties"), file, on),
    }
}

/// Active pack file names, `None` for mods (their state is the file name).
fn active(instance: &Path, kind: ContentKind) -> Result<Option<HashSet<String>>> {
    let read = |p: &Path| match std::fs::read_to_string(p) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        r => r,
    };
    Ok(match kind {
        ContentKind::Mod => None,
        ContentKind::Resourcepack => Some(
            resource_packs(&read(&instance.join("options.txt"))?).into_iter().filter_map(|p| p.strip_prefix("file/").map(String::from)).collect(),
        ),
        ContentKind::Shader => {
            let props = read(&instance.join("config").join("iris.properties"))?;
            let on = prop(&props, "enableShaders").is_none_or(|v| v == "true");
            Some(prop(&props, "shaderPack").filter(|_| on).into_iter().collect())
        }
    })
}

/// The `resourcePacks:[...]` list of `options.txt`; local packs are `file/<name>` (1.13+).
fn resource_packs(options: &str) -> Vec<String> {
    options.lines().find_map(|l| l.strip_prefix("resourcePacks:")).and_then(|v| serde_json::from_str(v).ok()).unwrap_or_default()
}

/// Adds the pack on top (last = highest priority) or drops it.
fn set_resource_pack(options: &Path, file: &str, on: bool) -> Result<()> {
    // Creating options.txt would beat modpack mods that seed it on first launch.
    let text = std::fs::read_to_string(options).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => AppError::Invalid("Launch the game once before turning resource packs on.".into()),
        _ => e.into(),
    })?;
    let entry = format!("file/{file}");
    let mut packs = resource_packs(&text);
    packs.retain(|p| *p != entry);
    if on {
        packs.push(entry);
    }
    let line = format!("resourcePacks:{}", serde_json::to_string(&packs)?);
    std::fs::write(options, set_line(&text, "resourcePacks:", &line))?;
    Ok(())
}

/// Iris runs one shader at a time: turning one on replaces the current one.
fn set_shader(props_path: &Path, file: &str, on: bool) -> Result<()> {
    let mut text = std::fs::read_to_string(props_path).unwrap_or_default();
    if on {
        text = set_line(&text, "shaderPack=", &format!("shaderPack={}", prop_escape(file)));
    }
    text = set_line(&text, "enableShaders=", &format!("enableShaders={on}"));
    std::fs::create_dir_all(props_path.parent().expect("file in config dir"))?;
    std::fs::write(props_path, text)?;
    Ok(())
}

/// Replaces the line starting with `prefix`, or appends `line`.
fn set_line(text: &str, prefix: &str, line: &str) -> String {
    let mut lines: Vec<&str> = text.lines().collect();
    match lines.iter().position(|l| l.starts_with(prefix)) {
        Some(i) => lines[i] = line,
        None => lines.push(line),
    }
    lines.join("\n") + "\n"
}

/// A `key=value` from a Java properties file. ponytail: plain keys only, enough for Iris' own.
fn prop(text: &str, key: &str) -> Option<String> {
    text.lines().find_map(|l| l.strip_prefix(key)?.trim_start().strip_prefix(['=', ':'])).map(|v| prop_unescape(v.trim_start()))
}

/// Java `Properties.store` escaping: specials get a backslash, non-ASCII becomes `\uXXXX`.
fn prop_escape(v: &str) -> String {
    let mut out = String::new();
    for (i, c) in v.chars().enumerate() {
        match c {
            '\\' | '=' | ':' | '#' | '!' => out.extend(['\\', c]),
            ' ' if i == 0 => out.push_str("\\ "),
            ' '..='~' => out.push(c),
            _ => c.encode_utf16(&mut [0; 2]).iter().for_each(|u| out.push_str(&format!("\\u{u:04X}"))),
        }
    }
    out
}

fn prop_unescape(v: &str) -> String {
    let mut units = Vec::new();
    let mut chars = v.chars();
    while let Some(c) = chars.next() {
        let c = match (c, c == '\\') {
            (_, false) => c,
            _ => match chars.next() {
                Some('u') => {
                    let hex: String = chars.by_ref().take(4).collect();
                    units.push(u16::from_str_radix(&hex, 16).unwrap_or(0xFFFD));
                    continue;
                }
                Some('t') => '\t',
                Some('n') => '\n',
                Some('r') => '\r',
                Some('f') => '\x0c',
                Some(c) => c,
                None => break,
            },
        };
        units.extend_from_slice(c.encode_utf16(&mut [0; 2]));
    }
    String::from_utf16_lossy(&units)
}

pub fn delete(state: &AppState, id: &str, kind: ContentKind, file: &str) -> Result<()> {
    std::fs::remove_file(state.paths.content_dir(id, kind)?.join(safe_file(file)?))?;
    Ok(())
}

/// Installs the newest build of `project` that fits the instance, plus its required dependencies for mods.
/// Projects in `skip` (already installed, in any version) are left alone.
pub async fn install(state: &AppState, source_id: &str, id: &str, kind: ContentKind, project: &str, skip: &[String]) -> Result<()> {
    let plugin = plugins::enabled(state, source_id)?;
    let source = plugin.source()?;
    let inst = instances::get(state, id)?;
    let dir = state.paths.content_dir(id, kind)?;
    let mut seen: HashSet<String> = skip.iter().filter(|p| *p != project).cloned().collect();
    let mut queue = vec![project.to_string()];
    while let Some(project) = queue.pop() {
        if !seen.insert(project.clone()) {
            continue;
        }
        let mut filter = VersionFilter { kind: kind.into(), game_version: Some(inst.version.clone()), loader: Some(loader_name(inst.loader).into()) };
        let mut list = source.versions(&project, &filter).await?;
        // Packs rarely break between versions and authors seldom tag every release: fall back to the newest.
        if list.is_empty() && kind != ContentKind::Mod {
            filter.game_version = None;
            list = source.versions(&project, &filter).await?;
        }
        let latest = list.into_iter().next().ok_or_else(|| AppError::NotFound(format!("No build for Minecraft {}", inst.version)))?;
        let file = latest.primary_file().ok_or_else(|| AppError::NotFound("This version has no file".into()))?;
        if file.url.is_empty() {
            return Err(AppError::Unsupported(format!("The author of {} does not allow launchers to download it; get it from its page.", file.filename)));
        }
        if !plugin.may_download(&file.url) {
            return Err(AppError::Invalid(format!("{} is not an allowed download", file.url)));
        }
        http::download(&state.http, &file.url, &dir.join(safe_file(&file.filename)?), None).await?;
        if kind == ContentKind::Mod {
            queue.extend(latest.dependencies.into_iter().filter(|d| d.kind == DependencyKind::Required).filter_map(|d| d.project_id));
        }
    }
    Ok(())
}

fn loader_name(l: Loader) -> &'static str {
    match l {
        Loader::Vanilla => "minecraft",
        Loader::Fabric => "fabric",
        Loader::Quilt => "quilt",
        Loader::Forge => "forge",
        Loader::NeoForge => "neoforge",
        Loader::LiteLoader => "liteloader",
    }
}

/// A local file the source recognised.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentifiedFile {
    pub project: ProjectSummary,
    pub version_number: String,
}

/// Which of the files (name -> SHA-1, from `hashes`) the source knows, by file name.
pub async fn identify(state: &AppState, source_id: &str, hashes: HashMap<String, String>) -> Result<HashMap<String, IdentifiedFile>> {
    let plugin = plugins::enabled(state, source_id)?;
    let source = plugin.source()?;
    let mut unique: Vec<String> = hashes.values().cloned().collect();
    unique.sort();
    unique.dedup();
    if unique.is_empty() {
        return Ok(HashMap::new());
    }
    let found = source.identify(&unique).await?;
    let mut ids: Vec<String> = found.values().map(|v| v.project_id.clone()).collect();
    ids.sort();
    ids.dedup();
    let projects: HashMap<String, ProjectSummary> = source.projects(&ids).await?.into_iter().map(|p| (p.id.clone(), p)).collect();
    Ok(hashes
        .into_iter()
        .filter_map(|(file, hash)| {
            let v = found.get(&hash)?;
            Some((file, IdentifiedFile { project: projects.get(&v.project_id)?.clone(), version_number: v.version_number.clone() }))
        })
        .collect())
}

/// Icon path declared in `fabric.mod.json` / `quilt.mod.json`: a string or a `{ "size": path }` map.
fn icon_path(meta: &serde_json::Value) -> Option<String> {
    match meta {
        serde_json::Value::String(s) => Some(s.trim_start_matches("./").trim_start_matches('/').into()),
        serde_json::Value::Object(sizes) => {
            let (_, largest) = sizes.iter().max_by_key(|(k, _)| k.parse::<u32>().unwrap_or(0))?;
            icon_path(largest)
        }
        _ => None,
    }
}

/// The mod's own icon from inside its jar, as `(bytes, mime)`.
pub fn icon(state: &AppState, id: &str, file: &str) -> Result<(Vec<u8>, &'static str)> {
    use std::io::Read;
    let jar = std::fs::File::open(state.paths.mods_dir(id)?.join(safe_file(file)?))?;
    let mut zip = zip::ZipArchive::new(jar)?;
    let meta = |zip: &mut zip::ZipArchive<std::fs::File>, name: &str| -> Option<serde_json::Value> {
        serde_json::from_reader(zip.by_name(name).ok()?).ok()
    };
    let path = meta(&mut zip, "fabric.mod.json")
        .and_then(|m| icon_path(&m["icon"]))
        .or_else(|| meta(&mut zip, "quilt.mod.json").and_then(|m| icon_path(&m["quilt_loader"]["metadata"]["icon"])))
        .ok_or_else(|| AppError::NotFound("Mod has no icon".into()))?;
    let mut bytes = Vec::new();
    zip.by_name(&path)?.read_to_end(&mut bytes)?;
    let mime = if path.ends_with(".jpg") || path.ends_with(".jpeg") { "image/jpeg" } else { "image/png" };
    Ok((bytes, mime))
}

#[cfg(test)]
mod tests {
    #[test]
    fn picks_largest_icon() {
        let v = serde_json::json!({ "16": "a.png", "128": "./b.png", "32": "c.png" });
        assert_eq!(super::icon_path(&v).as_deref(), Some("b.png"));
        assert_eq!(super::icon_path(&serde_json::json!("assets/x/icon.png")).as_deref(), Some("assets/x/icon.png"));
        assert_eq!(super::icon_path(&serde_json::Value::Null), None);
    }

    #[test]
    fn lists_and_hashes_by_kind() {
        use crate::models::ContentKind;
        let root = std::env::temp_dir().join(format!("tn-content-{}", std::process::id()));
        let state = crate::state::AppState::new(root.clone()).unwrap();
        let dir = state.paths.content_dir("inst", ContentKind::Resourcepack).unwrap();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.zip"), "abc").unwrap();
        std::fs::write(dir.join("b.zip.disabled"), "abc").unwrap();
        std::fs::write(dir.join("notes.txt"), "x").unwrap();

        // Present but not in options.txt: off.
        let files = super::list(&state, "inst", ContentKind::Resourcepack).unwrap();
        assert_eq!(files.iter().map(|f| (f.file.as_str(), f.enabled)).collect::<Vec<_>>(), [("a.zip", false), ("b.zip.disabled", false)]);
        assert_eq!(super::hashes(&state, "inst", ContentKind::Resourcepack, crate::plugins::HashAlgo::Sha1).unwrap()["a.zip"], "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert!(super::list(&state, "inst", ContentKind::Mod).unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn toggles_packs_through_game_config() {
        use crate::models::ContentKind;
        let root = std::env::temp_dir().join(format!("tn-packs-{}", std::process::id()));
        let state = crate::state::AppState::new(root.clone()).unwrap();
        let inst = state.paths.instance_dir("inst").unwrap();
        let packs = state.paths.content_dir("inst", ContentKind::Resourcepack).unwrap();
        let shaders = state.paths.content_dir("inst", ContentKind::Shader).unwrap();
        std::fs::create_dir_all(&packs).unwrap();
        std::fs::create_dir_all(&shaders).unwrap();
        std::fs::write(packs.join("A b.zip"), "").unwrap();
        std::fs::write(packs.join("old.zip.disabled"), "").unwrap();
        std::fs::write(shaders.join("BSL.zip"), "").unwrap();
        std::fs::write(shaders.join("Ünï: x.zip"), "").unwrap();
        let on = |kind| super::list(&state, "inst", kind).unwrap().into_iter().filter(|f| f.enabled).map(|f| f.file).collect::<Vec<_>>();

        // No options.txt yet: refuse instead of creating it.
        assert!(super::toggle(&state, "inst", ContentKind::Resourcepack, "A b.zip").is_err());
        std::fs::write(inst.join("options.txt"), "fov:0.0\nresourcePacks:[\"vanilla\"]\nlang:en_us\n").unwrap();
        super::toggle(&state, "inst", ContentKind::Resourcepack, "A b.zip").unwrap();
        super::toggle(&state, "inst", ContentKind::Resourcepack, "old.zip.disabled").unwrap();
        assert_eq!(on(ContentKind::Resourcepack), ["A b.zip", "old.zip"]);
        let options = std::fs::read_to_string(inst.join("options.txt")).unwrap();
        assert_eq!(options, "fov:0.0\nresourcePacks:[\"vanilla\",\"file/A b.zip\",\"file/old.zip\"]\nlang:en_us\n");
        super::toggle(&state, "inst", ContentKind::Resourcepack, "A b.zip").unwrap();
        assert_eq!(on(ContentKind::Resourcepack), ["old.zip"]);

        // Shaders: one at a time, off keeps the choice but disables it. No iris.properties is fine.
        assert!(on(ContentKind::Shader).is_empty());
        super::toggle(&state, "inst", ContentKind::Shader, "BSL.zip").unwrap();
        super::toggle(&state, "inst", ContentKind::Shader, "Ünï: x.zip").unwrap();
        assert_eq!(on(ContentKind::Shader), ["Ünï: x.zip"]);
        let props = std::fs::read_to_string(inst.join("config/iris.properties")).unwrap();
        assert!(props.contains("shaderPack=\\u00DCn\\u00EF\\: x.zip\n"), "{props}");
        super::toggle(&state, "inst", ContentKind::Shader, "Ünï: x.zip").unwrap();
        assert!(on(ContentKind::Shader).is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn curseforge_fingerprint_matches_reference() {
        // Values from the murmurhash2_32_gc reference (Gary Court) with seed 1, run on the same bytes.
        assert_eq!(super::curseforge_fingerprint(b""), 1540447798);
        assert_eq!(super::curseforge_fingerprint(b"hello world"), 2824650221);
        assert_eq!(super::curseforge_fingerprint(b"hello\r\n world \t"), 2824650221, "whitespace is skipped");
        assert_eq!(super::curseforge_fingerprint(b"abcdefg"), 184182053);
    }

    #[test]
    fn rejects_path_traversal() {
        assert!(super::safe_file("../evil.jar").is_err());
        assert!(super::safe_file(".hidden").is_err());
        assert!(super::safe_file("sodium-0.6.jar").is_ok());
    }
}
