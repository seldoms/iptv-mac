use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

use serde_json::Value;

#[path = "../src/config.rs"]
mod config;
#[path = "../src/error.rs"]
mod error;
#[path = "../src/live.rs"]
mod live;
#[path = "../src/network.rs"]
mod network;
#[path = "../src/spider.rs"]
mod spider;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let server = TestServer::start()?;
    let base = server.base_url();
    let config_url = format!("{}/tv.json", base);

    println!("server={}", base);
    println!("config={}", config_url);

    let client = network::create_client()?;
    let config_text = network::http_get(&client, &config_url).await?;
    let config = config::parse_config_or_live_source(&config_url, &config_text)?;
    let sites = config.get("sites").and_then(Value::as_array).cloned().unwrap_or_default();
    let lives = config.get("lives").and_then(Value::as_array).cloned().unwrap_or_default();
    println!("CONFIG OK: sites={} lives={}", sites.len(), lives.len());

    let site = sites.first().ok_or("missing site")?;
    let api = site.get("api").and_then(Value::as_str).ok_or("missing api")?;
    let spider = spider::HttpSpider::new(spider::SiteConfig {
        key: site.get("key").and_then(Value::as_str).unwrap_or("local").to_string(),
        name: site.get("name").and_then(Value::as_str).unwrap_or("Local").to_string(),
        site_type: site.get("type").and_then(Value::as_i64).unwrap_or(1),
        api: config::resolve_relative_url(&config_url, api),
        ext: None,
        play_url: None,
        click: None,
        header: None,
        timeout: Some(5),
    });
    let home = spider.home_content(false).await?;
    let vod_count = home.list.as_ref().map_or(0, Vec::len);
    println!("VOD OK: home_items={}", vod_count);
    assert!(vod_count > 0, "startup should load VOD home content");

    let mut channels = Vec::new();
    for live_entry in &lives {
        let live_name = live_entry.get("name").and_then(Value::as_str).unwrap_or("live");
        let live_url = live_entry.get("url").and_then(Value::as_str).ok_or("missing live url")?;
        let live_url = config::resolve_relative_url(&config_url, live_url);
        let content = network::http_get(&client, &live_url).await?;
        let groups = live::parse_live_content(&content);
        for group in groups {
            for channel in group.channel {
                channels.push((format!("{} / {}", live_name, group.name), channel));
            }
        }
    }

    let merged = merge_and_test(channels).await;
    let demo = merged.iter().find(|channel| channel.name == "Demo Channel").ok_or("missing merged channel")?;
    println!(
        "LIVE OK: merged={} demo_urls={} best_url={} latency={} origins={:?}",
        merged.len(),
        demo.urls.len(),
        demo.best_url,
        demo.latency,
        demo.origins
    );
    assert_eq!(demo.urls.len(), 2, "same channel should merge URLs from multiple sources");
    assert!(demo.best_url.ends_with("/fast.m3u8"), "fastest URL should be preferred");
    assert!(demo.origins.iter().any(|origin| origin.contains("Live A")));
    assert!(demo.origins.iter().any(|origin| origin.contains("Live B")));
    let solo = merged.iter().find(|channel| channel.name == "Solo Channel").ok_or("missing solo channel")?;
    assert_eq!(solo.urls.len(), 1, "single-line channels should be kept without speed competition");
    assert_eq!(solo.latency, -1);

    server.stop();
    Ok(())
}

#[derive(Debug)]
struct MergedChannel {
    name: String,
    urls: Vec<String>,
    best_url: String,
    latency: i64,
    origins: Vec<String>,
}

