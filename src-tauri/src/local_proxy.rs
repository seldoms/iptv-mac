use std::collections::HashMap;
use std::path::PathBuf;
use std::io::{Read, Write};
use std::net::{IpAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

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

/// 当前本地代理信息（JS 宿主的 `getPort`/`getProxy` 要拿真实端口与 token）
static CURRENT_PROXY: std::sync::OnceLock<LocalProxyInfo> = std::sync::OnceLock::new();

/// TVBox 约定端口：很多订阅的直播源把地址写成 `http://127.0.0.1:9978/proxy?do=live&url=…`
/// 或 `http://127.0.0.1:9978/file/…`。我们以前监听随机端口，这类源必然"无法连接"。
pub const TVBOX_PROXY_PORT: u16 = 9978;

/// `/file/<相对路径>` 的根目录（应用数据目录下的 files/）
static PROXY_FILES_ROOT: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// 经过本地代理转发出去的累计字节数与上次采样点。
/// 播放器右上角的「速度」用它来算——macOS 走原生 HLS 时没有 HLS.js 分片事件，
/// 只有代理这一层知道真实吞吐。
static PROXY_BYTES: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static PROXY_SAMPLE: Mutex<Option<(u64, std::time::Instant)>> = Mutex::new(None);

fn record_proxy_bytes(bytes: usize) {
    PROXY_BYTES.fetch_add(bytes as u64, std::sync::atomic::Ordering::Relaxed);
}

/// 取上次采样以来的吞吐（Kbps），并重置采样点。没有新数据时返回 0。
/// 累计转发字节数（前端用「字节增量 ÷ 已缓冲时长」估算真实媒体码率）
pub fn total_bytes() -> u64 {
    PROXY_BYTES.load(std::sync::atomic::Ordering::Relaxed)
}

pub fn take_throughput_kbps() -> f64 {
    let now = std::time::Instant::now();
    let total = PROXY_BYTES.load(std::sync::atomic::Ordering::Relaxed);
    let previous = match PROXY_SAMPLE.lock() {
        Ok(mut guard) => guard.replace((total, now)),
        Err(_) => None,
    };
    let Some((previous_total, previous_at)) = previous else {
        return 0.0;
    };
    let elapsed = now.duration_since(previous_at).as_secs_f64();
    if elapsed <= 0.0 {
        return 0.0;
    }
    let delta = total.saturating_sub(previous_total);
    (delta as f64 * 8.0) / elapsed / 1000.0
}

/// 本机在局域网里的地址（`getProxy(false)` 给外部播放器用）；拿不到就回落 127.0.0.1
fn lan_ip() -> String {
    let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") else {
        return "127.0.0.1".to_string();
    };
    // 不会真的发包：只是让内核选出默认出口网卡，从而拿到本机地址
    if socket.connect("8.8.8.8:80").is_err() {
        return "127.0.0.1".to_string();
    }
    socket
        .local_addr()
        .map(|addr| addr.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

/// 组装代理前缀（签名对齐 FongMi `Proxy.getUrl(local)`）。
///
/// `local=true` 返回回环地址（应用内播放）；`false` 返回局域网地址（投屏/外部播放器）。
pub fn proxy_prefix(info: &LocalProxyInfo, local: bool) -> String {
    let port = info
        .url
        .rsplit(':')
        .next()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(9978);
    let host = if local { "127.0.0.1".to_string() } else { lan_ip() };
    format!("http://{host}:{port}")
}

/// 当前生效的代理端口；还没启动时返回 0（与 FongMi 行为一致）
pub fn current_port() -> u16 {
    CURRENT_PROXY
        .get()
        .and_then(|info| info.url.rsplit(':').next())
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(0)
}

/// `getProxy(local)` 的返回值：`<prefix>/stream?token=<token>&do=js`
///
/// 站点把 `&url=`/`&header=` 续在后面即可（我们的 `/stream` 路由已经支持这两个参数）。
pub fn current_proxy_base(local: bool) -> String {
    match CURRENT_PROXY.get() {
        Some(info) => format!(
            "{}/stream?token={}&do=js",
            proxy_prefix(info, local),
            urlencoding::encode(&info.token)
        ),
        None => String::new(),
    }
}

pub fn start_local_proxy(data_dir: PathBuf) -> Result<LocalProxyInfo, String> {
    // 先试 TVBox 约定的 9978：订阅里写死的代理地址才能命中我们；被占用则回落随机端口
    let listener = TcpListener::bind(("127.0.0.1", TVBOX_PROXY_PORT))
        .or_else(|_| TcpListener::bind("127.0.0.1:0"))
        .map_err(|error| error.to_string())?;
    let files_root = data_dir.join("files");
    let _ = std::fs::create_dir_all(&files_root);
    let _ = PROXY_FILES_ROOT.set(files_root);
    let addr = listener.local_addr().map_err(|error| error.to_string())?;
    let token = make_token();
    let info = LocalProxyInfo {
        url: format!("http://{}", addr),
        token,
    };
    let _ = CURRENT_PROXY.set(info.clone());
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
    use rand::Rng;
    // 128-bit cryptographically random token (32 hex chars)
    let token: u128 = rand::thread_rng().gen();
    format!("{:032x}", token)
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
    let id = PROXY_ITEM_COUNTER
        .fetch_add(1, Ordering::Relaxed)
        .to_string();
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
    let request_headers = parse_request_headers(&request);
    let query = parse_query(query);

    // TVBox 约定路由（订阅里写死的地址，不带 token）：
    //   /proxy?do=live&url=<真实地址>[&header=<JSON>]  → 取回并转发（含 HLS 清单重写）
    //   /file/<相对路径>                               → 读取 <数据目录>/files/ 下的文件
    if path == "/proxy" {
        let Some(url) = query.get("url").filter(|url| is_allowed_media_url(url)) else {
            write_response(&mut stream, 400, "text/plain; charset=utf-8", b"Invalid URL")?;
            return Ok(());
        };
        let mut headers = query
            .get("header")
            .and_then(|value| serde_json::from_str::<HashMap<String, String>>(value).ok())
            .unwrap_or_default();
        for (key, value) in &request_headers {
            headers.entry(key.clone()).or_insert_with(|| value.clone());
        }
        if let Err(error) = proxy_media(&mut stream, info, url, &headers, &request_headers) {
            let message = format!("Proxy Error: {error}");
            write_response(&mut stream, 502, "text/plain; charset=utf-8", message.as_bytes())?;
        }
        return Ok(());
    }
    if let Some(relative) = path.strip_prefix("/file/") {
        return serve_local_file(&mut stream, relative);
    }

    if path != "/stream" {
        write_response(&mut stream, 404, "text/plain; charset=utf-8", b"Not Found")?;
        return Ok(());
    }

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
        request_headers
            .get("range")
            .map(String::as_str)
            .unwrap_or("-")
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
        // HLS 清单必须整份获取：播放器（AVPlayer/Chromium）会先发 `Range: bytes=0-1` 探测，
        // 若把这个 Range 转发给清单地址，上游只会返回 2 字节的 206 片段，
        // 而我们随后会把它当作完整清单重写，得到一份残缺 m3u8——拖动进度条重新探测清单时就再也播不出来。
        let looks_like_playlist = is_playlist_url(url);
        let mut request = client.get(url);
        for (key, value) in headers {
            request = request.header(key, value);
        }
        if !looks_like_playlist {
            if let Some(range) = request_headers.get("range") {
                request = request.header(reqwest::header::RANGE, range);
            }
            if let Some(if_range) = request_headers.get("if-range") {
                request = request.header(reqwest::header::IF_RANGE, if_range);
            }
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
            let playlist_url = response.url().to_string();
            let bytes = response
                .bytes()
                .await
                .map_err(|error| error.to_string())?
                .to_vec();
            let text = String::from_utf8_lossy(&bytes);
            let body = rewrite_hls_playlist(&text, &playlist_url, |item_url| {
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
            // 统计真实转发吞吐（右上角「速度」的数据源）；两条写出分支都要计
            record_proxy_bytes(chunk.len());
            if content_length.is_some() {
                stream
                    .write_all(&chunk)
                    .map_err(|error| error.to_string())?;
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

/// 是否需要整份获取的 HLS 清单地址。
/// 清单不接受 Range 转发：播放器的 `Range: bytes=0-1` 探测会让上游只返回 2 字节片段，
/// 而重写清单需要完整文本。
fn is_playlist_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.contains(".m3u8") || lower.contains("mpegurl")
}

fn is_allowed_media_url(url: &str) -> bool {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return false;
    }

    // Parse host to check for private/internal IP ranges (SSRF protection)
    let parsed = match url::Url::parse(url) {
        Ok(u) => u,
        Err(_) => return false,
    };
    let host = match parsed.host() {
        Some(h) => h,
        None => return false,
    };

    // Check hostname — localhost variants and bare IPs
    let host_str = host.to_string();
    let is_loopback_host = matches!(
        host_str.as_str(),
        "localhost"
            | "127.0.0.1"
            | "::1"
            | "[::1]"
            | "0.0.0.0"
            | "localhost.localdomain"
            | "127.0.1.1"
    ) || host_str.ends_with(".local")
        || host_str.ends_with(".localhost");

    if is_loopback_host {
        return false;
    }

    // If the host is an IP address, check against private/reserved ranges
    if let Ok(ip) = host_str.parse::<IpAddr>() {
        match ip {
            IpAddr::V4(v4) => {
                // 127.0.0.0/8 (loopback)
                if v4.octets()[0] == 127 {
                    return false;
                }
                // 10.0.0.0/8 (private A)
                if v4.octets()[0] == 10 {
                    return false;
                }
                // 172.16.0.0/12 (private B)
                if v4.octets()[0] == 172 && (v4.octets()[1] & 0xF0) == 16 {
                    return false;
                }
                // 192.168.0.0/16 (private C)
                if v4.octets()[0] == 192 && v4.octets()[1] == 168 {
                    return false;
                }
                // 169.254.0.0/16 (link-local)
                if v4.octets()[0] == 169 && v4.octets()[1] == 254 {
                    return false;
                }
                // 0.0.0.0/8
                if v4.octets()[0] == 0 {
                    return false;
                }
                // 100.64.0.0/10 (CGNAT / Carrier-grade NAT)
                if v4.octets()[0] == 100 && (v4.octets()[1] & 0xC0) == 64 {
                    return false;
                }
                // 198.18.0.0/15 (benchmarking)
                if v4.octets()[0] == 198 && (v4.octets()[1] & 0xFE) == 18 {
                    return false;
                }
            }
            IpAddr::V6(v6) => {
                let segments = v6.segments();
                // ::1 (loopback)
                if segments == [0, 0, 0, 0, 0, 0, 0, 1] {
                    return false;
                }
                // IPv4-mapped IPv6: ::ffff:0:0/96 — check the embedded IPv4
                if segments[0..5] == [0, 0, 0, 0, 0] && segments[5] == 0xFFFF {
                    let embedded = std::net::Ipv4Addr::new(
                        (segments[6] >> 8) as u8,
                        (segments[6] & 0xFF) as u8,
                        (segments[7] >> 8) as u8,
                        (segments[7] & 0xFF) as u8,
                    );
                    // Re-check against the IPv4 private ranges
                    let octets = embedded.octets();
                    if octets[0] == 127
                        || octets[0] == 10
                        || (octets[0] == 172 && (octets[1] & 0xF0) == 16)
                        || (octets[0] == 192 && octets[1] == 168)
                        || (octets[0] == 169 && octets[1] == 254)
                    {
                        return false;
                    }
                }
                // Unique Local Address (ULA): fd00::/8
                if segments[0] & 0xFF00 == 0xFD00 {
                    return false;
                }
            }
        }
    }

    true
}

fn write_options_response(stream: &mut TcpStream) -> Result<(), String> {
    stream
        .write_all(
            b"HTTP/1.1 204 No Content\r\n\
              Access-Control-Allow-Origin: http://tauri://localhost\r\n\
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
         Access-Control-Allow-Origin: http://tauri://localhost\r\n\
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
         Access-Control-Allow-Origin: http://tauri://localhost\r\n\
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

/// 处理 `/file/<相对路径>`：从 `<数据目录>/files/` 读取。
///
/// TVBox 生态里直播源常用 `http://127.0.0.1:9978/file/xxx/live.txt` 指本地文件。
/// 必须防目录穿越：先规范化，再确认解析结果仍在根目录内。
/// 把 `/file/<relative>` 解析成根目录内的真实路径。
/// 返回 `Err(status)`：403 = 越界/穿越，404 = 不存在。
fn resolve_local_file(root: &std::path::Path, relative: &str) -> Result<PathBuf, u16> {
    let decoded = urlencoding::decode(relative)
        .map(|value| value.into_owned())
        .unwrap_or_else(|_| relative.to_string());
    if decoded.split(['/', '\\']).any(|segment| segment == "..") {
        return Err(403);
    }
    let root_canonical = root.canonicalize().map_err(|_| 404u16)?;
    let path = root
        .join(decoded.trim_start_matches('/'))
        .canonicalize()
        .map_err(|_| 404u16)?;
    if !path.starts_with(&root_canonical) {
        return Err(403);
    }
    Ok(path)
}

fn serve_local_file(stream: &mut TcpStream, relative: &str) -> Result<(), String> {
    let Some(root) = PROXY_FILES_ROOT.get() else {
        return write_response(stream, 404, "text/plain; charset=utf-8", b"Not Found");
    };
    let path = match resolve_local_file(root, relative) {
        Ok(path) => path,
        Err(403) => return write_response(stream, 403, "text/plain; charset=utf-8", b"Forbidden"),
        Err(_) => return write_response(stream, 404, "text/plain; charset=utf-8", b"Not Found"),
    };
    let Ok(body) = std::fs::read(&path) else {
        return write_response(stream, 404, "text/plain; charset=utf-8", b"Not Found");
    };
    let content_type = match path.extension().and_then(|value| value.to_str()) {
        Some("m3u8") | Some("m3u") => "application/vnd.apple.mpegurl",
        Some("json") => "application/json; charset=utf-8",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    };
    write_response(stream, 200, content_type, &body)
}

fn write_chunk(stream: &mut TcpStream, chunk: &[u8]) -> Result<(), String> {
    write!(stream, "{:x}\r\n", chunk.len()).map_err(|error| error.to_string())?;
    stream.write_all(chunk).map_err(|error| error.to_string())?;
    stream.write_all(b"\r\n").map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        is_allowed_media_url, is_playlist_url, parse_query, parse_request_headers, proxy_prefix,
        record_proxy_bytes, resolve_local_file, take_throughput_kbps, LocalProxyInfo,
    };

    #[test]
    fn file_route_serves_inside_root_and_rejects_traversal() {
        let root = std::env::temp_dir().join(format!("iptv-files-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("XYQTVBox")).unwrap();
        std::fs::write(root.join("XYQTVBox/live.txt"), b"#EXTM3U\n").unwrap();

        // 正常路径：能解析到根目录内
        let ok = resolve_local_file(&root, "XYQTVBox/live.txt").expect("正常文件应可解析");
        assert!(ok.ends_with("XYQTVBox/live.txt"));
        // URL 编码的斜杠也要能处理
        assert!(resolve_local_file(&root, "XYQTVBox%2Flive.txt").is_ok());

        // 目录穿越：一律 403
        assert_eq!(resolve_local_file(&root, "../secrets.txt"), Err(403));
        assert_eq!(resolve_local_file(&root, "..%2F..%2Fetc%2Fpasswd"), Err(403));
        assert_eq!(resolve_local_file(&root, "a/../../b"), Err(403));
        // 不存在的文件：404
        assert_eq!(resolve_local_file(&root, "XYQTVBox/nope.txt"), Err(404));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn throughput_is_zero_without_traffic_and_positive_after_bytes() {
        assert_eq!(take_throughput_kbps(), 0.0, "没有历史采样点时应为 0");
        record_proxy_bytes(250_000);
        std::thread::sleep(std::time::Duration::from_millis(50));
        let kbps = take_throughput_kbps();
        assert!(kbps > 0.0, "有转发字节后吞吐应大于 0（实测 {kbps}）");
    }

    #[test]
    fn builds_proxy_prefix_for_local_and_lan() {
        let info = LocalProxyInfo {
            url: "http://127.0.0.1:9978".to_string(),
            token: "abc".to_string(),
        };
        assert_eq!(proxy_prefix(&info, true), "http://127.0.0.1:9978");
        let lan = proxy_prefix(&info, false);
        assert!(lan.starts_with("http://") && lan.ends_with(":9978"), "局域网前缀: {lan}");
    }

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
        assert!(is_allowed_media_url("http://93.184.216.34:8080/stream.ts"));
        assert!(!is_allowed_media_url("file:///tmp/a.m3u8"));
        assert!(!is_allowed_media_url("data:text/plain,hello"));
    }

    #[test]
    fn rejects_private_ip_ssrf() {
        assert!(!is_allowed_media_url("http://127.0.0.1:22"));
        assert!(!is_allowed_media_url("http://127.0.0.1"));
        assert!(!is_allowed_media_url("http://localhost:8080/stream"));
        assert!(!is_allowed_media_url("http://10.0.0.1/latest/meta-data/"));
        assert!(!is_allowed_media_url("http://172.16.0.1:3000"));
        assert!(!is_allowed_media_url("http://192.168.1.1/admin"));
        assert!(!is_allowed_media_url("http://169.254.169.254/latest/meta-data/"));
        assert!(!is_allowed_media_url("http://[::1]:8080"));
        assert!(!is_allowed_media_url("http://0.0.0.0"));
        assert!(!is_allowed_media_url("http://100.64.0.1"));
        assert!(!is_allowed_media_url("http://198.18.0.1"));
    }

    #[test]
    fn detects_playlist_urls_for_full_fetch() {
        assert!(is_playlist_url("https://cdn.example/a/index.m3u8"));
        assert!(is_playlist_url("https://cdn.example/a/index.M3U8?token=1"));
        assert!(is_playlist_url(
            "http://127.0.0.1:1/stream?url=https%3A%2F%2Fcdn.example%2Flive%2Fx.m3u8"
        ));
        assert!(!is_playlist_url("https://cdn.example/a/seg-1.ts"));
        assert!(!is_playlist_url("https://cdn.example/a/movie.mp4"));
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
