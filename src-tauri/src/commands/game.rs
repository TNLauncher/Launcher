use crate::error::Result;
use crate::services::launcher::{self, LaunchEvent};
use tauri::{ipc::Channel, AppHandle};

#[tauri::command]
pub async fn launch(app: AppHandle, id: String, on_event: Channel<LaunchEvent>) -> Result<()> {
    launcher::launch(&app, &id, on_event).await
}
