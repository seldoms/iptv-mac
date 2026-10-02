//! drpy/ESM JS 蜘蛛端到端探针。
//!
//! 用法：
//! ```bash
//! cargo run --example drpy_probe -- <drpy2.min.js 绝对地址> [ext 绝对地址] [搜索词]
//! ```
//! 例（心魔在线「😈心魔自用😈」）：
//! ```bash
//! cargo run --example drpy_probe -- \
//!   "https://gh-proxy.com/raw.githubusercontent.com/yw88075/tvbox/main/dr/lib/drpy2.min.js" \
//!   "https://gh-proxy.com/raw.githubusercontent.com/yw88075/tvbox/main/dr/js/360影视.js"
//! ```
use std::time::Instant;

#[path = "../src/error.rs"]
mod error;
#[path = "../src/js_module.rs"]
mod js_module;
#[path = "../src/js_runtime.rs"]
mod js_runtime;
#[path = "../src/js_session.rs"]
mod js_session;
#[path = "../src/js_spider.rs"]
mod js_spider;
#[path = "../src/network.rs"]
mod network;
#[path = "../src/url_util.rs"]
mod url_util;

fn preview(value: &serde_json::Value, limit: usize) -> String {
    let text = value.to_string();
    if text.chars().count() <= limit {
        text
    } else {
        format!("{}…", text.chars().take(limit).collect::<String>())
    }
}

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let api = match args.next() {
        Some(api) => api,
        None => {
            eprintln!("用法: cargo run --example drpy_probe -- <api> [ext] [关键词]");
            std::process::exit(2);
        }
    };
    let ext = args.next();
    let keyword = args.next().unwrap_or_else(|| "庆余年".to_string());

    println!("api = {api}");
    println!("ext = {ext:?}");
    println!("关键词 = {keyword}\n");

    let spider = match js_spider::JsSpider::new(&api, ext.as_deref()).await {
        Ok(spider) => spider,
        Err(error) => {
            println!("❌ 创建蜘蛛失败: {error:?}");
            std::process::exit(1);
        }
    };

    let started = Instant::now();
    match spider.home_content(false).await {
        Ok(value) => println!("✅ homeContent（{:.1}s）: {}\n", started.elapsed().as_secs_f32(), preview(&value, 700)),
        Err(error) => println!("❌ homeContent: {error:?}\n"),
    }

    let started = Instant::now();
    let search = spider.search_content(&keyword, false, None).await;
    match &search {
        Ok(value) => println!("✅ searchContent（{:.1}s）: {}\n", started.elapsed().as_secs_f32(), preview(value, 700)),
        Err(error) => println!("❌ searchContent: {error:?}\n"),
    }

    // 搜索 → 详情 → 播放地址：验证 drpy 站点不只出片单，还能走到播放
    let first_id = search
        .as_ref()
        .ok()
        .and_then(|value| value.get("list"))
        .and_then(|list| list.as_array())
        .and_then(|list| list.first())
        .and_then(|item| item.get("vod_id"))
        .and_then(|id| id.as_str())
        .map(str::to_string);

    if let Some(id) = first_id {
        println!("→ 详情 vod_id = {id}");
        let started = Instant::now();
        match spider.detail_content(&[id]).await {
            Ok(detail) => {
                println!("✅ detailContent（{:.1}s）: {}\n", started.elapsed().as_secs_f32(), preview(&detail, 500));
                let play_url = detail
                    .get("list")
                    .and_then(|list| list.as_array())
                    .and_then(|list| list.first())
                    .and_then(|item| item.get("vod_play_url"))
                    .and_then(|url| url.as_str())
                    .unwrap_or("");
                let first_episode = play_url.split('#').next().unwrap_or("");
                let episode_url = first_episode.split('$').nth(1).unwrap_or(first_episode);
                if !episode_url.is_empty() {
                    println!("→ 首个剧集地址: {}", episode_url.chars().take(140).collect::<String>());
                    let started = Instant::now();
                    match spider.player_content("", episode_url, &[]).await {
                        Ok(result) => println!("✅ playerContent（{:.1}s）: {}\n", started.elapsed().as_secs_f32(), preview(&result, 400)),
                        Err(error) => println!("❌ playerContent: {error:?}\n"),
                    }
                } else {
                    println!("⚠️ 详情里没有 vod_play_url，跳过播放验证\n");
                }
            }
            Err(error) => println!("❌ detailContent: {error:?}\n"),
        }
    }

    let started = Instant::now();
    // 可用环境变量指定真实分类参数：DRPY_TID / DRPY_PAGE / DRPY_FILTER / DRPY_EXTEND(JSON)
    let tid = std::env::var("DRPY_TID").unwrap_or_else(|_| "1".to_string());
    let page = std::env::var("DRPY_PAGE").unwrap_or_else(|_| "1".to_string());
    let filter = std::env::var("DRPY_FILTER").map(|v| v == "1" || v == "true").unwrap_or(false);
    let extend: std::collections::HashMap<String, String> = std::env::var("DRPY_EXTEND")
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    match spider.category_content(&tid, &page, filter, &extend).await {
        Ok(value) => println!("✅ categoryContent（{:.1}s）: {}", started.elapsed().as_secs_f32(), preview(&value, 400)),
        Err(error) => println!("❌ categoryContent: {error:?}"),
    }
}
