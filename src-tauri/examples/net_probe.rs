//! 用应用自身的网络路径复测 URL：`cargo run --example net_probe -- <url>...`
#[path = "../src/error.rs"]
mod error;
#[path = "../src/network.rs"]
mod network;

#[tokio::main]
async fn main() {
    let client = network::create_client().expect("创建 client");
    for url in std::env::args().skip(1) {
        let started = std::time::Instant::now();
        match network::http_get(&client, &url).await {
            Ok(body) => println!("✅ {:.2}s {:>9}B  {}", started.elapsed().as_secs_f32(), body.len(), url),
            Err(error) => println!("❌ {:.2}s {:<40} {}", started.elapsed().as_secs_f32(), error.message, url),
        }
    }
}
