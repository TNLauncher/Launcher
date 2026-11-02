//! The way Rust calls into a plugin. A plugin runs in a sandboxed iframe of the main window, so a call goes
//! out as a `plugin-call` event, the frontend forwards it to the plugin's frame, and the answer comes back
//! through the `plugin_reply` command.
use crate::error::{AppError, Result};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::oneshot;

/// A plugin that does not answer by then is treated as failed.
const TIMEOUT: Duration = Duration::from_secs(60);

/// Payload of the `plugin-call` event.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Call {
    pub id: u64,
    pub plugin: String,
    /// What the plugin registered: `source`, `account`, `importer` or `runtime`.
    pub target: &'static str,
    pub method: &'static str,
    /// Positional arguments of the plugin function.
    pub args: Vec<Value>,
}

type Reply = std::result::Result<Value, String>;

/// Calls in flight to plugin frames.
pub struct Bridge {
    emit: Box<dyn Fn(Call) + Send + Sync>,
    next: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    /// Calls made before the frontend listens; `None` once it does.
    early: Mutex<Option<Vec<Call>>>,
}

impl Bridge {
    /// `emit` delivers a call to the frontend; tests answer it directly.
    pub fn new(emit: impl Fn(Call) + Send + Sync + 'static) -> Self {
        Self { emit: Box::new(emit), next: AtomicU64::new(1), pending: Mutex::new(HashMap::new()), early: Mutex::new(Some(vec![])) }
    }

    /// The frontend listens for `plugin-call` now: deliver what waited.
    pub fn listening(&self) {
        let early = self.early.lock().unwrap().take().unwrap_or_default();
        early.into_iter().for_each(|c| (self.emit)(c));
    }

    fn send(&self, call: Call) {
        let mut early = self.early.lock().unwrap();
        match early.as_mut() {
            Some(queue) => queue.push(call),
            None => {
                drop(early);
                (self.emit)(call);
            }
        }
    }

    pub async fn call(&self, plugin: &str, target: &'static str, method: &'static str, args: Vec<Value>) -> Result<Value> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        self.send(Call { id, plugin: plugin.into(), target, method, args });
        let answer = tokio::time::timeout(TIMEOUT, rx).await;
        self.pending.lock().unwrap().remove(&id);
        match answer {
            Ok(Ok(Ok(v))) => Ok(v),
            Ok(Ok(Err(e))) => Err(AppError::Plugin(format!("{plugin}.{method}: {e}"))),
            Ok(Err(_)) => Err(AppError::Plugin(format!("{plugin}.{method}: no answer"))),
            Err(_) => Err(AppError::Plugin(format!("{plugin}.{method} did not answer in {}s", TIMEOUT.as_secs()))),
        }
    }

    /// Answer from the frontend; unknown ids (timed out) are dropped.
    pub fn reply(&self, id: u64, answer: Reply) {
        if let Some(tx) = self.pending.lock().unwrap().remove(&id) {
            let _ = tx.send(answer);
        }
    }
}
