//! Account skins for Profiles. Textures are fetched here rather than in the webview: no CORS or mixed
//! content, a disk cache keeps them showing offline, and links a plugin hands out stay on its hosts.
use super::account::{self, Account, MICROSOFT};
use crate::error::{AppError, Result};
use crate::minecraft::http;
use crate::plugins::{self, host::host_allowed, js::Skin};
use crate::state::AppState;
use crate::storage;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use serde_json::{json, Value};
use sha1::{Digest, Sha1};

/// HD skins (up to 1024×1024) stay far below this.
const MAX_BYTES: usize = 2 << 20;
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";

#[derive(Serialize)]
pub struct SkinView {
    /// `data:image/png;base64,...`
    pub texture: String,
    pub slim: bool,
}

/// The account's skin. Offline or when the provider fails, the last one seen is shown.
pub async fn skin(state: &AppState, id: &str) -> Result<Option<SkinView>> {
    let acc = account::find(state, id)?;
    // Account ids are our own (hex or `microsoft-<uuid>`), hashed anyway to keep the name a plain file.
    let last = state.paths.skins_dir().join(format!("{}.json", hash(&acc.id)));
    let skin = match resolve(state, &acc).await {
        Ok(skin) => {
            std::fs::create_dir_all(state.paths.skins_dir())?;
            storage::write(&last, &skin)?;
            skin
        }
        Err(_) if last.exists() => storage::read::<Option<Skin>>(&last),
        Err(e) => return Err(e),
    };
    let Some(skin) = skin else { return Ok(None) };
    let png = texture(state, &skin.url).await?;
    Ok(Some(SkinView { texture: format!("data:image/png;base64,{}", STANDARD.encode(png)), slim: skin.slim }))
}

/// Where the skin is: Mojang's session server for Microsoft accounts, the plugin's `skin` otherwise.
async fn resolve(state: &AppState, acc: &Account) -> Result<Option<Skin>> {
    let (skin, hosts) = if acc.provider == MICROSOFT {
        let url = format!("https://sessionserver.mojang.com/session/minecraft/profile/{}", acc.uuid);
        (textures_of(&http::get_json(&state.http, &url).await?), vec!["textures.minecraft.net".to_string()])
    } else {
        let plugin = plugins::enabled(state, &acc.provider)?;
        let skin = plugin.account()?.skin(json!({ "name": acc.name, "uuid": acc.uuid, "data": acc.data })).await?;
        (skin, plugin.manifest.permissions.hosts.clone())
    };
    let Some(skin) = skin else { return Ok(None) };
    let url = secure_url(&skin.url).filter(|u| host_allowed(&hosts, u)).ok_or_else(|| AppError::Invalid(format!("{} is not an allowed skin host", skin.url)))?;
    Ok(Some(Skin { url, slim: skin.slim }))
}

/// The PNG behind `url`, from the cache when seen before. Texture links are content-addressed, so it never goes stale.
// ponytail: no eviction, a skin is a few KB; prune the folder if it ever grows.
async fn texture(state: &AppState, url: &str) -> Result<Vec<u8>> {
    let path = state.paths.skins_dir().join(format!("{}.png", hash(url)));
    if let Ok(png) = std::fs::read(&path) {
        return Ok(png);
    }
    let png = http::fetch_bytes(&state.http, url).await?;
    if png.len() > MAX_BYTES || !png.starts_with(PNG) {
        return Err(AppError::Invalid(format!("{url} is not a skin")));
    }
    std::fs::create_dir_all(state.paths.skins_dir())?;
    std::fs::write(&path, &png)?;
    Ok(png)
}

/// The skin in a Yggdrasil profile: its `textures` property is base64 JSON.
fn textures_of(profile: &Value) -> Option<Skin> {
    let b64 = profile["properties"].as_array()?.iter().find(|p| p["name"] == "textures")?["value"].as_str()?;
    let v: Value = serde_json::from_slice(&STANDARD.decode(b64).ok()?).ok()?;
    let skin = &v["textures"]["SKIN"];
    Some(Skin { url: skin["url"].as_str()?.into(), slim: skin["metadata"]["model"] == "slim" })
}

/// Texture hosts hand out http:// links; they all serve https too.
fn secure_url(url: &str) -> Option<String> {
    match url.strip_prefix("http://") {
        Some(rest) => Some(format!("https://{rest}")),
        None => url.starts_with("https://").then(|| url.into()),
    }
}

fn hash(s: &str) -> String {
    Sha1::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(textures: &str) -> Value {
        json!({ "properties": [{ "name": "textures", "value": STANDARD.encode(textures) }] })
    }

    #[test]
    fn reads_profile_textures() {
        let classic = profile(r#"{"textures":{"SKIN":{"url":"http://textures.minecraft.net/texture/abc"}}}"#);
        assert_eq!(textures_of(&classic), Some(Skin { url: "http://textures.minecraft.net/texture/abc".into(), slim: false }));
        let slim = profile(r#"{"textures":{"SKIN":{"url":"https://x/s.png","metadata":{"model":"slim"}}}}"#);
        assert!(textures_of(&slim).unwrap().slim);
        assert_eq!(textures_of(&profile(r#"{"textures":{}}"#)), None);
        assert_eq!(textures_of(&json!({ "properties": [{ "name": "textures", "value": "%%%" }] })), None);
        assert_eq!(textures_of(&json!({})), None);
    }

    #[test]
    fn keeps_links_on_https() {
        assert_eq!(secure_url("http://ely.by/s.png").as_deref(), Some("https://ely.by/s.png"));
        assert_eq!(secure_url("https://ely.by/s.png").as_deref(), Some("https://ely.by/s.png"));
        assert_eq!(secure_url("file:///etc/passwd"), None);
        let hosts = ["textures.minecraft.net".to_string()];
        assert!(host_allowed(&hosts, "https://textures.minecraft.net/texture/abc"));
        assert!(!host_allowed(&hosts, "https://127.0.0.1/texture/abc"));
    }
}
