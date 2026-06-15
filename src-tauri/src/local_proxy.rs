use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::hls::rewrite_hls_playlist;

const MAX_REQUEST_BYTES: usize = 16 * 1024;
const MAX_PROXY_ITEMS: usize = 10_000;

static PROXY_RUNTIME: OnceLock<Result<tokio::runtime::Runtime, String>> = OnceLock::new();
static PROXY_CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
static PROXY_ITEMS: OnceLock<Mutex<HashMap<String, ProxyItem>>> = OnceLock::new();
static PROXY_ITEM_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
struct ProxyItem {
    url: String,
    headers: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalProxyInfo {
    pub url: String,
    pub token: String,
}

pub fn start_local_proxy() -> Result<LocalProxyInfo, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let addr = listener.local_addr().map_err(|error| error.to_string())?;
    let token = make_token();
    let info = LocalProxyInfo {
        url: format!("http://{}", addr),
        token,
    };
    let shared_info = Arc::new(info.clone());

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else {
                continue;
            };
            let info = Arc::clone(&shared_info);
            std::thread::spawn(move || {
                let _ = handle_stream(stream, &info);
            });
        }
    });

    Ok(info)
}

fn make_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{:x}{:x}", nanos, std::process::id())
}

fn trace_enabled() -> bool {
    std::env::var("IPTV_LOCAL_PROXY_TRACE").ok().as_deref() == Some("1")
}

fn trace(message: impl AsRef<str>) {
    if trace_enabled() {
        eprintln!("[local_proxy] {}", message.as_ref());
    }
}

fn proxy_runtime() -> Result<&'static tokio::runtime::Runtime, String> {
    PROXY_RUNTIME
        .get_or_init(|| tokio::runtime::Runtime::new().map_err(|error| error.to_string()))
        .as_ref()
        .map_err(Clone::clone)
}

fn proxy_client() -> Result<reqwest::Client, String> {
    PROXY_CLIENT
        .get_or_init(|| crate::network::create_client().map_err(|error| error.to_string()))
        .clone()
}

fn proxy_items() -> &'static Mutex<HashMap<String, ProxyItem>> {
    PROXY_ITEMS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_proxy_item(
    info: &LocalProxyInfo,
    url: &str,
    headers: &HashMap<String, String>,
) -> String {
    let id = PROXY_ITEM_COUNTER.fetch_add(1, Ordering::Relaxed).to_string();
    if let Ok(mut items) = proxy_items().lock() {
        if items.len() >= MAX_PROXY_ITEMS {
            let overflow = items.len() + 1 - MAX_PROXY_ITEMS;
            let keys: Vec<String> = items.keys().take(overflow).cloned().collect();
            for key in keys {
                items.remove(&key);
            }
        }
        items.insert(
            id.clone(),
            ProxyItem {
                url: url.to_string(),
                headers: headers.clone(),
            },
        );
    }
    format!(
        "{}/stream?token={}&id={}",
        info.url,
        urlencoding::encode(&info.token),
        urlencoding::encode(&id)
    )
}

fn get_proxy_item(id: &str) -> Option<ProxyItem> {
    proxy_items()
        .lock()
        .ok()
        .and_then(|items| items.get(id).cloned())
}

