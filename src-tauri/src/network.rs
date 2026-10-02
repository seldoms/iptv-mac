use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use parking_lot::{Mutex, RwLock};
use reqwest::{Client, ClientBuilder, Response};
use serde_json::Value;
use url::Url;

use crate::error::AppError;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
const DEFAULT_USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
/// TVBox 壳客户端 UA：饭太硬/王二小等接口按 UA 分流，只有这个 UA 能拿到配置
const TVBOX_USER_AGENT: &str = "okhttp/3.12.13";
const MAX_RESPONSE_SIZE: u64 = 50 * 1024 * 1024; // 50MB

/// 默认 DoH 端点：阿里公共 DNS（境内可达；Cloudflare/Google 在境内不可达）
const DEFAULT_DOH_ENDPOINT: &str = "https://223.5.5.5/resolve";
const DOH_TIMEOUT: Duration = Duration::from_secs(5);
const DOH_CACHE_TTL: Duration = Duration::from_secs(300);

static DOH_ENDPOINT: LazyLock<RwLock<Option<String>>> = LazyLock::new(|| RwLock::new(None));
static DOH_CACHE: LazyLock<Mutex<HashMap<String, (Vec<IpAddr>, Instant)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 设置配置级 DoH 端点（对应 TVBox 配置的 `doh` 字段），传 `None` 恢复默认
pub fn set_doh_endpoint(endpoint: Option<String>) {
    *DOH_ENDPOINT.write() = endpoint
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
}

/// 当前生效的 DoH 端点
pub fn doh_endpoint() -> String {
    DOH_ENDPOINT
        .read()
        .clone()
        .unwrap_or_else(|| DEFAULT_DOH_ENDPOINT.to_string())
}

/// HTTP client 的公共配置
fn client_builder() -> ClientBuilder {
    ClientBuilder::new()
        .user_agent(DEFAULT_USER_AGENT)
        .connect_timeout(DEFAULT_CONNECT_TIMEOUT)
        .timeout(DEFAULT_TIMEOUT)
        .gzip(true)
}

/// 创建带默认配置的 HTTP client
pub fn create_client() -> Result<Client, AppError> {
    client_builder()
        .build()
        .map_err(|e| AppError::network_error("创建 HTTP client 失败").with_internal(e.to_string()))
}

/* --------------------------------- DoH --------------------------------- */

/// 解析 DoH 的 dns-json 响应（阿里/Cloudflare 同格式），取出 A 记录
pub fn parse_doh_answers(body: &str) -> Vec<IpAddr> {
    let Ok(value) = serde_json::from_str::<Value>(body) else {
        return Vec::new();
    };
    value
        .get("Answer")
        .and_then(Value::as_array)
        .map(|answers| {
            answers
                .iter()
                .filter(|answer| answer.get("type").and_then(Value::as_u64) == Some(1))
                .filter_map(|answer| answer.get("data").and_then(Value::as_str))
                .filter_map(|ip| ip.parse::<IpAddr>().ok())
                .collect()
        })
        .unwrap_or_default()
}

/// 通过 DoH 解析主机名并缓存（仅缓存成功结果，失败下次重试）
async fn resolve_host(host: &str) -> Vec<IpAddr> {
    if let Some((addresses, resolved_at)) = DOH_CACHE.lock().get(host).cloned() {
        if resolved_at.elapsed() < DOH_CACHE_TTL {
            return addresses;
        }
    }
    let addresses = resolve_via_doh(host).await;
    if !addresses.is_empty() {
        DOH_CACHE
            .lock()
            .insert(host.to_string(), (addresses.clone(), Instant::now()));
    }
    addresses
}

