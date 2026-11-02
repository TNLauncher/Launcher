//! Forge and NeoForge: their official installers patch the client, so the launcher runs them headless once.
use super::http::{download, Check};
use super::{Progress, Stage};
use crate::error::{AppError, Result};
use serde_json::Value;
use std::path::Path;

/// The installed profile `versions/{id}/{id}.json`, running the installer at `url` first if it is missing,
/// if a file it generated is gone, or on a repair (`Check::Hash`).
pub async fn ensure(c: &reqwest::Client, root: &Path, java: &Path, url: &str, id: &str, check: Check, progress: Progress<'_>) -> Result<Value> {
    // Written by the installer as its last step, so a failed install is redone.
    let profile = root.join("versions").join(id).join(format!("{id}.json"));
    if check == Check::Hash || !generated_present(root, &profile) {
        progress(Stage::Loader, 0, 0);
        // The installers refuse a directory that does not look like a launcher.
        let profiles = root.join("launcher_profiles.json");
        if !profiles.exists() {
            std::fs::write(&profiles, r#"{"profiles":{}}"#)?;
        }
        let jar = root.join("cache").join(format!("{id}-installer.jar"));
        download(c, url, &jar, None).await?;

        let (java, root_dir, jar_path) = (java.to_path_buf(), root.to_path_buf(), jar.clone());
        let out = tokio::task::spawn_blocking(move || {
            let mut cmd = std::process::Command::new(&java);
            cmd.arg("-jar").arg(&jar_path).arg("--installClient").arg(&root_dir).current_dir(&root_dir);
            #[cfg(windows)]
            std::os::windows::process::CommandExt::creation_flags(&mut cmd, 0x0800_0000); // CREATE_NO_WINDOW
            cmd.output()
        })
        .await
        .map_err(|e| AppError::Unsupported(format!("Loader installer crashed: {e}")))??;

        let _ = std::fs::remove_file(&jar);
        let _ = std::fs::remove_file(jar.with_extension("jar.log"));
        if !out.status.success() || !profile.exists() {
            let text = String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr);
            let tail: Vec<&str> = text.lines().rev().take(8).collect();
            let tail = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
            return Err(AppError::Unsupported(format!("Could not install {id}:\n{tail}")));
        }
    }
    Ok(serde_json::from_slice(&std::fs::read(profile)?)?)
}

/// Whether the profile exists and every library the installer generated (listed without a url) is on disk:
/// nothing downloads those, so a lost one is only put back by running the installer again.
fn generated_present(root: &Path, profile: &Path) -> bool {
    let Some(v) = std::fs::read(profile).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else { return false };
    v["libraries"].as_array().into_iter().flatten().filter_map(|l| l["downloads"].get("artifact")).all(|a| {
        a["url"].as_str().is_some_and(|u| !u.is_empty()) || a["path"].as_str().is_none_or(|p| root.join("libraries").join(p).is_file())
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn notices_lost_generated_libraries() {
        let root = std::env::temp_dir().join(format!("tn-installer-{}", std::process::id()));
        let profile = root.join("p.json");
        std::fs::create_dir_all(root.join("libraries/a")).unwrap();
        let libs = r#"{"libraries":[{"downloads":{"artifact":{"path":"a/gen.jar","url":""}}},{"downloads":{"artifact":{"path":"b/dl.jar","url":"https://x"}}}]}"#;
        assert!(!super::generated_present(&root, &profile));
        std::fs::write(&profile, libs).unwrap();
        assert!(!super::generated_present(&root, &profile));
        std::fs::write(root.join("libraries/a/gen.jar"), "").unwrap();
        assert!(super::generated_present(&root, &profile));
        std::fs::remove_dir_all(root).unwrap();
    }
}
