//! Build-time configuration: shell or .env files, baked in by build.rs. Every `TN_*` variable lives here.

/// Azure app id for Microsoft sign-in. TNLauncher's own id is the default; forks must set
/// `TN_MS_CLIENT_ID` to their own (see README). Empty disables sign-in.
pub const MS_CLIENT_ID: Option<&str> = match option_env!("TN_MS_CLIENT_ID") {
    Some(id) => Some(id),
    None => Some("ce3de089-adcd-42e1-ab52-d9f657d86a6c"),
};
