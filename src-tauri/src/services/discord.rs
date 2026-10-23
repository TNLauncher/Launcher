//! Discord Rich Presence transport. A worker thread owns the IPC client and re-sends the current
//! presence every few seconds, so it survives Discord starting late or restarting. What to show
//! is up to plugins (`tn.presence`, the bundled `discord` plugin); with none, nothing is shown.
use discord_rich_presence::activity::{Activity, Assets, StatusDisplayType, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::time::Duration;

/// Application ID from discord.com/developers/applications.
/// Its Rich Presence → Art Assets must contain an image named `logo`.
const APP_ID: &str = "1562941920475484221";
const RETRY: Duration = Duration::from_secs(15);
/// Discord rejects fields outside 2..=128 characters.
const FIELD: std::ops::RangeInclusive<usize> = 2..=128;

/// What a plugin asks Discord to show.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    /// First line; also replaces the app name in the member list while `startedAt` is set.
    pub details: String,
    pub state: String,
    /// Unix seconds; shows elapsed time.
    pub started_at: Option<i64>,
    /// Hover text of the logo.
    pub tooltip: Option<String>,
}

impl Presence {
    pub fn valid(&self) -> bool {
        let ok = |s: &str| FIELD.contains(&s.chars().count());
        ok(&self.details) && ok(&self.state) && self.tooltip.as_deref().is_none_or(ok)
    }
}

/// Registered with `app.manage`; cheap to call from anywhere.
pub struct Discord(Sender<Option<Presence>>);

impl Discord {
    pub fn spawn() -> Self {
        let (tx, rx) = mpsc::channel::<Option<Presence>>();
        std::thread::spawn(move || {
            let mut client = DiscordIpcClient::new(APP_ID);
            let mut connected = false;
            let mut current: Option<Presence> = None;
            loop {
                if !connected {
                    connected = client.connect().is_ok();
                }
                let sent = match &current {
                    Some(p) => client.set_activity(activity(p)),
                    None => client.clear_activity(),
                };
                if connected && sent.is_err() {
                    let _ = client.close();
                    connected = false;
                }
                match rx.recv_timeout(RETRY) {
                    Ok(p) => current = p,
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
        });
        Self(tx)
    }

    /// `None` clears the status.
    pub fn set(&self, presence: Option<Presence>) {
        let _ = self.0.send(presence);
    }
}

fn activity(p: &Presence) -> Activity<'_> {
    let assets = Assets::new().large_image("logo").large_text(p.tooltip.as_deref().unwrap_or("TNLauncher"));
    let a = Activity::new().details(&p.details).state(&p.state).assets(assets);
    match p.started_at {
        // The member list shows "Playing <details>" instead of the bare app name.
        Some(t) => a.status_display_type(StatusDisplayType::Details).timestamps(Timestamps::new().start(t)),
        None => a,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn validates_lengths() {
        let p = |d: &str| super::Presence { details: d.into(), state: "ok".into(), started_at: None, tooltip: None };
        assert!(p("Сборка").valid());
        assert!(!p("x").valid());
        assert!(!p(&"я".repeat(129)).valid());
    }
}
