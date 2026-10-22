use crate::error::Result;
use crate::minecraft::auth::DeviceCode;
use crate::services::account;
use crate::state::AppState;
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_opener::OpenerExt;

/// Opens the Microsoft code page, sends the code to the UI, resolves with the player name once approved.
#[tauri::command]
pub async fn microsoft_login(app: AppHandle, state: State<'_, AppState>, on_code: Channel<DeviceCode>) -> Result<String> {
    account::login(&state, |code| {
        let _ = app.opener().open_url(&code.verification_uri, None::<&str>);
        let _ = on_code.send(code);
    })
    .await
}

#[tauri::command]
pub fn microsoft_logout(state: State<'_, AppState>) -> Result<()> {
    account::logout(&state)
}
