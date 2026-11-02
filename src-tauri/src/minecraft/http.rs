use crate::error::{AppError, Result};
use futures_util::{stream, StreamExt};
use serde_json::Value;
use sha1::{Digest, Sha1};
use std::path::{Path, PathBuf};
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::Duration;

const PARALLEL: usize = 32;
const ATTEMPTS: u64 = 5;

pub struct Job {
    pub url: String,
    pub path: PathBuf,
    pub size: Option<u64>,
    /// Hex SHA-1 when the index lists one; downloads are always checked against it.
    pub sha1: Option<String>,
}

/// How far a file already on disk is trusted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Check {
    /// A matching size is enough: launches stay fast.
    Size,
    /// Rehash files that have a known SHA-1: what a repair runs.
    Hash,
}

pub async fn get_json(c: &reqwest::Client, url: &str) -> Result<Value> {
    let r = c.get(url).send().await?;
    if !r.status().is_success() {
        return Err(AppError::Status { url: url.into(), status: r.status().as_u16() });
    }
    Ok(r.json().await?)
}

pub async fn post_json(c: &reqwest::Client, url: &str, body: &Value) -> Result<Value> {
    let r = c.post(url).json(body).send().await?;
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

/// Hex SHA-1 of a file, read in one go off the async thread.
pub async fn sha1_file(path: &Path) -> Result<String> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || -> Result<String> {
        let mut hasher = Sha1::new();
        std::io::copy(&mut std::fs::File::open(path)?, &mut hasher)?;
        Ok(hex(&hasher.finalize()))
    })
    .await
    .map_err(|e| AppError::Unsupported(format!("Hashing crashed: {e}")))?
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Whether the file on disk can stay as it is.
async fn intact(job: &Job, check: Check) -> bool {
    let Ok(m) = tokio::fs::metadata(&job.path).await else { return false };
    if job.size.is_some_and(|s| m.len() != s) {
        return false;
    }
    match (&job.sha1, check) {
        (Some(want), Check::Hash) => sha1_file(&job.path).await.is_ok_and(|h| h.eq_ignore_ascii_case(want)),
        _ => true,
    }
}

/// Downloads `url` to `path` unless it is already there, retrying dropped connections.
pub async fn download(c: &reqwest::Client, url: &str, path: &Path, size: Option<u64>) -> Result<()> {
    fetch(c, &Job { url: url.into(), path: path.into(), size, sha1: None }, Check::Size).await.map(drop)
}

/// Downloads the job unless the file on disk passes `check`. Returns whether it was downloaded.
pub async fn fetch(c: &reqwest::Client, job: &Job, check: Check) -> Result<bool> {
    if intact(job, check).await {
        return Ok(false);
    }
    let mut attempt = 0;
    let bytes = loop {
        attempt += 1;
        let got = fetch_bytes(c, &job.url).await.and_then(|b| match &job.sha1 {
            // A mirror or a dropped connection can hand over the wrong bytes with a 200.
            Some(want) if !hex(&Sha1::digest(&b)).eq_ignore_ascii_case(want) => Err(AppError::Invalid(format!("{} does not match its checksum", job.url))),
            _ => Ok(b),
        });
        match got {
            Ok(b) => break b,
            Err(e) if attempt >= ATTEMPTS => return Err(e),
            Err(_) => tokio::time::sleep(Duration::from_millis(500 * attempt)).await,
        }
    };
    if let Some(dir) = job.path.parent() {
        tokio::fs::create_dir_all(dir).await?;
    }
    let tmp = part_path(&job.path);
    tokio::fs::write(&tmp, &bytes).await?;
    if let Err(e) = tokio::fs::rename(&tmp, &job.path).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        // Another launch put the same file in place first, or holds it open (Windows).
        if !intact(job, Check::Size).await {
            return Err(e.into());
        }
    }
    Ok(true)
}

/// Unique temp name for a download in progress: `jimage.dll` and `jimage.exe` download side by side, and two
/// instances can fetch the same library at once, so a shared `.part` would mix up or lose their bytes.
fn part_path(path: &Path) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let mut name = path.as_os_str().to_owned();
    name.push(format!(".{}.part", NEXT.fetch_add(1, Ordering::Relaxed)));
    name.into()
}

/// Drops jobs aimed at a path already taken: asset indexes list one hash under several names.
fn dedupe(jobs: Vec<Job>) -> Vec<Job> {
    let mut seen = HashSet::new();
    jobs.into_iter().filter(|j| seen.insert(j.path.clone())).collect()
}

/// Runs jobs `PARALLEL` at a time, calling `tick(done, total)` as they land. Returns how many were downloaded.
pub async fn download_all(c: &reqwest::Client, jobs: Vec<Job>, check: Check, tick: &(dyn Fn(usize, usize) + Sync)) -> Result<usize> {
    let jobs = dedupe(jobs);
    let total = jobs.len();
    let done = AtomicUsize::new(0);
    let fetched = AtomicUsize::new(0);
    let mut results = stream::iter(jobs)
        .map(|job| {
            let (done, fetched) = (&done, &fetched);
            async move {
                if fetch(c, &job, check).await? {
                    fetched.fetch_add(1, Ordering::Relaxed);
                }
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
    Ok(fetched.load(Ordering::Relaxed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn part_files_never_collide() {
        let p = Path::new("bin/jimage.dll");
        assert_ne!(part_path(p), part_path(p));
        assert_ne!(part_path(p).with_extension(""), part_path(Path::new("bin/jimage.exe")).with_extension(""));
        assert_eq!(part_path(p).extension().unwrap(), "part");
    }

    #[test]
    fn one_job_per_path() {
        let job = |p: &str| Job { url: String::new(), path: p.into(), size: None, sha1: None };
        let paths: Vec<PathBuf> = dedupe(vec![job("a/x"), job("a/y"), job("a/x")]).into_iter().map(|j| j.path).collect();
        assert_eq!(paths, [PathBuf::from("a/x"), PathBuf::from("a/y")]);
    }
}