fn handle_stream(mut stream: TcpStream, info: &LocalProxyInfo) -> Result<(), String> {
    let mut buffer = [0_u8; MAX_REQUEST_BYTES];
    let size = stream
        .read(&mut buffer)
        .map_err(|error| error.to_string())?;
    let request = String::from_utf8_lossy(&buffer[..size]);
    let Some(first_line) = request.lines().next() else {
        write_response(
            &mut stream,
            400,
            "text/plain; charset=utf-8",
            b"Bad Request",
        )?;
        return Ok(());
    };

    if first_line.starts_with("OPTIONS ") {
        write_options_response(&mut stream)?;
        return Ok(());
    }

    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();
    if method != "GET" {
        write_response(
            &mut stream,
            405,
            "text/plain; charset=utf-8",
            b"Method Not Allowed",
        )?;
        return Ok(());
    }

    let (path, query) = target
        .split_once('?')
        .map(|(path, query)| (path, query))
        .unwrap_or((target, ""));
    if path != "/stream" {
        write_response(&mut stream, 404, "text/plain; charset=utf-8", b"Not Found")?;
        return Ok(());
    }

    let request_headers = parse_request_headers(&request);
    let query = parse_query(query);
    if query.get("token").map(String::as_str) != Some(info.token.as_str()) {
        write_response(&mut stream, 403, "text/plain; charset=utf-8", b"Forbidden")?;
        return Ok(());
    }

    let query_headers = query
        .get("header")
        .and_then(|value| serde_json::from_str::<HashMap<String, String>>(value).ok())
        .unwrap_or_default();
    let (url, headers) = if let Some(id) = query.get("id") {
        let Some(item) = get_proxy_item(id) else {
            write_response(
                &mut stream,
                404,
                "text/plain; charset=utf-8",
                b"Proxy item not found",
            )?;
            return Ok(());
        };
        (item.url, item.headers)
    } else {
        let Some(url) = query.get("url").filter(|url| is_allowed_media_url(url)) else {
            write_response(
                &mut stream,
                400,
                "text/plain; charset=utf-8",
                b"Invalid URL",
            )?;
            return Ok(());
        };
        (url.clone(), query_headers)
    };
    trace(format!(
        "{} {} range={}",
        method,
        url,
        request_headers.get("range").map(String::as_str).unwrap_or("-")
    ));

    if let Err(error) = proxy_media(&mut stream, info, &url, &headers, &request_headers) {
        let message = format!("Proxy Error: {}", error);
        write_response(
            &mut stream,
            502,
            "text/plain; charset=utf-8",
            message.as_bytes(),
        )?;
    }

    Ok(())
}

fn proxy_media(
    stream: &mut TcpStream,
    info: &LocalProxyInfo,
    url: &str,
    headers: &HashMap<String, String>,
    request_headers: &HashMap<String, String>,
) -> Result<(), String> {
    let rt = proxy_runtime()?;
    rt.block_on(async move {
        let client = proxy_client()?;
        let mut request = client.get(url);
        for (key, value) in headers {
            request = request.header(key, value);
        }
        if let Some(range) = request_headers.get("range") {
            request = request.header(reqwest::header::RANGE, range);
        }
        if let Some(if_range) = request_headers.get("if-range") {
            request = request.header(reqwest::header::IF_RANGE, if_range);
        }
        let response = request.send().await.map_err(|error| error.to_string())?;
        let status = response.status();
        trace(format!("upstream {} -> HTTP {}", url, status.as_u16()));
        if !status.is_success() {
            return Err(format!("HTTP {}", status.as_u16()));
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();
        let content_range = response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .map(String::from);
        let accept_ranges = response
            .headers()
            .get(reqwest::header::ACCEPT_RANGES)
            .and_then(|value| value.to_str().ok())
            .map(String::from);
        let content_length = response.content_length();
        trace(format!(
            "headers {} type={} length={} range={} accept_ranges={}",
            url,
            content_type,
            content_length
                .map(|length| length.to_string())
                .unwrap_or_else(|| "-".to_string()),
            content_range.as_deref().unwrap_or("-"),
            accept_ranges.as_deref().unwrap_or("-")
        ));
        let is_hls_playlist = url.to_lowercase().contains(".m3u8")
            || content_type.contains("mpegurl")
            || content_type.contains("vnd.apple");
        if is_hls_playlist {
            let bytes = response
                .bytes()
                .await
                .map_err(|error| error.to_string())?
                .to_vec();
            let text = String::from_utf8_lossy(&bytes);
            let body = rewrite_hls_playlist(&text, url, |item_url| {
                register_proxy_item(info, item_url, headers)
            })
            .into_bytes();
            trace(format!("playlist {} bytes={}", url, body.len()));
            return write_response(stream, 200, &content_type, &body);
        }

        write_media_headers(
            stream,
            status.as_u16(),
            &content_type,
            content_length,
            content_range.as_deref(),
            accept_ranges.as_deref(),
        )?;
        let mut response = response;
        let mut streamed_bytes: u64 = 0;
        while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
            streamed_bytes += chunk.len() as u64;
            if content_length.is_some() {
                stream.write_all(&chunk).map_err(|error| error.to_string())?;
            } else {
                write_chunk(stream, &chunk)?;
            }
        }
        if content_length.is_none() {
            stream
                .write_all(b"0\r\n\r\n")
                .map_err(|error| error.to_string())?;
        }
        trace(format!("media {} streamed_bytes={}", url, streamed_bytes));
        Ok(())
    })
}

