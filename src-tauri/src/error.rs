use serde::{Serialize, Serializer};

/// Every failure the backend can report. Serialized to the frontend as `{ kind, message }`.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("Network error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("{url} returned HTTP {status}")]
    Status { url: String, status: u16 },
    #[error("Corrupted archive: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Unsupported(String),
    #[error("Plugin error: {0}")]
    Plugin(String),
    #[error("Cancelled")]
    Cancelled,
}

impl AppError {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Io(_) => "io",
            Self::Json(_) => "json",
            Self::Http(_) | Self::Status { .. } => "network",
            Self::Zip(_) => "archive",
            Self::Tauri(_) => "tauri",
            Self::NotFound(_) => "notFound",
            Self::Invalid(_) => "invalid",
            Self::Conflict(_) => "conflict",
            Self::Unsupported(_) => "unsupported",
            Self::Plugin(_) => "plugin",
            Self::Cancelled => "cancelled",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
