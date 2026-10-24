use crate::error::Result;
use crate::minecraft::auth::DeviceCode;
use crate::services::account::{self, AccountView};
use crate::services::skins::{self, SkinView};
use crate::state::AppState;
use serde_json::Value;
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn list_accounts(state: State<'_, AppState>) -> Vec<AccountView> {
    account::list(&state)
}

/// `id` = None plays offline.
#[tauri::command]
pub fn select_account(state: State<'_, AppState>, id: Option<String>) -> Result<()> {
    account::select(&state, id.as_deref())
}

#[tauri::command]
pub fn remove_account(state: State<'_, AppState>, id: String) -> Result<()> {
    account::remove(&state, &id)
}

/// Adds (or selects) an offline profile by player name.
#[tauri::command]
pub fn add_offline_account(state: State<'_, AppState>, name: String) -> Result<String> {
    account::add_offline(&state, &name)
}

/// Opens the Microsoft code page, sends the code to the UI, resolves with the player name once approved.
#[tauri::command]
pub async fn microsoft_login(app: AppHandle, state: State<'_, AppState>, on_code: Channel<DeviceCode>) -> Result<String> {
    account::login_microsoft(&state, |code| {
        let _ = app.opener().open_url(&code.verification_uri, None::<&str>);
        let _ = on_code.send(code);
    })
    .await
}

/// Signs in through an account provider plugin; `fields` are its form's values. Resolves with the player name.
#[tauri::command]
pub async fn plugin_login(state: State<'_, AppState>, plugin: String, fields: Value) -> Result<String> {
    account::login_plugin(&state, &plugin, fields).await
}

/// The account's skin as a data URL; None when it has none.
#[tauri::command]
pub async fn account_skin(state: State<'_, AppState>, id: String) -> Result<Option<SkinView>> {
    skins::skin(&state, &id).await
}
