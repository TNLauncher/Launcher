//! Mojang-hosted Java runtimes, so users never install Java themselves.
use super::http::{download_all, get_json, Job};
use super::{Progress, Stage};
use crate::error::{AppError, Result};
use serde_json::Value;
use std::path::{Path, PathBuf};

const RUNTIMES_URL: &str =
    "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";

fn platform() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86") => "linux-i386",
        ("linux", _) => "linux",
        ("macos", "aarch64") => "mac-os-arm64",
        ("macos", _) => "mac-os",
        ("windows", "aarch64") => "windows-arm64",
        ("windows", "x86") => "windows-x86",
        _ => "windows-x64",
    }
}

/// Returns the java binary for the runtime `version` asks for, downloading it on first use.
pub async fn ensure(c: &reqwest::Client, root: &Path, version: &Value, progress: Progress<'_>) -> Result<PathBuf> {
    let component = version["javaVersion"]["component"].as_str().unwrap_or("jre-legacy");
    let dir = root.join("runtime").join(component);
    // ponytail: Linux/Windows layout; macOS runtimes live under jre.bundle/Contents/Home.
    let java = dir.join("bin").join(if cfg!(windows) { "java.exe" } else { "java" });
    // Written last, so a runtime interrupted mid-install is redone instead of reused.
    let done = dir.join(".installed");
    if done.exists() {
        return Ok(java);
    }
    progress(Stage::Java, 0, 0);

    let all = get_json(c, RUNTIMES_URL).await?;
    let manifest_url = all[platform()][component][0]["manifest"]["url"]
        .as_str()
        .ok_or_else(|| AppError::Unsupported(format!("No Java runtime {component} for {}", platform())))?;
    let manifest = get_json(c, manifest_url).await?;
    let files = manifest["files"].as_object().ok_or_else(|| AppError::Invalid("Bad runtime manifest".into()))?;

    let (mut jobs, mut executables, mut links) = (vec![], vec![], vec![]);
    for (rel, f) in files {
        let path = dir.join(rel);
        match f["type"].as_str() {
            Some("file") => {
                let raw = &f["downloads"]["raw"];
                if f["executable"].as_bool() == Some(true) {
                    executables.push(path.clone());
                }
                jobs.push(Job { url: raw["url"].as_str().unwrap_or_default().into(), path, size: raw["size"].as_u64() });
            }
            Some("link") => links.push((path, f["target"].as_str().unwrap_or_default().to_string())),
            _ => std::fs::create_dir_all(&path)?,
        }
    }
    download_all(c, jobs, &|d, t| progress(Stage::Java, d, t)).await?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for p in executables {
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755))?;
        }
        for (p, target) in links {
            let _ = std::fs::remove_file(&p);
            std::os::unix::fs::symlink(target, &p)?;
        }
    }
    #[cfg(not(unix))]
    let _ = (executables, links);

    std::fs::write(done, "")?;
    Ok(java)
}
