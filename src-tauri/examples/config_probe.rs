//! 用应用自身的配置加载链路复测订阅：`cargo run --example config_probe -- <url>...`
#[path = "../src/error.rs"]
mod error;
#[path = "../src/network.rs"]
mod network;
#[path = "../src/path_safety.rs"]
mod path_safety;
#[path = "../src/url_util.rs"]
mod url_util;
#[path = "../src/live.rs"]
mod live;
#[path = "../src/decoder.rs"]
mod decoder;
#[path = "../src/config.rs"]
mod config;

#[tokio::main]
async fn main() {
    let dir = std::env::temp_dir().join("iptv-config-probe");
    let _ = std::fs::create_dir_all(&dir);
    for url in std::env::args().skip(1) {
        match config::load_config_from_url(&url, Some(&dir)).await {
            Ok(value) => {
                let sites = value.get("sites").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
                let lives = value.get("lives").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
                let parses = value.get("parses").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
                println!("✅ sites={sites} lives={lives} parses={parses}  {url}");
                // 打印 JS 站点，便于逐个用 drpy_probe 验证
                if std::env::var("SHOW_JS").is_ok() {
                    if let Some(items) = value.get("sites").and_then(|v| v.as_array()) {
                        for site in items {
                            let api = site.get("api").and_then(|v| v.as_str()).unwrap_or("");
                            if api.ends_with(".js") || api.ends_with(".mjs") {
                                println!(
                                    "   JS|{}|{}|{}",
                                    site.get("name").and_then(|v| v.as_str()).unwrap_or("?"),
                                    api,
                                    site.get("ext").and_then(|v| v.as_str()).unwrap_or("")
                                );
                            }
                        }
                    }
                }
            }
            Err(error) => println!("❌ {:<52} {url}", error.message),
        }
    }
}
