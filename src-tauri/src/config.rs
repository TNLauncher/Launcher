//! Build-time configuration: shell or .env files, baked in by build.rs. Every `TN_*` variable lives here.

/// Azure app id for Microsoft sign-in; unset or empty disables it.
pub const MS_CLIENT_ID: Option<&str> = option_env!("TN_MS_CLIENT_ID");