async fn merge_and_test(channels: Vec<(String, live::Channel)>) -> Vec<MergedChannel> {
    let mut by_name: std::collections::HashMap<String, (String, Vec<String>, Vec<String>)> = std::collections::HashMap::new();
    for (origin, channel) in channels {
        let key = live::normalize_name(&channel.name);
        let entry = by_name.entry(key).or_insert_with(|| (channel.name.clone(), Vec::new(), Vec::new()));
        for url in channel.urls {
            if !entry.1.contains(&url) {
                entry.1.push(url);
            }
        }
        if !entry.2.contains(&origin) {
            entry.2.push(origin);
        }
    }

    let mut merged = Vec::new();
    for (_, (name, urls, origins)) in by_name {
        if urls.len() == 1 {
            merged.push(MergedChannel {
                name,
                best_url: urls[0].clone(),
                urls,
                latency: -1,
                origins,
            });
            continue;
        }

        let mut results = Vec::new();
        for url in &urls {
            results.push(live::test_url(url, 2_000).await);
        }
        results.retain(|result| result.alive);
        results.sort_by_key(|result| if result.latency < 0 { i64::MAX } else { result.latency });
        if let Some(best) = results.first() {
            merged.push(MergedChannel {
                name,
                urls: results.iter().map(|result| result.url.clone()).collect(),
                best_url: best.url.clone(),
                latency: best.latency,
                origins,
            });
        }
    }
    merged
}

struct TestServer {
    base_url: String,
    running: Arc<AtomicBool>,
}

impl TestServer {
    fn start() -> std::io::Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        listener.set_nonblocking(true)?;
        let addr = listener.local_addr()?;
        let base_url = format!("http://{}", addr);
        let running = Arc::new(AtomicBool::new(true));
        let thread_running = running.clone();
        let thread_base = base_url.clone();

        thread::spawn(move || {
            while thread_running.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => handle_connection(stream, &thread_base),
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });

        Ok(Self { base_url, running })
    }

    fn base_url(&self) -> String {
        self.base_url.clone()
    }

    fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        let _ = TcpStream::connect(self.base_url.trim_start_matches("http://"));
    }
}

fn handle_connection(mut stream: TcpStream, base_url: &str) {
    let mut buffer = [0u8; 2048];
    let Ok(size) = stream.read(&mut buffer) else { return; };
    let request = String::from_utf8_lossy(&buffer[..size]);
    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/");

    let route = path
        .split('?')
        .next()
        .and_then(|raw| {
            if raw.starts_with("http://") || raw.starts_with("https://") {
                url::Url::parse(raw).ok().map(|url| url.path().to_string())
            } else {
                Some(raw.to_string())
            }
        })
        .unwrap_or_else(|| path.to_string());

    let (status, content_type, body, delay_ms) = match route.as_str() {
        "/tv.json" => (
            "200 OK",
            "application/json",
            format!(
                r#"{{
                    "sites": [{{"key":"local","name":"Local VOD","type":1,"api":"{base}/api.php"}}],
                    "lives": [
                        {{"name":"Live A","url":"{base}/live-a.m3u"}},
                        {{"name":"Live B","url":"{base}/live-b.m3u"}}
                    ]
                }}"#,
                base = base_url
            ),
            0,
        ),
        "/api.php" => (
            "200 OK",
            "application/json",
            r#"{"class":[{"type_id":1,"type_name":"Movie"}],"list":[{"vod_id":101,"vod_name":"Demo Movie","vod_play_url":"第1集$http://example.test/demo.m3u8"}]}"#.to_string(),
            0,
        ),
        "/live-a.m3u" => (
            "200 OK",
            "application/vnd.apple.mpegurl",
            format!("#EXTM3U\n#EXTINF:-1 group-title=\"Group A\",Demo Channel\n{base}/slow.m3u8\n#EXTINF:-1 group-title=\"Group A\",Solo Channel\n{base}/solo.m3u8\n", base = base_url),
            0,
        ),
        "/live-b.m3u" => (
            "200 OK",
            "application/vnd.apple.mpegurl",
            format!("#EXTM3U\n#EXTINF:-1 group-title=\"Group B\",Demo Channel\n{}/fast.m3u8\n", base_url),
            0,
        ),
        "/slow.m3u8" => ("200 OK", "application/vnd.apple.mpegurl", "#EXTM3U\n".to_string(), 200),
        "/fast.m3u8" => ("200 OK", "application/vnd.apple.mpegurl", "#EXTM3U\n".to_string(), 10),
        "/solo.m3u8" => ("200 OK", "application/vnd.apple.mpegurl", "#EXTM3U\n".to_string(), 10),
        _ => ("404 Not Found", "text/plain", "not found".to_string(), 0),
    };

    if delay_ms > 0 {
        thread::sleep(Duration::from_millis(delay_ms));
    }
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}
