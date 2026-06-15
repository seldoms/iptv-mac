use std::time::Duration;

use reqwest::{Client, ClientBuilder};
use serde_json::Value;

use crate::error::AppError;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) IPTV-Mac/1.0";
const MAX_RESPONSE_SIZE: u64 = 50 * 1024 * 1024; // 50MB

/// 创建带默认配置的 HTTP client
pub fn create_client() -> Result<Client, AppError> {
    ClientBuilder::new()
        .user_agent(DEFAULT_USER_AGENT)
        .timeout(DEFAULT_TIMEOUT)
        .danger_accept_invalid_certs(true)
        .gzip(true)
        .build()
        .map_err(|e| AppError::network_error("创建 HTTP client 失败").with_internal(e.to_string()))
}

/// 带超时和大小限制的 GET 请求
pub async fn http_get(client: &Client, url: &str) -> Result<String, AppError> {
    let response = client.get(url).send().await.map_err(|e| {
        if e.is_timeout() {
            AppError::timeout(format!("请求超时: {}", url))
        } else if e.is_connect() {
            AppError::network_error(format!("无法连接: {}", url))
        } else {
            AppError::network_error(format!("请求失败: {}", url)).with_internal(e.to_string())
        }
    })?;

    let status = response.status();
    if !status.is_success() {
        return Err(AppError::network_error(format!(
            "HTTP {}: {}",
            status.as_u16(),
            url
        )));
    }

    let content = response
        .text()
        .await
        .map_err(|e| AppError::network_error("读取响应失败").with_internal(e.to_string()))?;

    if content.len() as u64 > MAX_RESPONSE_SIZE {
        return Err(AppError::network_error(format!(
            "响应超过大小限制 ({} > {}MB)",
            content.len(),
            MAX_RESPONSE_SIZE / 1024 / 1024
        )));
    }

    Ok(content)
}

/// 带超时和大小限制的 GET 请求，返回 JSON
pub async fn http_get_json(client: &Client, url: &str) -> Result<Value, AppError> {
    let text = http_get(client, url).await?;
    serde_json::from_str(&text)
        .map_err(|e| AppError::parse_error("响应不是合法 JSON").with_internal(e.to_string()))
}

/// 带额外 header 的 GET 请求
pub async fn http_get_with_headers(
    client: &Client,
    url: &str,
    headers: &[(&str, &str)],
) -> Result<String, AppError> {
    let mut req = client.get(url);
    for (key, value) in headers {
        req = req.header(*key, *value);
    }
    let response = req.send().await.map_err(|e| {
        if e.is_timeout() {
            AppError::timeout(format!("请求超时: {}", url))
        } else {
            AppError::network_error(format!("请求失败: {}", url)).with_internal(e.to_string())
        }
    })?;

    if !response.status().is_success() {
        return Err(AppError::network_error(format!(
            "HTTP {}: {}",
            response.status().as_u16(),
            url
        )));
    }

    response
        .text()
        .await
        .map_err(|e| AppError::network_error("读取响应失败").with_internal(e.to_string()))
}

/// 清理 JSON 文本：去除 BOM、注释、trailing comma、控制字符
/// 清理 JSON/JSONP 响应文本。
pub fn clean_json_text(text: &str) -> String {
    let text = text.trim();

    // 去除 BOM
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);

    // 去除 // 注释（不在字符串内的）
    let mut result = String::with_capacity(text.len());
    let mut in_string = false;
    let mut escaped = false;
    let mut chars = text.chars().peekable();

    while let Some(ch) = chars.next() {
        if in_string {
            result.push(ch);

            if escaped {
                escaped = false;
                continue;
            }
            if ch == '\\' {
                escaped = true;
                continue;
            }
            if ch == '"' {
                in_string = false;
            }
            continue;
        }

        if ch == '"' {
            in_string = !in_string;
            result.push(ch);
            continue;
        }

        if ch == '/' && chars.peek() == Some(&'/') {
            // 跳过整行注释
            while let Some(c) = chars.next() {
                if c == '\n' || c == '\r' {
                    result.push(c);
                    break;
                }
            }
            continue;
        }
        if ch == ',' {
            // 跳过 trailing comma 前的空白和 }
            let mut found_close = false;
            let mut saved_chars: Vec<char> = Vec::new();

            while let Some(&next) = chars.peek() {
                if next == '}' || next == ']' {
                    found_close = true;
                    break;
                }
                if !next.is_whitespace() {
                    break;
                }
                saved_chars.push(chars.next().unwrap());
            }

            if found_close {
                // comma 后直接是 } 或 ]，跳过 comma
                continue;
            }
            // 正常 comma
            result.push(ch);
            for c in saved_chars {
                result.push(c);
            }
            continue;
        }

        result.push(ch);
    }

    result
}

/// 安全 JSON 解析，首次失败后尝试清理再解析
/// 容错解析 JSON 响应。
pub fn safe_json_parse(text: &str) -> Result<Value, AppError> {
    // 首次直接尝试
    match serde_json::from_str(text) {
        Ok(value) => return Ok(value),
        Err(_) => {}
    }

    // 清理后重试
    let cleaned = clean_json_text(text);
    serde_json::from_str(&cleaned).map_err(|e| {
        AppError::parse_error("JSON 格式错误，请检查内容是否完整").with_internal(format!(
            "{}. cleaned_length={}",
            e,
            cleaned.len()
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_json_removes_bom() {
        let input = "\u{feff}{\"key\": \"value\"}";
        let result = clean_json_text(input);
        assert_eq!(result, "{\"key\": \"value\"}");
    }

    #[test]
    fn clean_json_removes_comments() {
        let input = "{\n  // 这是注释\n  \"key\": \"value\"\n}";
        let result = clean_json_text(input);
        assert!(result.contains("\"key\""));
        assert!(!result.contains("//"));
    }

    #[test]
    fn clean_json_removes_trailing_comma() {
        let input = "{\"a\": 1, \"b\": 2,}";
        let result = clean_json_text(input);
        assert_eq!(result, "{\"a\": 1, \"b\": 2}");
    }

    #[test]
    fn clean_json_preserves_comma_in_string() {
        let input = "{\"a\": \"hello, world\"}";
        let result = clean_json_text(input);
        assert_eq!(result, input);
    }

    #[test]
    fn clean_json_preserves_urls_after_escaped_quotes() {
        let input = r#"{
            "rule": "class=\"play-source-tab\"&&div>",
            "url": "https://example.com/show/{cateId}.html"
        }"#;
        let result = clean_json_text(input);
        assert!(result.contains(r#"class=\"play-source-tab\""#));
        assert!(result.contains("https://example.com/show/{cateId}.html"));
        serde_json::from_str::<Value>(&result).unwrap();
    }

    #[test]
    fn safe_json_parse_valid() {
        let result = safe_json_parse("{\"a\": 1}").unwrap();
        assert_eq!(result["a"], 1);
    }

    #[test]
    fn safe_json_parse_with_comments() {
        let input = "{\n  // comment\n  \"a\": 1\n}";
        let result = safe_json_parse(input).unwrap();
        assert_eq!(result["a"], 1);
    }

    #[test]
    fn safe_json_parse_malformed_returns_error() {
        let result = safe_json_parse("{corrupt}");
        assert!(result.is_err());
    }

    #[test]
    fn http_get_rejects_invalid_url() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let client = create_client().unwrap();
        let result = rt.block_on(http_get(&client, "not a url"));
        assert!(result.is_err());
    }
}
