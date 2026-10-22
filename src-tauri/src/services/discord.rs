//! Discord Rich Presence. A worker thread owns the IPC client and re-sends the current
//! presence every few seconds, so it survives Discord starting late or restarting.
//!
//! Copy rules: facts (instance, version, loader, mods) stay exact; flavor lives in the
//! idle line and the logo tooltip. A phrase is picked once per state change and the idle
//! one rotates slowly, so friends see variety without the status flickering.
use crate::models::Loader;
use discord_rich_presence::activity::{Activity, Assets, StatusDisplayType, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

/// Application ID from discord.com/developers/applications.
/// Its Rich Presence → Art Assets must contain an image named `logo`.
const APP_ID: &str = "1562941920475484221";
const RETRY: Duration = Duration::from_secs(15);
const IDLE_ROTATE: Duration = Duration::from_secs(5 * 60);

const IDLE: &[&str] = &[
    "Выбирает, где копать",
    "Точит кирку",
    "Перебирает сборки",
    "Решает: ванилла или моды",
    "Готовится к спавну",
    "Ищет алмазы в меню",
    "Пересчитывает сундуки",
    "Сверяет карту мира",
];

const LAUNCHING: &[&str] = &[
    "Разжигает печь…",
    "Прогревает JVM…",
    "Собирает сборку…",
    "Открывает портал…",
];

const TOOLTIP: &[&str] = &[
    "TNLauncher",
    "Крафтим через TNLauncher",
    "TNLauncher · моды без боли",
    "TNLauncher · копаем глубже",
];

pub enum Presence {
    Idle,
    Launching { name: String },
    Playing { name: String, version: String, loader: Loader, mods: usize, since: u64 },
}

/// Registered with `app.manage`; cheap to call from anywhere.
pub struct Discord(Sender<Presence>);

impl Discord {
    pub fn spawn() -> Self {
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut client = DiscordIpcClient::new(APP_ID);
            let mut connected = false;
            let mut current = Presence::Idle;
            let mut seed = random();
            let mut picked_at = Instant::now();
            loop {
                if matches!(current, Presence::Idle) && picked_at.elapsed() >= IDLE_ROTATE {
                    seed = seed.wrapping_add(1);
                    picked_at = Instant::now();
                }
                if !connected {
                    connected = client.connect().is_ok();
                }
                if connected && client.set_activity(activity(&current, seed)).is_err() {
                    let _ = client.close();
                    connected = false;
                }
                match rx.recv_timeout(RETRY) {
                    Ok(p) => {
                        current = p;
                        seed = random();
                        picked_at = Instant::now();
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
        });
        Self(tx)
    }

    pub fn set(&self, presence: Presence) {
        let _ = self.0.send(presence);
    }
}

fn activity(p: &Presence, seed: usize) -> Activity<'_> {
    let assets = Assets::new().large_image("logo").large_text(pick(TOOLTIP, seed / 7));
    match p {
        Presence::Idle => Activity::new().details(pick(IDLE, seed)).state("В лаунчере").assets(assets),
        Presence::Launching { name } => Activity::new()
            .details(name.as_str())
            .state(pick(LAUNCHING, seed))
            .assets(assets),
        // The member list shows "Играет в <instance>" instead of the bare app name.
        Presence::Playing { name, version, loader, mods, since } => Activity::new()
            .details(name.as_str())
            .state(build_line(version, *loader, *mods))
            .status_display_type(StatusDisplayType::Details)
            .timestamps(Timestamps::new().start(*since as i64))
            .assets(assets),
    }
}

/// "1.21.1 · Fabric · 42 мода", or "1.21.1 · Ванилла".
fn build_line(version: &str, loader: Loader, mods: usize) -> String {
    match loader {
        Loader::Vanilla => format!("{version} · Ванилла"),
        l if mods == 0 => format!("{version} · {l:?}"),
        l => format!("{version} · {l:?} · {mods} {}", plural(mods, ["мод", "мода", "модов"])),
    }
}

fn plural(n: usize, [one, few, many]: [&'static str; 3]) -> &'static str {
    match (n % 10, n % 100) {
        (1, r) if r != 11 => one,
        (2..=4, r) if !(12..=14).contains(&r) => few,
        _ => many,
    }
}

fn pick(pool: &'static [&'static str], seed: usize) -> &'static str {
    pool[seed % pool.len()]
}

// ponytail: clock nanos as entropy; good enough to shuffle status phrases, not for anything else.
fn random() -> usize {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().subsec_nanos() as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy() {
        let f = ["мод", "мода", "модов"];
        assert_eq!([1, 2, 5, 11, 12, 21, 22, 25, 111, 104].map(|n| plural(n, f)),
            ["мод", "мода", "модов", "модов", "модов", "мод", "мода", "модов", "модов", "мода"]);
        assert_eq!(build_line("1.21.1", Loader::Vanilla, 3), "1.21.1 · Ванилла");
        assert_eq!(build_line("1.21.1", Loader::Fabric, 0), "1.21.1 · Fabric");
        assert_eq!(build_line("1.20.4", Loader::Quilt, 42), "1.20.4 · Quilt · 42 мода");
    }
}
