//! Player accounts: any number of Microsoft or plugin-provided accounts, one of them selected;
//! none selected = offline with the name from settings. Persisted in accounts.json.
use crate::error::{AppError, Result};
use crate::minecraft::{
    auth::{self, DeviceCode, Session},
    http,
};
use crate::plugins::{self, js::PluginSession};
use crate::state::AppState;
use crate::storage;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const MICROSOFT: &str = "microsoft";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    /// `microsoft` or the id of the plugin that signed it in.
    pub provider: String,
    pub name: String,
    pub uuid: String,
    /// Microsoft tokens.
    #[serde(default)]
    pub microsoft: Option<auth::Account>,
    /// What the provider plugin keeps between sessions (its tokens).
    #[serde(default)]
    pub data: Value,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Accounts {
    pub selected: Option<String>,
    pub accounts: Vec<Account>,
}

/// Shown in the UI; no tokens.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    pub id: String,
    pub provider: String,
    /// "Microsoft" or the plugin's name.
    pub provider_name: String,
    pub name: String,
    pub selected: bool,
}

fn load(state: &AppState) -> Accounts {
    let path = state.paths.accounts_file();
    if path.exists() {
        return storage::read(&path);
    }
    // The single Microsoft sign-in of earlier builds.
    match storage::load_account(state) {
        Some(ms) => {
            // Derived, not random: this is rebuilt on every read until accounts.json is first written.
            let acc = Account { id: format!("microsoft-{}", ms.uuid), provider: MICROSOFT.into(), name: ms.name.clone(), uuid: ms.uuid.clone(), microsoft: Some(ms), data: Value::Null };
            Accounts { selected: Some(acc.id.clone()), accounts: vec![acc] }
        }
        None => Accounts::default(),
    }
}

fn update<R>(state: &AppState, f: impl FnOnce(&mut Accounts) -> Result<R>) -> Result<R> {
    let _guard = state.store_lock.lock().unwrap();
    let mut all = load(state);
    let out = f(&mut all)?;
    storage::write(&state.paths.accounts_file(), &all)?;
    Ok(out)
}

fn new_id() -> String {
    format!("{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos())
}

fn provider_name(state: &AppState, provider: &str) -> String {
    match provider {
        MICROSOFT => "Microsoft".into(),
        id => state.plugins.get(id).map(|p| p.manifest.name.clone()).unwrap_or_else(|_| id.into()),
    }
}

pub fn list(state: &AppState) -> Vec<AccountView> {
    let all = load(state);
    all.accounts
        .iter()
        .map(|a| AccountView {
            id: a.id.clone(),
            provider: a.provider.clone(),
            provider_name: provider_name(state, &a.provider),
            name: a.name.clone(),
            selected: all.selected.as_deref() == Some(&a.id),
        })
        .collect()
}

/// The account the next launch uses; `None` = offline.
pub fn selected(state: &AppState) -> Option<AccountView> {
    list(state).into_iter().find(|a| a.selected)
}

pub fn select(state: &AppState, id: Option<&str>) -> Result<()> {
    update(state, |all| {
        if let Some(id) = id {
            if !all.accounts.iter().any(|a| a.id == id) {
                return Err(AppError::NotFound("Account not found".into()));
            }
        }
        all.selected = id.map(String::from);
        Ok(())
    })
}

pub fn remove(state: &AppState, id: &str) -> Result<()> {
    update(state, |all| {
        all.accounts.retain(|a| a.id != id);
        if all.selected.as_deref() == Some(id) {
            all.selected = None;
        }
        Ok(())
    })
}

/// Adds (or, for the same provider and player, replaces) an account and selects it. Returns the player name.
fn add(state: &AppState, acc: Account) -> Result<String> {
    let name = acc.name.clone();
    update(state, |all| {
        if let Some(old) = all.accounts.iter().position(|a| a.provider == acc.provider && a.uuid == acc.uuid) {
            all.accounts.remove(old);
        }
        all.selected = Some(acc.id.clone());
        all.accounts.push(acc);
        Ok(name)
    })
}

/// Runs the Microsoft device-code flow.
pub async fn login_microsoft(state: &AppState, on_code: impl FnOnce(DeviceCode)) -> Result<String> {
    let ms = auth::login(&state.http, on_code).await?;
    add(state, Account { id: new_id(), provider: MICROSOFT.into(), name: ms.name.clone(), uuid: ms.uuid.clone(), microsoft: Some(ms), data: Value::Null })
}

/// Signs in through an account provider plugin with its form's values.
pub async fn login_plugin(state: &AppState, plugin: &str, fields: Value) -> Result<String> {
    let p = plugins::enabled(state, plugin)?;
    let login = p.account()?.login(fields).await?;
    let (name, uuid) = (check_name(&login.name)?, check_uuid(&login.uuid)?);
    add(state, Account { id: new_id(), provider: plugin.into(), name, uuid, microsoft: None, data: login.data })
}

/// Plugin answers become game arguments: keep them to what Minecraft accepts.
fn check_name(name: &str) -> Result<String> {
    if (1..=16).contains(&name.len()) && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        Ok(name.into())
    } else {
        Err(AppError::Plugin(format!("Bad player name: {name}")))
    }
}

