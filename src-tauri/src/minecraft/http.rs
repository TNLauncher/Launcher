use crate::error::{AppError, Result};
use futures::{stream, StreamExt};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

const PARALLEL: usize = 32;
const ATTEMPTS: u64 = 3;

pub struct Job {
    pub url: String,
    pub path: PathBuf,
    pub size: Option<u64>,
}

pub async fn get_json(c: &reqwest::Client, url: &str) -> Result<Value> {
    let r = c.get(url).send().await?;
    if !r.status().is_success() {
        return Err(AppError::Status { url: url.into(), status: r.status().as_u16() });
    }
    Ok(r.json().await?)
}

pub async fn fetch_bytes(c: &reqwest::Client, url: &str) -> Result<Vec<u8>> {
    let r = c.get(url).send().await?;
    if !r.status().is_success() {
        return Err(AppError::Status { url: url.into(), status: r.status().as_u16() });
    }
    Ok(r.bytes().await?.to_vec())
}

// ponytail: a file whose size matches is trusted, no sha1 check; add hashing if corrupted installs show up.
/// Downloads `url` to `path` unless it is already there, retrying dropped connections.
pub async fn download(c: &reqwest::Client, url: &str, path: &Path, size: Option<u64>) -> Result<()> {
    if let Ok(m) = tokio::fs::metadata(path).await {
        if size.map_or(true, |s| m.len() == s) {
            return Ok(());
        }
    }
    let mut attempt = 0;
    let bytes = loop {
        attempt += 1;
        match fetch_bytes(c, url).await {
            Ok(b) => break b,
            Err(e) if attempt >= ATTEMPTS => return Err(e),
            Err(_) => tokio::time::sleep(Duration::from_millis(500 * attempt)).await,
        }
    };
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir).await?;
    }
    let tmp = path.with_extension("part");
    tokio::fs::write(&tmp, &bytes).await?;
    tokio::fs::rename(&tmp, path).await?;
    Ok(())
}

/// Runs jobs `PARALLEL` at a time, calling `tick(done, total)` as they land.
pub async fn download_all(c: &reqwest::Client, jobs: Vec<Job>, tick: &(dyn Fn(usize, usize) + Sync)) -> Result<()> {
    let total = jobs.len();
    let done = AtomicUsize::new(0);
    let mut results = stream::iter(jobs)
        .map(|job| {
            let done = &done;
            async move {
                download(c, &job.url, &job.path, job.size).await?;
                let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                if n % 25 == 0 || n == total {
                    tick(n, total);
                }
                Ok::<_, AppError>(())
            }
        })
        .buffer_unordered(PARALLEL);
    while let Some(r) = results.next().await {
        r?;
    }
    Ok(())
}