/// 通过 DoH 解析主机名；失败返回空列表
async fn resolve_via_doh(host: &str) -> Vec<IpAddr> {
    let endpoint = doh_endpoint();
    let separator = if endpoint.contains('?') { '&' } else { '?' };
    let url = format!(
        "{endpoint}{separator}name={}&type=A",
        urlencoding::encode(host)
    );
    let Ok(client) = client_builder().timeout(DOH_TIMEOUT).build() else {
        return Vec::new();
    };
    match client
        .get(&url)
        .header("accept", "application/dns-json")
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => response
            .text()
            .await
            .map(|body| parse_doh_answers(&body))
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

/// 用 DoH 解析结果构建只覆盖该域名的 client；纯 IP / 无法解析时返回 None
async fn doh_client_for(url: &str) -> Option<Client> {
    let parsed = Url::parse(url).ok()?;
    let host = parsed.host_str()?.to_string();
    if host.parse::<IpAddr>().is_ok() {
        return None;
    }
    let port = parsed.port_or_known_default()?;
    let addresses = resolve_host(&host).await;
    if addresses.is_empty() {
        return None;
    }
    let mut builder = client_builder();
    for address in addresses {
        builder = builder.resolve(&host, SocketAddr::new(address, port));
    }
    builder.build().ok()
}

/* ------------------------------- 请求封装 ------------------------------- */

fn map_request_error(error: &reqwest::Error, url: &str) -> AppError {
    if error.is_timeout() {
        AppError::timeout(format!("请求超时: {}", url))
    } else if error.is_connect() {
        AppError::network_error(format!("无法连接: {}", url))
    } else {
        AppError::network_error(format!("请求失败: {}", url)).with_internal(error.to_string())
    }
}

async fn send_request(
    client: &Client,
    url: &str,
    headers: &[(&str, &str)],
) -> Result<Response, reqwest::Error> {
    let mut request = client.get(url);
    for (key, value) in headers {
        request = request.header(*key, *value);
    }
    request.send().await
}

/// 单次请求：返回 `(错误, 是否值得重试)`。
/// HTTP 4xx/5xx 属于服务端明确应答，不重试；传输失败和响应体截断可重试。
async fn try_get(
    client: &Client,
    url: &str,
    headers: &[(&str, &str)],
) -> Result<String, (AppError, bool)> {
    let response = match send_request(client, url, headers).await {
        Ok(response) => response,
        Err(error) => return Err((map_request_error(&error, url), true)),
    };

    let status = response.status();
    if !status.is_success() {
        return Err((
            AppError::network_error(format!("HTTP {}: {}", status.as_u16(), url)),
            false,
        ));
    }

    match response.text().await {
        Ok(content) => {
            if content.len() as u64 > MAX_RESPONSE_SIZE {
                return Err((
                    AppError::network_error(format!(
                        "响应超过大小限制 ({} > {}MB)",
                        content.len(),
                        MAX_RESPONSE_SIZE / 1024 / 1024
                    )),
                    false,
                ));
            }
            Ok(content)
        }
        // 境内网络对大文件常见半途掐断，表现为解压/解码失败
        Err(error) => Err((
            AppError::network_error("读取响应失败").with_internal(error.to_string()),
            true,
        )),
    }
}

async fn get_text(
    client: &Client,
    url: &str,
    headers: &[(&str, &str)],
    prefer_doh: bool,
) -> Result<String, AppError> {
    // 1) 需要时先用 DoH 解析结果建连
    if prefer_doh {
        if let Some(doh_client) = doh_client_for(url).await {
            if let Ok(text) = try_get(&doh_client, url, headers).await {
                return Ok(text);
            }
        }
    }

    match try_get(client, url, headers).await {
        Ok(text) => Ok(text),
        Err((first, retryable)) => {
            if !retryable {
                return Err(first);
            }
            // 2) 传输失败/响应体截断：换 DoH 解析结果重试
            if let Some(retry_client) = doh_client_for(url).await {
                if let Ok(text) = try_get(&retry_client, url, headers).await {
                    return Ok(text);
                }
            }
            // 3) 再原样重试一次
            try_get(client, url, headers).await.map_err(|_| first)
        }
    }
}

/// 带超时和大小限制的 GET 请求。
///
/// 请求失败（DNS/连接/超时/响应体截断）时会用 DoH 解析结果重试一次。
pub async fn http_get(client: &Client, url: &str) -> Result<String, AppError> {
    get_text(client, url, &[], false).await
}

/// 带额外 header 的 GET 请求（同样支持 DoH 兜底重试）
pub async fn http_get_with_headers(
    client: &Client,
    url: &str,
    headers: &[(&str, &str)],
) -> Result<String, AppError> {
    get_text(client, url, headers, false).await
}

/// TVBox 接口配置拉取专用通道。
///
/// 两个关键点（实测得出）：
/// 1. **必须用 TVBox 客户端 UA**：饭太硬 `www.饭太硬.cc/tv`、王二小 `tvbox.王二小放牛娃.top`
///    会按 UA 分流 —— `okhttp/3.12.13` 返回配置（BMP 隐写 / JSON），浏览器 UA 只返回导航页或"你好！"。
/// 2. **优先走 DoH**：部分域名系统 DNS 会返回被污染的 IP，能连上但内容是错的，
///    这类"HTTP 200 但内容不对"的情况无法靠失败重试兜住。
pub async fn http_get_tvbox_config(client: &Client, url: &str) -> Result<String, AppError> {
    get_text(client, url, &[("User-Agent", TVBOX_USER_AGENT)], true).await
}

/// 文本响应是否像配置（JSON/JSONC/隐写 base64/hex+AES/M3U/TXT 直播源）
///
/// 用于「TVBox UA 拿到的内容不像配置时，再用浏览器 UA 兜底」的判断。
pub fn looks_like_config_payload(text: &str) -> bool {
    let trimmed = text.trim_start();
    if trimmed.is_empty() {
        return false;
    }
    trimmed.starts_with('{')
        || trimmed.starts_with('[')
        || trimmed.starts_with("2423")
        || text.contains("**")
        || text.contains("#EXTM3U")
        || text.contains("#EXTINF")
        || text.contains("<tv")
        || text.to_ascii_lowercase().contains("sites")
}

/// 带超时和大小限制的 GET 请求，返回 JSON
pub async fn http_get_json(client: &Client, url: &str) -> Result<Value, AppError> {
    let text = http_get(client, url).await?;
    serde_json::from_str(&text)
        .map_err(|e| AppError::parse_error("响应不是合法 JSON").with_internal(e.to_string()))
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

    #[test]
    fn parse_doh_answers_extracts_ipv4() {
        // 阿里 DoH 真实响应片段
        let body = r#"{"Status":0,"TC":false,"RD":true,"RA":true,"AD":false,"CD":false,
            "Question":{"name":"www.xn--sss604efuw.cc.","type":1},
            "Answer":[{"name":"www.xn--sss604efuw.cc.","type":1,"TTL":600,"data":"172.83.158.160"}]}"#;
        let answers = parse_doh_answers(body);
        assert_eq!(answers.len(), 1);
        assert_eq!(answers[0].to_string(), "172.83.158.160");
    }

    #[test]
    fn parse_doh_answers_keeps_multiple_records() {
        let body = r#"{"Answer":[
            {"name":"cdn.qiaoji8.com.","type":5,"data":"cdn-qiaoji8-com-idvpply.qiniudns.com."},
            {"name":"x.top.","type":1,"data":"178.236.38.6"},
            {"name":"x.top.","type":1,"data":"219.144.75.234"},
            {"name":"x.top.","type":28,"data":"2606:4700::1"}]}"#;
        let answers = parse_doh_answers(body);
        assert_eq!(answers.len(), 2, "只取 A 记录，跳过 CNAME/AAAA");
        assert_eq!(answers[0].to_string(), "178.236.38.6");
    }

    #[test]
    fn parse_doh_answers_handles_broken_or_empty() {
        assert!(parse_doh_answers("").is_empty());
        assert!(parse_doh_answers("<html>blocked</html>").is_empty());
        assert!(parse_doh_answers("{\"Status\":3}").is_empty());
        assert!(parse_doh_answers("{\"Answer\":[{\"type\":1,\"data\":\"not-an-ip\"}]}").is_empty());
    }

    #[test]
    fn doh_endpoint_default_and_override() {
        assert_eq!(doh_endpoint(), DEFAULT_DOH_ENDPOINT);
        set_doh_endpoint(Some("  https://dns.alidns.com/resolve  ".into()));
        assert_eq!(doh_endpoint(), "https://dns.alidns.com/resolve");
        set_doh_endpoint(Some("   ".into()));
        assert_eq!(doh_endpoint(), DEFAULT_DOH_ENDPOINT, "空白端点应回落默认");
        set_doh_endpoint(None);
        assert_eq!(doh_endpoint(), DEFAULT_DOH_ENDPOINT);
    }

    #[test]
    fn doh_client_for_skips_ip_literal_and_bad_url() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        // 纯 IP 主机不需要 DoH，且不应发起任何网络请求
        assert!(rt.block_on(doh_client_for("http://223.5.5.5/resolve")).is_none());
        assert!(rt.block_on(doh_client_for("not a url")).is_none());
    }
}
