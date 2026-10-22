//! Microsoft sign-in state: one account at a time, persisted in account.json.
use crate::error::Result;
use crate::minecraft::auth::{self, DeviceCode, Session};
use crate::state::AppState;
use crate::storage;

/// Runs the device-code flow and stores the account. Returns the player name.
pub async fn login(state: &AppState, on_code: impl FnOnce(DeviceCode)) -> Result<String> {
    let acc = auth::login(&state.http, on_code).await?;
    storage::save_account(state, Some(&acc))?;
    Ok(acc.name)
}

pub fn logout(state: &AppState) -> Result<()> {
    storage::save_account(state, None)
}

/// Session for the next launch: the Microsoft account (refreshed if stale) or the offline name.
pub async fn session(state: &AppState, offline_name: &str) -> Result<Session> {
    let Some(acc) = storage::load_account(state) else {
        return Ok(Session::offline(offline_name));
    };
    if acc.fresh() {
        return Ok(acc.session());
    }
    let acc = auth::refresh(&state.http, &acc).await?;
    storage::save_account(state, Some(&acc))?;
    Ok(acc.session())
}