fn check_uuid(uuid: &str) -> Result<String> {
    let hex: String = uuid.chars().filter(|c| *c != '-').collect();
    if hex.len() == 32 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(hex.to_ascii_lowercase())
    } else {
        Err(AppError::Plugin(format!("Bad player UUID: {uuid}")))
    }
}

/// Session for the next launch: the selected account (refreshed if needed) or offline.
pub async fn session(state: &AppState, offline_name: &str) -> Result<Session> {
    let all = load(state);
    let Some(acc) = all.selected.as_ref().and_then(|id| all.accounts.iter().find(|a| &a.id == id)).cloned() else {
        return Ok(Session::offline(offline_name));
    };
    if acc.provider == MICROSOFT {
        let ms = acc.microsoft.clone().ok_or_else(|| AppError::Invalid("Microsoft account has no tokens; sign in again".into()))?;
        if ms.fresh() {
            return Ok(ms.session());
        }
        let ms = auth::refresh(&state.http, &ms).await?;
        let session = ms.session();
        update(state, |all| {
            if let Some(a) = all.accounts.iter_mut().find(|a| a.id == acc.id) {
                a.microsoft = Some(ms);
            }
            Ok(())
        })?;
        return Ok(session);
    }
    let plugin = plugins::enabled(state, &acc.provider)?;
    let s = plugin.account()?.session(json!({ "name": acc.name, "uuid": acc.uuid, "data": acc.data })).await?;
    plugin_session(state, &plugin, s, &acc.id).await
}

async fn plugin_session(state: &AppState, plugin: &plugins::Plugin, s: PluginSession, account_id: &str) -> Result<Session> {
    let user_type = match s.user_type.as_str() {
        "mojang" => "mojang",
        "legacy" => "legacy",
        other => return Err(AppError::Plugin(format!("Bad user type: {other}"))),
    };
    let (name, uuid) = (check_name(&s.name)?, check_uuid(&s.uuid)?);
    let mut jvm_args = vec![];
    if let Some(agent) = s.java_agent {
        if !plugin.manifest.permissions.jvm {
            return Err(AppError::Plugin(format!("{} may not load Java agents", plugin.manifest.name)));
        }
        if !plugin.may_download(&agent.url) {
            return Err(AppError::Invalid(format!("{} is not an allowed download", agent.url)));
        }
        let jar = state.paths.plugin_data_dir(&plugin.manifest.id).join("files").join(super::mods::safe_file(&agent.filename)?);
        http::download(&state.http, &agent.url, &jar, None).await?;
        let options = if agent.options.is_empty() { String::new() } else { format!("={}", agent.options) };
        jvm_args.push(format!("-javaagent:{}{options}", jar.display()));
    }
    update(state, |all| {
        if let Some(a) = all.accounts.iter_mut().find(|a| a.id == account_id) {
            a.name = name.clone();
            a.data = s.data;
        }
        Ok(())
    })?;
    Ok(Session { name, uuid, token: s.token, user_type, jvm_args })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_and_selects() {
        let root = std::env::temp_dir().join(format!("tn-accounts-{}", std::process::id()));
        let state = AppState::new(root.clone()).unwrap();
        assert!(selected(&state).is_none());
        let ms = auth::Account { name: "Steve".into(), uuid: "u".into(), token: "t".into(), expires_at: 0, refresh_token: "r".into() };
        storage::save_account(&state, Some(&ms)).unwrap();
        // The old single account shows up selected, and stays once accounts.json exists.
        let view = selected(&state).unwrap();
        assert_eq!((view.name.as_str(), view.provider_name.as_str()), ("Steve", "Microsoft"));
        select(&state, None).unwrap();
        assert!(selected(&state).is_none());
        assert_eq!(list(&state).len(), 1);
        select(&state, Some(&view.id)).unwrap();
        remove(&state, &view.id).unwrap();
        assert!(list(&state).is_empty() && selected(&state).is_none());
        assert!(select(&state, Some("nope")).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn checks_plugin_identity() {
        assert_eq!(check_uuid("069A79F4-44E9-4726-A5BE-FCA90E38AAF5").unwrap(), "069a79f444e94726a5befca90e38aaf5");
        assert!(check_uuid("not-a-uuid").is_err());
        assert!(check_name("Notch").is_ok());
        assert!(check_name("bad name --demo").is_err());
    }
}
