//! Forge and NeoForge: their official installers patch the client, so the launcher runs them headless once.
use super::http::download;
use super::{Progress, Stage};
use crate::error::{AppError, Result};
use serde_json::Value;
use std::path::Path;

/// The installed profile `versions/{id}/{id}.json`, running the installer at `url` first if it is missing.
pub async fn ensure(c: &reqwest::Client, root: &Path, java: &Path, url: &str, id: &str, progress: Progress<'_>) -> Result<Value> {
    // Written by the installer as its last step, so a failed install is redone.
    let profile = root.join("versions").join(id).join(format!("{id}.json"));
    if !profile.exists() {
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
