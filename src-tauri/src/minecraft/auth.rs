//! Player identity: Microsoft accounts and launch sessions.
//! Microsoft: device code → MS token → Xbox Live → XSTS → Minecraft token → profile.
use crate::config::MS_CLIENT_ID;
use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MS: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const SCOPE: &str = "XboxLive.signin offline_access";

/// What the game is started with.
pub struct Session {
    pub name: String,
    pub uuid: String,
    pub token: String,
    /// `msa`, `mojang` (Yggdrasil servers) or `legacy`.
    pub user_type: &'static str,
    /// Extra JVM flags the account needs, e.g. an authlib-injector `-javaagent`.
    pub jvm_args: Vec<String>,
}

/// Persisted Microsoft sign-in; `token` is the Minecraft access token.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub name: String,
    pub uuid: String,
    pub token: String,
    /// Unix seconds.
    pub expires_at: u64,
    pub refresh_token: String,
}

impl Account {
    pub fn session(&self) -> Session {
        Session { name: self.name.clone(), uuid: self.uuid.clone(), token: self.token.clone(), user_type: "msa", jvm_args: vec![] }
    }
    /// True while the Minecraft token has at least a minute left.
    pub fn fresh(&self) -> bool {
        self.expires_at > now() + 60
    }
}

/// Shown to the user: open `verification_uri` and type `user_code`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    pub user_code: String,
    pub verification_uri: String,
}

/// Full interactive sign-in. Resolves once the user approves the code (or it expires).
pub async fn login(c: &reqwest::Client, on_code: impl FnOnce(DeviceCode)) -> Result<Account> {
    let id = client_id()?;
    let (status, dc) = send(c.post(format!("{MS}/devicecode")).form(&[("client_id", id), ("scope", SCOPE)])).await?;
    if status != 200 {
        return Err(ms_error(&dc));
    }
    on_code(DeviceCode { user_code: text(&dc["user_code"]), verification_uri: text(&dc["verification_uri"]) });
    let device_code = text(&dc["device_code"]);
    let mut interval = dc["interval"].as_u64().unwrap_or(5);
    loop {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        let form = [
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("client_id", id),
            ("device_code", &device_code),
        ];
        let (status, r) = send(c.post(format!("{MS}/token")).form(&form)).await?;
        if status == 200 {
            return minecraft(c, &r).await;
        }
        match r["error"].as_str() {
            Some("authorization_pending") => {}
            Some("slow_down") => interval += 5,
            Some("authorization_declined") => return Err(AppError::Invalid("Sign-in was declined".into())),
            Some("expired_token") => return Err(AppError::Invalid("The code expired, sign in again".into())),
            _ => return Err(ms_error(&r)),
        }
    }
}

/// New Minecraft token from the stored refresh token, no user interaction.
pub async fn refresh(c: &reqwest::Client, acc: &Account) -> Result<Account> {
    let form = [
        ("grant_type", "refresh_token"),
        ("client_id", client_id()?),
        ("scope", SCOPE),
        ("refresh_token", &acc.refresh_token),
    ];
    let (status, r) = send(c.post(format!("{MS}/token")).form(&form)).await?;
    if status != 200 {
        return Err(AppError::Invalid(format!("Microsoft session expired, sign in again ({})", ms_error(&r))));
    }
    minecraft(c, &r).await
}

/// MS token response → Xbox Live → XSTS → Minecraft token + profile.
async fn minecraft(c: &reqwest::Client, ms: &Value) -> Result<Account> {
    let (_, xbl) = send(c.post("https://user.auth.xboxlive.com/user/authenticate").json(&json!({
        "Properties": { "AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": format!("d={}", text(&ms["access_token"])) },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT",
    })))
    .await?;
    let xbl_token = xbl["Token"].as_str().ok_or_else(|| AppError::Invalid("Xbox Live sign-in failed".into()))?;

    let (status, xsts) = send(c.post("https://xsts.auth.xboxlive.com/xsts/authorize").json(&json!({
        "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbl_token] },
        "RelyingParty": "rp://api.minecraftservices.com/",
        "TokenType": "JWT",
    })))
    .await?;
    if status != 200 {
        return Err(AppError::Invalid(match xsts["XErr"].as_u64() {
            Some(2148916233) => "This Microsoft account has no Xbox profile. Create one at xbox.com and retry.".into(),
            Some(2148916235) => "Xbox Live is not available in your country.".into(),
            Some(2148916236 | 2148916237) => "This account needs adult verification on xbox.com.".into(),
            Some(2148916238) => "Child account: an adult must add it to a Microsoft family first.".into(),
            _ => format!("Xbox authorization failed (HTTP {status})"),
        }));
    }
    let uhs = text(&xsts["DisplayClaims"]["xui"][0]["uhs"]);

    let (status, mc) = send(c.post("https://api.minecraftservices.com/authentication/login_with_xbox").json(&json!({
        "identityToken": format!("XBL3.0 x={uhs};{}", text(&xsts["Token"])),
    })))
    .await?;
    if status != 200 {
        return Err(AppError::Invalid(if status == 403 {
            "Minecraft rejected this app id: it must be approved by Mojang (aka.ms/mce-reviewappid)".into()
        } else {
            format!("Minecraft sign-in failed (HTTP {status})")
        }));
    }
    let token = text(&mc["access_token"]);

    let (status, profile) =
        send(c.get("https://api.minecraftservices.com/minecraft/profile").bearer_auth(&token)).await?;
    if status == 404 {
        return Err(AppError::NotFound("This Microsoft account does not own Minecraft: Java Edition".into()));
    }
    if status != 200 {
        return Err(AppError::Invalid(format!("Could not load the Minecraft profile (HTTP {status})")));
    }
    Ok(Account {
        name: text(&profile["name"]),
        uuid: text(&profile["id"]),
        token,
        expires_at: now() + mc["expires_in"].as_u64().unwrap_or(86400),
        refresh_token: text(&ms["refresh_token"]),
    })
}

fn client_id() -> Result<&'static str> {
    MS_CLIENT_ID.filter(|s| !s.is_empty()).ok_or_else(|| {
        AppError::Unsupported("Microsoft sign-in is not configured: set TN_MS_CLIENT_ID in .env.local and rebuild".into())
    })
}

/// These endpoints put useful JSON in error responses, so the status is returned, not raised.
async fn send(req: reqwest::RequestBuilder) -> Result<(u16, Value)> {
    let r = req.header("Accept", "application/json").send().await?;
    let status = r.status().as_u16();
    Ok((status, r.json().await.unwrap_or(Value::Null)))
}

fn ms_error(r: &Value) -> AppError {
    let msg = r["error_description"].as_str().or(r["error"].as_str()).unwrap_or("unknown error");
    AppError::Invalid(format!("Microsoft sign-in failed: {}", msg.lines().next().unwrap_or(msg)))
}

fn text(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}
