//! What a game session left behind: the launcher's copy of its output, crash reports and JVM error files.
use super::instances;
use crate::error::Result;
use crate::state::AppState;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// The console only needs the recent tail of a long session's log.
const LOG_TAIL_BYTES: u64 = 4 << 20;

/// Tail of the last session's `launcher.log`; empty if the instance never ran.
pub fn read_log(state: &AppState, id: &str) -> Result<String> {
    let mut file = match File::open(state.paths.instance_dir(id)?.join("launcher.log")) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(e) => return Err(e.into()),
    };
    let len = file.metadata()?.len();
    let mut bytes = Vec::new();
    if len > LOG_TAIL_BYTES {
        use std::io::Seek;
        file.seek(std::io::SeekFrom::Start(len - LOG_TAIL_BYTES))?;
    }
    file.read_to_end(&mut bytes)?;
    let text = String::from_utf8_lossy(&bytes);
    // A cut tail starts mid-line; drop the fragment.
    let text = if len > LOG_TAIL_BYTES { text.split_once('\n').map_or("", |(_, t)| t) } else { &text };
    Ok(text.to_string())
}

/// The last session's crash report and JVM error file: written in the instance after it started.
fn crash_files(dir: &Path, since: u64) -> String {
    let fresh = |p: &Path| p.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).is_some_and(|d| d.as_secs() + 1 >= since);
    let mut out = String::new();
    let reports = std::fs::read_dir(dir.join("crash-reports")).into_iter().flatten().flatten().map(|e| e.path());
    let jvm = std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("hs_err_pid")));
    let mut files: Vec<PathBuf> = reports.chain(jvm).filter(|p| p.is_file() && fresh(p)).collect();
    files.sort();
    for f in files {
        out += &std::fs::read_to_string(f).unwrap_or_default();
        out.push('\n');
    }
    out
}

/// The crash report and JVM error file of the last session, joined; empty when it wrote none.
pub fn crash_reports(state: &AppState, id: &str) -> Result<String> {
    let inst = instances::get(state, id)?;
    Ok(crash_files(&state.paths.instance_dir(id)?, inst.last_played))
}
