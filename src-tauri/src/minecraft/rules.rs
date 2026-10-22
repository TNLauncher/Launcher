//! Mojang's `rules` arrays: allow/disallow by OS, arch and launcher features.
use serde_json::Value;

/// Mojang's name for the current OS.
pub fn os_name() -> &'static str {
    match std::env::consts::OS {
        "macos" => "osx",
        os => os,
    }
}

/// Feature flags the launcher offers; everything not listed here is treated as off.
#[derive(Debug, Default, Clone, Copy)]
pub struct Features {
    pub custom_resolution: bool,
}

/// Last matching rule wins; no rules means allowed.
pub fn allowed(rules: Option<&Value>, features: Features) -> bool {
    let Some(rules) = rules.and_then(Value::as_array) else { return true };
    let mut allowed = false;
    for rule in rules {
        let os_ok = rule.get("os").map_or(true, |os| {
            os.get("name").and_then(Value::as_str).map_or(true, |n| n == os_name())
                && os.get("arch").and_then(Value::as_str).map_or(true, |a| a == "x86" && std::env::consts::ARCH == "x86")
        });
        let features_ok = rule.get("features").and_then(Value::as_object).map_or(true, |f| {
            f.iter().all(|(k, v)| v.as_bool() == Some(k == "has_custom_resolution" && features.custom_resolution))
        });
        if os_ok && features_ok {
            allowed = rule["action"] == "allow";
        }
    }
    allowed
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn os_and_features() {
        let other_os = json!([{"action": "allow", "os": {"name": "nonexistent"}}]);
        assert!(!allowed(Some(&other_os), Features::default()));

        let res = json!([{"action": "allow", "features": {"has_custom_resolution": true}}]);
        assert!(allowed(Some(&res), Features { custom_resolution: true }));
        assert!(!allowed(Some(&res), Features::default()));

        let demo = json!([{"action": "allow", "features": {"is_demo_user": true}}]);
        assert!(!allowed(Some(&demo), Features { custom_resolution: true }));

        assert!(allowed(None, Features::default()));
    }
}