fn parse_query(query: &str) -> HashMap<String, String> {
    url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect()
}

fn parse_request_headers(request: &str) -> HashMap<String, String> {
    request
        .lines()
        .skip(1)
        .take_while(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let (key, value) = line.split_once(':')?;
            Some((key.trim().to_ascii_lowercase(), value.trim().to_string()))
        })
        .collect()
}

fn is_allowed_media_url(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

fn write_options_response(stream: &mut TcpStream) -> Result<(), String> {
    stream
        .write_all(
            b"HTTP/1.1 204 No Content\r\n\
              Access-Control-Allow-Origin: *\r\n\
              Access-Control-Allow-Methods: GET, OPTIONS\r\n\
              Access-Control-Allow-Headers: *\r\n\
              Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges, Content-Type\r\n\
              Content-Length: 0\r\n\
              Connection: close\r\n\r\n",
        )
        .map_err(|error| error.to_string())
}

fn write_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        502 => "Bad Gateway",
        _ => "Error",
    };
    let header = format!(
        "HTTP/1.1 {} {}\r\n\
         Content-Type: {}\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges, Content-Type\r\n\
         Cache-Control: no-store\r\n\
         Connection: close\r\n\r\n",
        status,
        reason,
        content_type,
        body.len()
    );
    stream
        .write_all(header.as_bytes())
        .and_then(|_| stream.write_all(body))
        .map_err(|error| error.to_string())
}

fn write_media_headers(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    content_length: Option<u64>,
    content_range: Option<&str>,
    accept_ranges: Option<&str>,
) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        206 => "Partial Content",
        _ => "OK",
    };
    let mut header = format!(
        "HTTP/1.1 {} {}\r\n\
         Content-Type: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges, Content-Type\r\n\
         Cache-Control: no-store\r\n",
        status,
        reason,
        content_type
    );
    if let Some(content_length) = content_length {
        header.push_str(&format!("Content-Length: {}\r\n", content_length));
    } else {
        header.push_str("Transfer-Encoding: chunked\r\n");
    }
    if let Some(content_range) = content_range {
        header.push_str(&format!("Content-Range: {}\r\n", content_range));
    }
    if let Some(accept_ranges) = accept_ranges {
        header.push_str(&format!("Accept-Ranges: {}\r\n", accept_ranges));
    }
    header.push_str("Connection: close\r\n\r\n");
    stream
        .write_all(header.as_bytes())
        .map_err(|error| error.to_string())
}

fn write_chunk(stream: &mut TcpStream, chunk: &[u8]) -> Result<(), String> {
    write!(stream, "{:x}\r\n", chunk.len()).map_err(|error| error.to_string())?;
    stream.write_all(chunk).map_err(|error| error.to_string())?;
    stream.write_all(b"\r\n").map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{is_allowed_media_url, parse_query, parse_request_headers};

    #[test]
    fn parses_query_values() {
        let query = parse_query("token=abc&url=https%3A%2F%2Fexample.com%2Fa.m3u8");
        assert_eq!(query.get("token").map(String::as_str), Some("abc"));
        assert_eq!(
            query.get("url").map(String::as_str),
            Some("https://example.com/a.m3u8")
        );
    }

    #[test]
    fn only_allows_http_media_urls() {
        assert!(is_allowed_media_url("https://example.com/a.m3u8"));
        assert!(is_allowed_media_url("http://example.com/a.m3u8"));
        assert!(!is_allowed_media_url("file:///tmp/a.m3u8"));
        assert!(!is_allowed_media_url("data:text/plain,hello"));
    }

    #[test]
    fn parses_range_request_header() {
        let request =
            "GET /stream?token=abc HTTP/1.1\r\nHost: 127.0.0.1\r\nRange: bytes=10-99\r\n\r\n";
        let headers = parse_request_headers(request);
        assert_eq!(
            headers.get("range").map(String::as_str),
            Some("bytes=10-99")
        );
    }
}
