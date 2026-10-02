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

    // 使用 Url API 安全构建请求 URL，替代 raw format! 拼接
    let mut parsed = url::Url::parse(parse_url)
        .map_err(|e| AppError::invalid_input("无效的解析地址").with_internal(e.to_string()))?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err(AppError::invalid_input("不支持的解析协议")),
    }
    // 只替换目标 URL，保留解析接口自身的鉴权和其他参数。
    let params: Vec<(String, String)> = parsed
        .query_pairs()
        .filter(|(key, _)| key != "url")
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    parsed
        .query_pairs_mut()
        .clear()
        .extend_pairs(params)
        .append_pair("url", web_url);
    let full_url = parsed.to_string();

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
    let mut result_headers = headers.cloned().unwrap_or_default();
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

// 静态播放页仅提取媒体元素和明确的 URL 字面量，不执行网页脚本。
fn extract_page_media(page_url: &str, html: &str) -> Option<String> {
    let base = url::Url::parse(page_url).ok()?;
    let resolve = |value: &str| -> Option<String> {
        let target = base.join(value.trim()).ok()?;
        if !matches!(target.scheme(), "http" | "https") || !spider::is_video_format(target.as_str())
        {
            return None;
        }
        Some(target.to_string())
    };
    let doc = dom_query::Document::from(html);
    for node in doc
        .select("video[src], video source[src], audio[src], audio source[src]")
        .iter()
    {
        if let Some(media) = node.attr("src").and_then(|src| resolve(&src)) {
            return Some(media);
        }
    }
    static URL_LITERAL: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r#"(?:\b(?:const|let|var)\s+url\s*=|["']?(?:url|file|src)["']?\s*:)\s*("(?:[^"\\]|\\.)*")"#).unwrap()
    });
    for script in doc.select("script:not([src])").iter() {
        for captures in URL_LITERAL.captures_iter(&script.text()) {
            if let Ok(value) = serde_json::from_str::<String>(&captures[1]) {
                if let Some(media) = resolve(&value) {
                    return Some(media);
                }
            }
        }
    }
    None
}

