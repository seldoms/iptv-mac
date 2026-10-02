//! 用应用自身的直播探测函数复测频道：`cargo run --example live_probe -- <url>...`
#[path = "../src/error.rs"]
mod error;
#[path = "../src/network.rs"]
mod network;
#[path = "../src/live.rs"]
mod live;

#[tokio::main]
async fn main() {
    let timeout: u64 = std::env::var("PROBE_TIMEOUT_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8000);
    for url in std::env::args().skip(1) {
        let started = std::time::Instant::now();
        let result = live::test_url(&url, timeout).await;
        println!(
            "{:<6} {:>5}ms latency={:<6} {:<44} {}",
            if result.alive { "✅可播" } else { "❌判死" },
            started.elapsed().as_millis(),
            result.latency,
            result.error.clone().unwrap_or_default(),
            url
        );
    }
}
