use regex::Regex;
use serde_json::Value;
use std::sync::LazyLock;

/// 敏感 URL 查询参数名（大小写不敏感）
#[allow(dead_code)]
const SENSITIVE_PARAMS: &[&str] = &[
    "token",
    "access_token",
    "refresh_token",
    "api_key",
    "apikey",
    "secret",
    "signature",
    "sig",
    "sign",
    "session",
    "password",
    "passwd",
    "auth",
    "authorization",
];

/// 敏感 header 名（大小写不敏感）
#[allow(dead_code)]
const SENSITIVE_HEADERS: &[&str] = &[
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "token",
    "access-token",
    "refresh-token",
    "api-key",
    "secret",
    "signature",
    "sig",
    "sign",
    "session",
];

static BEARER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)(Bearer\s+)[A-Za-z0-9._\-+/~=]{8,}"#).unwrap());

static COOKIE_VALUE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)((?:Cookie|Set-Cookie):\s*[^=]+=)[^;\r\n]{4,}"#).unwrap());

static TOKEN_IN_URL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)([?&](?:token|api_key|secret|signature|sign|passwd|password)=)[^&]{4,}"#)
        .unwrap()
});

/// 脱敏 URL 中的 token/sign 等敏感查询参数
#[allow(dead_code)]
pub fn redact_url(text: &str) -> String {
    TOKEN_IN_URL_RE
        .replace_all(text, |caps: &regex::Captures| format!("{}***", &caps[1]))
        .to_string()
}

/// 脱敏 Authorization Bearer token
#[allow(dead_code)]
pub fn redact_bearer(text: &str) -> String {
    BEARER_RE
        .replace_all(text, |caps: &regex::Captures| format!("{}***", &caps[1]))
        .to_string()
}

/// 脱敏 Cookie / Set-Cookie 的 value
#[allow(dead_code)]
pub fn redact_cookie(text: &str) -> String {
    COOKIE_VALUE_RE
        .replace_all(text, |caps: &regex::Captures| format!("{}***", &caps[1]))
        .to_string()
}

/// 综合脱敏：URL token + Bearer + Cookie
pub fn redact_text(text: &str) -> String {
    let text = redact_url(text);
    let text = redact_bearer(&text);
    redact_cookie(&text)
}

/// 递归脱敏 JSON Value 中的敏感字段
#[allow(dead_code)]
pub fn redact_value(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut new_map = serde_json::Map::new();
            for (k, v) in map {
                let key_lower = k.to_lowercase();
                let is_sensitive = SENSITIVE_HEADERS.iter().any(|h| key_lower.contains(h));
                if is_sensitive {
                    new_map.insert(k.clone(), Value::String("***".to_string()));
                } else {
                    new_map.insert(k.clone(), redact_value(v));
                }
            }
            Value::Object(new_map)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(redact_value).collect()),
        Value::String(s) => Value::String(redact_text(s)),
        other => other.clone(),
    }
}

/// 格式化日志参数：字符串脱敏，对象递归脱敏
#[allow(dead_code)]
pub fn format_log_arg(arg: &Value) -> String {
    let redacted = redact_value(arg);
    if let Value::String(s) = redacted {
        s
    } else {
        redacted.to_string()
    }
}

/// 对 JSON Value 中的敏感字段进行 in-place 脱敏（用于日志输出）
#[allow(dead_code)]
pub fn redact_json_for_log(value: &mut Value) {
    match value {
        Value::Object(map) => {
            let sensitive_keys: Vec<String> = map
                .keys()
                .filter(|k| {
                    let kl = k.to_lowercase();
                    SENSITIVE_HEADERS.iter().any(|h| kl.contains(h))
                })
                .cloned()
                .collect();
            for key in sensitive_keys {
                map.insert(key, Value::String("***".to_string()));
            }
            for v in map.values_mut() {
                redact_json_for_log(v);
            }
        }
        Value::Array(arr) => {
            for v in arr.iter_mut() {
                redact_json_for_log(v);
            }
        }
        Value::String(s) => {
            *s = redact_text(s);
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_bearer_token() {
        let input = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0";
        let result = redact_text(input);
        assert_eq!(result, "Authorization: Bearer ***");
    }

    #[test]
    fn redacts_token_in_url() {
        let input = "https://api.example.com/data?token=abc123def456&other=ok";
        let result = redact_text(input);
        assert_eq!(result, "https://api.example.com/data?token=***&other=ok");
    }

    #[test]
    fn redacts_cookie_value() {
        let input = "Cookie: session_id=super_secret_value";
        let result = redact_text(input);
        assert_eq!(result, "Cookie: session_id=***");
    }

    #[test]
    fn redacts_authorization_header_in_json() {
        let mut value = serde_json::json!({
            "url": "https://example.com/stream?token=abc123",
            "headers": {
                "Authorization": "Bearer secret123",
                "User-Agent": "Mozilla/5.0"
            }
        });
        redact_json_for_log(&mut value);
        assert_eq!(value["headers"]["Authorization"], "***");
        assert_eq!(value["headers"]["User-Agent"], "Mozilla/5.0");
        assert!(value["url"].as_str().unwrap().contains("***"));
    }

    #[test]
    fn leaves_safe_text_unchanged() {
        let input = "GET /api/vod/list HTTP/1.1";
        let result = redact_text(input);
        assert_eq!(result, input);
    }
}
