use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::Value;

use crate::error::AppError;
use crate::spider;

// ==================== 解析缓存 ====================

const CACHE_TTL: u64 = 30 * 60; // 30 minutes in seconds

struct CacheEntry {
    url: String,
    header: Option<HashMap<String, String>>,
    from: String,
    time: u64,
}

static PARSE_CACHE: LazyLock<Mutex<HashMap<String, CacheEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn cache_get(key: &str) -> Option<ParseResult> {
    let mut cache = PARSE_CACHE.lock();
    let entry = cache.get(key)?;
    if now().saturating_sub(entry.time) < CACHE_TTL {
        Some(ParseResult {
            url: entry.url.clone(),
            header: entry.header.clone(),
            from: format!("{}(cache)", entry.from),
        })
    } else {
        cache.remove(key);
        None
    }
}

fn cache_set(key: &str, result: &ParseResult) {
    let mut cache = PARSE_CACHE.lock();
    if cache.len() > 200 {
        let now = now();
        cache.retain(|_, v| now.saturating_sub(v.time) < CACHE_TTL);
    }
    cache.insert(
        key.to_string(),
        CacheEntry {
            url: result.url.clone(),
            header: result.header.clone(),
            from: result.from.clone(),
            time: now(),
        },
    );
}

// ==================== 解析结果 ====================

#[derive(Debug, Clone, Serialize)]
pub struct ParseResult {
    pub url: String,
    pub header: Option<HashMap<String, String>>,
    pub from: String,
}

// ==================== Level 1: JSON Parse ====================

/// JSON 解析：调用 parse API 获取播放地址
pub async fn json_parse(
    parse_url: &str,
    web_url: &str,
    headers: Option<&HashMap<String, String>>,
) -> Result<Option<ParseResult>, AppError> {
    let client = crate::network::create_client()?;

    // Validate parse_url is a safe absolute http/https URL
    let base_parsed = url::Url::parse(parse_url)
        .map_err(|e| AppError::invalid_input("无效的解析地址").with_internal(e.to_string()))?;
    match base_parsed.scheme() {
        "http" | "https" => {}
        _ => return Err(AppError::invalid_input("不支持的解析协议")),
    }
    // urlencoding::encode prevents URL injection in web_url (escapes ?#@ etc.)
    let full_url = format!("{}{}", parse_url, urlencoding::encode(web_url));

    let mut req = client
        .get(&full_url)
        .timeout(Duration::from_secs(3))
        .header(
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        );

    if let Some(h) = headers {
        for (k, v) in h {
            req = req.header(k.as_str(), v.as_str());
        }
    }

    let resp = match req.send().await {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            return Err(AppError::network_error(format!(
                "JSON parse HTTP {}",
                r.status()
            )))
        }
        Err(e) => {
            return Err(AppError::network_error(format!(
                "JSON parse request failed: {}",
                e
            )))
        }
    };

    let text = resp
        .text()
        .await
        .map_err(|e| AppError::network_error(format!("JSON parse read failed: {}", e)))?;
    let data: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };

    // Extract URL from various response formats
    let url = data
        .get("url")
        .or_else(|| data.get("playUrl"))
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .or_else(|| {
            data.get("data")
                .and_then(|d| {
                    d.get("url")
                        .or_else(|| d.get("playUrl"))
                        .and_then(Value::as_str)
                })
                .map(|s| s.to_string())
        })
        .filter(|u| u.len() >= 10);

    let url = match url {
        Some(u) => u,
        None => return Ok(None),
    };

    // Extract headers
    let mut result_headers = HashMap::new();
    if let Some(h) = data.get("header").and_then(|v| v.as_object()) {
        for (k, v) in h {
            if let Some(val) = v.as_str() {
                result_headers.insert(k.clone(), val.to_string());
            }
        }
    }
    for key in &[
        "User-Agent",
        "user-agent",
        "ua",
        "Referer",
        "referer",
        "Cookie",
        "cookie",
    ] {
        if let Some(val) = data.get(*key).and_then(Value::as_str) {
            result_headers.insert(key.to_string(), val.to_string());
        }
    }

    let header = if result_headers.is_empty() {
        None
    } else {
        Some(result_headers)
    };

    Ok(Some(ParseResult {
        url,
        header,
        from: "json_parse".to_string(),
    }))
}

// ==================== SuperParse 入口 ====================