async fn parse_media_page(
    page_url: &str,
    headers: Option<&HashMap<String, String>>,
) -> Result<Option<ParseResult>, AppError> {
    let client = crate::network::create_client()?;
    let mut request = client.get(page_url).timeout(Duration::from_secs(8));
    if let Some(headers) = headers {
        for (key, value) in headers {
            request = request.header(key, value);
        }
    }
    let mut response = request
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|e| AppError::network_error("播放页面请求失败").with_internal(e.to_string()))?;
    let final_url = response.url().to_string();
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| AppError::network_error(e.to_string()))?
    {
        if body.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err(AppError::parse_error("播放页面超过 2MB"));
        }
        body.extend_from_slice(&chunk);
    }
    let Some(url) = extract_page_media(&final_url, &String::from_utf8_lossy(&body)) else {
        return Ok(None);
    };
    let mut header = headers.cloned().unwrap_or_default();
    if !header.keys().any(|key| key.eq_ignore_ascii_case("referer")) {
        header.insert("Referer".into(), final_url);
    }
    Ok(Some(ParseResult {
        url,
        header: Some(header),
        from: "media_page".into(),
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

    if parse_flag == 0 && player_result.is_some() && play_url.as_deref().unwrap_or("").is_empty()
        && url::Url::parse(&result_url).is_ok_and(|url| matches!(url.scheme(), "http" | "https")) {
        return Ok(Some(ParseResult {
            url: result_url,
            header: result_header,
            from: "direct".to_string(),
        }));
    }

    // Check cache
    let cache_key = serde_json::json!([_site_key, result_url, _flag, result_header, parses]).to_string();
    if let Some(cached) = cache_get(&cache_key) {
        return Ok(Some(cached));
    }

    if let Ok(Some(result)) = parse_media_page(&result_url, result_header.as_ref()).await {
        cache_set(&cache_key, &result);
        return Ok(Some(result));
    }

    // Level 1: JSON parse
    if let Some(parses_list) = parses {
        for parse_item in parses_list {
            let parse_type = parse_item.get("type").and_then(Value::as_i64).unwrap_or(0);
            let parse_url = parse_item.get("url").and_then(Value::as_str);

            if parse_type == 1 && parse_url.is_some() {
                let result =
                    json_parse(parse_url.unwrap(), &result_url, result_header.as_ref()).await;
                if let Ok(Some(r)) = result {
                    cache_set(&cache_key, &r);
                    return Ok(Some(r));
                }
            }
        }
    }

    // Level 2/3: Web sniff (not yet migrated)
    // Try playUrl fallback
    if let Some(pu) = play_url {
        // 安全拼接：对 result_url 进行 encoding，再验证最终 URL 合法
        let encoded = urlencoding::encode(&result_url);
        let concatenated = format!("{}{}", pu, encoded);
        let full_url = match url::Url::parse(&concatenated) {
            Ok(u) if u.scheme() == "http" || u.scheme() == "https" => u.to_string(),
            _ => return Ok(None),
        };
        if spider::is_video_format(&full_url) {
            let result = ParseResult {
                url: full_url,
                header: result_header,
                from: "playUrl".to_string(),
            };
            cache_set(&cache_key, &result);
            return Ok(Some(result));
        }
        if let Ok(Some(result)) = parse_media_page(&full_url, result_header.as_ref()).await {
            cache_set(&cache_key, &result);
            return Ok(Some(result));
        }
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn parser_failover_preserves_auth_and_media_headers() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let deadline = std::time::Instant::now() + Duration::from_secs(15);
            let mut paths = Vec::new();
            while paths.len() < 3 && std::time::Instant::now() < deadline {
                let Ok((mut stream, _)) = listener.accept() else {
                    std::thread::sleep(Duration::from_millis(5));
                    continue;
                };
                let _ = stream.set_nonblocking(false);
                stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                let mut buffer = [0u8; 8192];
                let count = stream.read(&mut buffer).unwrap();
                let request = String::from_utf8_lossy(&buffer[..count]);
                let path = request.split_whitespace().nth(1).unwrap().to_string();
                let (status, body) = if path.starts_with("/good?") {
                    ("200 OK", r#"{"url":"https://example.com/video.mp4"}"#)
                } else if path.starts_with("/bad?") { ("503 Unavailable", "offline") }
                else { ("200 OK", "<html>No embedded media</html>") };
                let response = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                stream.write_all(response.as_bytes()).unwrap();
                paths.push(path);
            }
            paths
        });
        let target = format!("{base}/watch?id=123&part=2");
        let parsers = vec![serde_json::json!({"type":1,"url":format!("{base}/bad?key=keep&url=")}), serde_json::json!({"type":1,"url":format!("{base}/good?key=keep&url=")})];
        let result = super_parse(&target, "test", "failover", Some(&serde_json::json!({"url":target,"parse":1,"header":{"Referer":"https://source.example"}})), Some(&parsers)).await.unwrap().unwrap();
        assert_eq!(result.url, "https://example.com/video.mp4");
        assert_eq!(result.header.unwrap()["Referer"], "https://source.example");
        let paths = server.join().unwrap();
        assert_eq!(paths.len(), 3);
        let request = url::Url::parse(&format!("{base}{}", paths[2])).unwrap();
        let query: HashMap<_, _> = request.query_pairs().into_owned().collect();
        assert_eq!(query["key"], "keep");
        assert_eq!(query["url"], target);
        assert!(!query.contains_key("part"));
    }

    #[test]
    fn extracts_signed_relative_media_from_share_page() {
        let html = r#"<html><script>const url = "/20260711/demo/index.m3u8?sign=abc&v=1";</script></html>"#;
        assert_eq!(
            extract_page_media("https://example.com/share/id", html).as_deref(),
            Some("https://example.com/20260711/demo/index.m3u8?sign=abc&v=1")
        );
    }

    #[test]
    fn extracts_html_media_but_not_script_or_parser_urls() {
        let html = r#"<video><source src="/video.mp4?x=1&amp;y=2"></video>"#;
        assert_eq!(
            extract_page_media("https://example.com/share", html).as_deref(),
            Some("https://example.com/video.mp4?x=1&y=2")
        );
        assert!(extract_page_media("https://example.com", r#"<script src="/hls.js"></script><script>const url = "https://example.com/parse?url=https://other.com/v.m3u8";</script>"#).is_none());
    }

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
