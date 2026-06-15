use std::fmt;

use serde::Serialize;

/// 错误码枚举，对应 src/shared/errors.ts 中的 AppErrorCode
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub enum ErrorCode {
    InvalidInput,
    NotFound,
    NetworkError,
    Timeout,
    ParseError,
    DatabaseError,
    Unsupported,
    InternalError,
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
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

/// 统一应用错误。
#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip)]
    pub internal: Option<String>,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
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

    /// 将错误转换为前端 IPC 响应格式
    pub fn to_response(&self) -> serde_json::Value {
        serde_json::json!({ "success": false, "error": self.message })
    }

    // Convenience constructors
    pub fn invalid_input(msg: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidInput, msg)
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(ErrorCode::NotFound, msg)
    }
    pub fn network_error(msg: impl Into<String>) -> Self {
        Self::new(ErrorCode::NetworkError, msg)
    }
    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(ErrorCode::Timeout, msg)
    }
    pub fn parse_error(msg: impl Into<String>) -> Self {
        Self::new(ErrorCode::ParseError, msg)
    }
    pub fn database_error(msg: impl Into<String>) -> Self {
        Self::new(ErrorCode::DatabaseError, msg)
    }
    pub fn unsupported(msg: impl Into<String>) -> Self {
        Self::new(ErrorCode::Unsupported, msg)
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(ErrorCode::InternalError, msg)
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<AppError> for String {
    fn from(error: AppError) -> Self {
        error.message
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        Self::parse_error("JSON 解析失败").with_internal(e.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        Self::database_error("数据库操作失败").with_internal(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self::internal("文件操作失败").with_internal(e.to_string())
    }
}

impl From<String> for AppError {
    fn from(e: String) -> Self {
        Self::database_error(e)
    }
}