/// 三层解析入口
/// Level 0: 直链识别
/// Level 1: JSON Parse
/// Level 2: Web sniff (not yet migrated, requires Tauri webview)
/// Level 3: Chromium sniffer (not yet migrated)
pub async fn super_parse(
    url: &str,
    _flag: &str,
    _site_key: &str,
    player_result: Option<&Value>,
    parses: Option<&Vec<Value>>,
) -> Result<Option<ParseResult>, AppError> {
    let mut result_url = url.to_string();
    let mut parse_flag = 0i64;
    let mut result_header: Option<HashMap<String, String>> = None;
    let mut play_url: Option<String> = None;

    if let Some(pr) = player_result {
        result_url = pr
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or(url)
            .to_string();
        parse_flag = pr.get("parse").and_then(Value::as_i64).unwrap_or(0);
        if let Some(h) = pr.get("header").and_then(|v| v.as_object()) {
            let mut headers = HashMap::new();
            for (k, v) in h {
                if let Some(val) = v.as_str() {
                    headers.insert(k.clone(), val.to_string());
                }
            }
            result_header = Some(headers);
        }
        play_url = pr
            .get("playUrl")
            .or_else(|| pr.get("play_url"))
            .and_then(Value::as_str)
            .map(String::from);
    }

    // Check if direct
    if spider::is_video_format(&result_url) {
        return Ok(Some(ParseResult {
            url: result_url,
            header: result_header,
            from: if player_result.is_some() {
                "playerContent".to_string()
            } else {
                "direct".to_string()
            },
        }));
    }

    if parse_flag == 0 && !spider::need_parse(&result_url, play_url.as_deref()) {
        return Ok(Some(ParseResult {
            url: result_url,
            header: result_header,
            from: "direct".to_string(),
        }));
    }

    // Check cache
    let cache_key = format!("{}|{}", result_url, _flag);
    if let Some(cached) = cache_get(&cache_key) {
        return Ok(Some(cached));
    }

    // Level 1: JSON parse
    if let Some(parses_list) = parses {
        for parse_item in parses_list {
            let parse_type = parse_item.get("type").and_then(Value::as_i64).unwrap_or(0);
            let parse_url = parse_item.get("url").and_then(Value::as_str);

            if parse_type == 1 && parse_url.is_some() {
                let result =
                    json_parse(parse_url.unwrap(), &result_url, result_header.as_ref()).await?;
                if let Some(r) = result {
                    cache_set(&cache_key, &r);
                    return Ok(Some(r));
                }
            }
        }
    }

    // Level 2/3: Web sniff (not yet migrated)
    // Try playUrl fallback
    if let Some(pu) = play_url {
        // Validate play_url as safe http/https before concatenation
        if !pu.starts_with("http://") && !pu.starts_with("https://") {
            return Ok(None);
        }
        let encoded = urlencoding::encode(&result_url);
        let full_url = format!("{}{}", pu, encoded);
        if spider::is_video_format(&full_url) {
            let result = ParseResult {
                url: full_url,
                header: result_header,
                from: "playUrl".to_string(),
            };
            cache_set(&cache_key, &result);
            return Ok(Some(result));
        }
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_direct_video() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt
            .block_on(super_parse(
                "https://example.com/video.mp4",
                "play",
                "test_site",
                None,
                None,
            ))
            .unwrap();
        assert!(result.is_some());
        assert_eq!(result.unwrap().from, "direct");
    }

    #[test]
    fn returns_none_for_unknown_url() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt
            .block_on(super_parse(
                "https://example.com/page.html",
                "play",
                "test_site",
                None,
                None,
            ))
            .unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn json_parse_rejects_invalid_url() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(json_parse(
            "https://nonexistent.invalid/parse?url=",
            "https://example.com/v.mp4",
            None,
        ));
        assert!(result.is_err());
    }

    #[test]
    fn parse_cache_is_safe_across_threads() {
        let handles: Vec<_> = (0..16)
            .map(|index| {
                std::thread::spawn(move || {
                    let key = format!("cache-key-{index}");
                    let result = ParseResult {
                        url: format!("https://example.com/{index}.m3u8"),
                        header: None,
                        from: "test".to_string(),
                    };
                    cache_set(&key, &result);
                    assert_eq!(cache_get(&key).unwrap().url, result.url);
                })
            })
            .collect();

        for handle in handles {
            handle.join().unwrap();
        }
    }
}
