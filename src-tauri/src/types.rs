use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 对应 src/shared/types.ts 中的 AppErrorCode
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AppErrorCode {
    InvalidInput,
    NotFound,
    NetworkError,
    Timeout,
    ParseError,
    DatabaseError,
    Unsupported,
    InternalError,
}

impl std::fmt::Display for AppErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidInput => write!(f, "INVALID_INPUT"),
            Self::NotFound => write!(f, "NOT_FOUND"),
            Self::NetworkError => write!(f, "NETWORK_ERROR"),
            Self::Timeout => write!(f, "TIMEOUT"),
            Self::ParseError => write!(f, "PARSE_ERROR"),
            Self::DatabaseError => write!(f, "DATABASE_ERROR"),
            Self::Unsupported => write!(f, "UNSUPPORTED"),
            Self::InternalError => write!(f, "INTERNAL_ERROR"),
        }
    }
}

/// 对应 src/shared/types.ts 中的 AppError
#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: AppErrorCode,
    pub message: String,
    #[serde(skip_serializing)]
    pub internal: Option<String>,
}

impl AppError {
    pub fn new(code: AppErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            internal: None,
        }
    }

    pub fn with_internal(mut self, internal: impl Into<String>) -> Self {
        self.internal = Some(internal.into());
        self
    }

    pub fn invalid_input(msg: impl Into<String>) -> Self {
        Self::new(AppErrorCode::InvalidInput, msg)
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(AppErrorCode::NotFound, msg)
    }

    pub fn network_error(msg: impl Into<String>) -> Self {
        Self::new(AppErrorCode::NetworkError, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(AppErrorCode::Timeout, msg)
    }

    pub fn parse_error(msg: impl Into<String>) -> Self {
        Self::new(AppErrorCode::ParseError, msg)
    }

    pub fn database_error(msg: impl Into<String>) -> Self {
        Self::new(AppErrorCode::DatabaseError, msg)
    }

    pub fn unsupported(msg: impl Into<String>) -> Self {
        Self::new(AppErrorCode::Unsupported, msg)
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(AppErrorCode::InternalError, msg)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<AppError> for String {
    fn from(error: AppError) -> Self {
        error.message
    }
}

// ==================== 通用 IPC 响应 ====================

/// 统一 IPC 成功响应
#[derive(Debug, Serialize)]
pub struct IpcResponse<T: Serialize> {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl<T: Serialize> IpcResponse<T> {
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn err(error: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(error.into()),
        }
    }
}

/// 简单成功/失败响应
#[derive(Debug, Serialize)]
pub struct SimpleResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl SimpleResponse {
    pub fn ok() -> Self {
        Self {
            success: true,
            error: None,
        }
    }
    pub fn err(error: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(error.into()),
        }
    }
}

// ==================== Config 类型 ====================

/// 对应 src/shared/types.ts 中的 Site
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Site {
    pub key: String,
    pub name: String,
    #[serde(rename = "type")]
    pub site_type: i64,
    pub api: Option<String>,
    pub searchable: Option<i64>,
    pub ext: Option<Value>,
    pub jar: Option<String>,
}

/// 对应 src/shared/types.ts 中的 LiveSource
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveSource {
    pub name: String,
    #[serde(rename = "type")]
    pub live_type: Option<i64>,
    pub url: Option<String>,
    pub api: Option<String>,
    pub ext: Option<Value>,
    pub jar: Option<String>,
    pub epg: Option<String>,
    pub logo: Option<String>,
    pub ua: Option<String>,
    pub referer: Option<String>,
    pub header: Option<Value>,
    pub player_type: Option<i64>,
}

/// 对应 src/shared/types.ts 中的 Parse 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseConfig {
    pub name: String,
    #[serde(rename = "type")]
    pub parse_type: Option<i64>,
    pub url: Option<String>,
    pub ext: Option<Value>,
}

/// VodConfig 配置顶层
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VodConfig {
    pub spider: Option<String>,
    pub sites: Option<Vec<Site>>,
    pub lives: Option<Vec<LiveSource>>,
    pub parses: Option<Vec<ParseConfig>>,
    pub doh: Option<Vec<Value>>,
    pub proxy: Option<Vec<Value>>,
    pub rules: Option<Vec<Value>>,
    pub headers: Option<Value>,
    pub hosts: Option<Vec<String>>,
    pub ads: Option<Vec<String>>,
}

/// 配置预检结果
#[derive(Debug, Clone, Serialize)]
pub struct ConfigInspection {
    pub url: String,
    pub name: String,
    pub site_count: i64,
    pub visible_site_count: i64,
    pub searchable_site_count: i64,
    pub unsupported_site_count: i64,
    pub live_count: i64,
    pub parse_count: i64,
    pub has_spider: bool,
    pub source_type: Option<String>,
    pub compatibility: String,
    pub compatibility_label: String,
    pub can_import: bool,
    pub hidden_site_count: i64,
    pub csp_site_count: i64,
    pub missing_api_site_count: i64,
    pub probe_inspected_site_count: i64,
    pub probe_passed_site_count: i64,
    pub probe_failed_site_count: i64,
    pub probe_skipped_site_count: i64,
    pub live_channel_count: i64,
    pub warnings: Vec<String>,
}

/// 配置列表项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigItem {
    pub url: String,
    pub name: String,
    pub add_time: i64,
    pub update_time: i64,
}

// ==================== Live 类型 ====================

/// 频道
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Channel {
    pub name: String,
    pub urls: Vec<String>,
}

/// 频道分组
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub name: String,
    pub channel: Vec<Channel>,
}

/// 刷新状态（前端格式）
#[derive(Debug, Clone, Serialize)]
pub struct RefreshStatus {
    pub is_refreshing: bool,
    pub last_refresh_time: i64,
    pub next_refresh_time: i64,
    pub progress: Option<Value>,
    pub interval: i64,
}

// ==================== 历史/收藏/缓存 ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryItem {
    pub site_key: String,
    pub vod_id: String,
    pub vod_name: String,
    pub vod_pic: Option<String>,
    pub vod_remarks: Option<String>,
    #[serde(rename = "type")]
    pub item_type: Option<i64>,
    pub source: Option<String>,
    pub progress: Option<i64>,
    pub episode_id: Option<String>,
    pub episode_name: Option<String>,
    pub episode_index: Option<i64>,
    pub source_index: Option<i64>,
    pub source_name: Option<String>,
    pub url_identifier: Option<String>,
    pub duration: Option<i64>,
    pub position_seconds: Option<i64>,
    pub completed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeepItem {
    pub site_key: String,
    pub vod_id: String,
    pub vod_name: String,
    pub vod_pic: Option<String>,
    pub vod_remarks: Option<String>,
    #[serde(rename = "type")]
    pub item_type: Option<i64>,
    pub source: Option<String>,
}
