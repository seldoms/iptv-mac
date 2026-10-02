use std::time::Duration;

use serde_json::Value;

#[path = "../src/config.rs"]
mod config;
#[path = "../src/error.rs"]
mod error;
#[path = "../src/live.rs"]
mod live;
#[path = "../src/js_runtime.rs"]
mod js_runtime;
#[path = "../src/js_session.rs"]
mod js_session;
#[path = "../src/js_spider.rs"]
mod js_spider;
#[path = "../src/js_module.rs"]
mod js_module;
#[path = "../src/network.rs"]
mod network;
#[path = "../src/url_util.rs"]
mod url_util;
#[path = "../src/spider.rs"]
mod spider;
#[path = "../src/path_safety.rs"]
mod path_safety;

#[derive(Default)]
struct ProbeTotals {
    configs_ok: usize,
    configs_failed: usize,
    live_entries: usize,
    live_loaded: usize,
    live_failed: usize,
    groups: usize,
    channels: usize,
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cli_sources: Vec<(String, String)> = args
        .iter()
        .map(|url| ("cli".to_string(), url.to_string()))
        .collect();

    let default_sources = [
        ("qist/饭太硬", "https://qist.wyfc.qzz.io/fty.json"),
        ("fmys", "http://fmys.top/fmys.json"),
        ("clun", "https://clun.top/box.json"),
        ("kstore (vip)", "https://9280.kstore.vip/newwex.json"),
        ("kstore (space)", "https://9280.kstore.space/newwex.json"),
        ("203511", "https://tv.203511.xyz/0821.json"),
        ("qist/潇洒", "https://qist.wyfc.qzz.io/xiaosa/api.json"),
        ("qist/jsm", "https://qist.wyfc.qzz.io/jsm.json"),
        (
            "codeberg",
            "https://codeberg.org/wei88976862/tvbox001/raw/branch/main/fty.json",
        ),
        ("pastebin", "https://pastebin.com/raw/sbPpDm9G"),
        ("IP:47", "http://47.96.82.41:5188/api.json"),
        ("iyouhun", "https://www.iyouhun.com/tv/wex"),
        ("IP:124", "http://124.223.214.31:8/api.json"),
    ];

    let client = network::create_client().expect("build HTTP client");
    let mut totals = ProbeTotals::default();

    let sources: Vec<(String, String)> = if cli_sources.is_empty() {
        default_sources
            .iter()
            .map(|(name, url)| (name.to_string(), url.to_string()))
            .collect()
    } else {
        cli_sources
    };

    for (source_name, config_url) in sources {
        println!("\n=== {} ===", source_name);
        println!("config: {}", config_url);

        let config = match tokio::time::timeout(
            Duration::from_secs(35),
            config::load_config_from_url(&config_url, None),
        )
        .await
        {
            Ok(Ok(value)) => value,
            Ok(Err(error)) => {
                totals.configs_failed += 1;
                println!("CONFIG FAIL: {}", error);
                continue;
            }
            Err(_) => {
                totals.configs_failed += 1;
                println!("CONFIG FAIL: timeout after 35s");
                continue;
            }
        };

        totals.configs_ok += 1;
        let site_entries = config
            .get("sites")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let sites = site_entries.len();
        let lives = config
            .get("lives")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        println!("CONFIG OK: sites={} lives={}", sites, lives.len());
        probe_sites(&config_url, &site_entries).await;

        for live_entry in lives.into_iter().take(1) {
            totals.live_entries += 1;
            let live_name = live_entry
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("unnamed");
            let Some(live_url) = live_entry.get("url").and_then(Value::as_str) else {
                totals.live_failed += 1;
                println!("  LIVE FAIL [{}]: missing url", live_name);
                continue;
            };
            let resolved_live_url = resolve_url(&config_url, live_url);

            match load_live(&client, &resolved_live_url).await {
                Ok((group_count, channel_count)) => {
                    totals.live_loaded += 1;
                    totals.groups += group_count;
                    totals.channels += channel_count;
                    println!(
                        "  LIVE OK   [{}]: groups={} channels={} url={}",
                        live_name, group_count, channel_count, resolved_live_url
                    );
                }
                Err(error) => {
                    totals.live_failed += 1;
                    println!(
                        "  LIVE FAIL [{}]: {} url={}",
                        live_name, error, resolved_live_url
                    );
                }
            }
        }
    }

    println!("\n========== RESULTS ==========");
    println!(
        "configs: ok={} failed={}",
        totals.configs_ok, totals.configs_failed
    );
    println!(
        "lives: entries={} loaded={} failed={}",
        totals.live_entries, totals.live_loaded, totals.live_failed
    );
    println!(
        "parsed: groups={} channels={}",
        totals.groups, totals.channels
    );
    println!("==============================");
}

async fn probe_sites(config_url: &str, sites: &[Value]) {
    let mut supported = 0usize;
    let mut unsupported_csp = 0usize;
    let mut attempted = 0usize;
    let mut home_ok = false;

    for site in sites {
        let site_type = site.get("type").and_then(Value::as_i64).unwrap_or(0);
        let api = site.get("api").and_then(Value::as_str).unwrap_or_default();
        let is_js = site_type == 3 && (api.contains(".js") || api.contains(".mjs"));
        if site_type == 3 && !is_js {
            unsupported_csp += 1;
            continue;
        }
        if !matches!(site_type, 0 | 1 | 4) && !is_js {
            continue;
        }
        if site.get("hide").and_then(Value::as_i64) == Some(1) || api.trim().is_empty() {
            continue;
        }
        if attempted >= 3 {
            break;
        }

        let key = site.get("key").and_then(Value::as_str).unwrap_or_default();
        let name = site.get("name").and_then(Value::as_str).unwrap_or(key);
        supported += 1;
        attempted += 1;

        if is_js {
            let ext = site.get("ext").and_then(Value::as_str);
            let result = tokio::time::timeout(Duration::from_secs(20), async {
                let spider = js_spider::JsSpider::new(api, ext).await?;
                spider.home_content(false).await
            })
            .await;
            match result {
                Ok(Ok(home)) => {
                    let class_count = home.get("class").or_else(|| home.get("types"))
                        .and_then(Value::as_array).map_or(0, Vec::len);
                    let list_count = home.get("list").and_then(Value::as_array).map_or(0, Vec::len);
                    println!("  SITE OK   [{}]: type=3 classes={} list={}", name, class_count, list_count);
                    home_ok = class_count > 0 || list_count > 0;
                }
                Ok(Err(error)) => println!("  SITE FAIL [{}]: type=3 {}", name, error),
                Err(_) => println!("  SITE FAIL [{}]: type=3 timeout after 20s", name),
            }
            if home_ok { break; }
            continue;
        }

        let site_config = spider::SiteConfig {
            key: key.to_string(),
            name: name.to_string(),
            site_type,
            api: config::resolve_relative_url(config_url, api),
            ext: site.get("ext").cloned(),
            play_url: site
                .get("playUrl")
                .or_else(|| site.get("play_url"))
                .and_then(Value::as_str)
                .map(String::from),
            click: site.get("click").and_then(Value::as_str).map(String::from),
            header: site.get("header").cloned(),
            timeout: site.get("timeout").and_then(Value::as_i64),
        };
        let spider = spider::HttpSpider::new(site_config);

        match tokio::time::timeout(Duration::from_secs(20), spider.home_content(false)).await {
            Ok(Ok(home)) => {
                let class_count = home.class.as_ref().map_or(0, Vec::len);
                let list_count = home.list.as_ref().map_or(0, Vec::len);
                println!(
                    "  SITE OK   [{}]: type={} classes={} list={}",
                    name, site_type, class_count, list_count
                );
                home_ok = class_count > 0 || list_count > 0;

                if let Some(first_vod) = home.list.as_ref().and_then(|list| list.first()) {
                    match spider
                        .detail_content(std::slice::from_ref(&first_vod.vod_id))
                        .await
                    {
                        Ok(detail) => {
                            let detail_count = detail.list.as_ref().map_or(0, Vec::len);
                            println!(
                                "    DETAIL OK [{}]: vod_id={} detail_items={}",
                                first_vod.vod_name, first_vod.vod_id, detail_count
                            );

                            if let Some(play_url) = detail
                                .list
                                .as_ref()
                                .and_then(|items| items.first())
                                .and_then(|vod| vod.vod_play_url.as_deref())
                                .and_then(first_play_url)
                            {
                                match spider.player_content("", play_url, &[]).await {
                                    Ok(player) => println!(
                                        "    PLAYER OK: parse={} url={}",
                                        player.parse, player.url
                                    ),
                                    Err(error) => println!("    PLAYER FAIL: {}", error),
                                }
                            }
                        }
                        Err(error) => println!(
                            "    DETAIL FAIL [{}]: vod_id={} {}",
                            first_vod.vod_name, first_vod.vod_id, error
                        ),
                    }
                }
            }
            Ok(Err(error)) => println!("  SITE FAIL [{}]: type={} {}", name, site_type, error),
            Err(_) => println!("  SITE FAIL [{}]: type={} timeout after 20s", name, site_type),
        }
        if home_ok { break; }
    }

    println!(
        "SITE SUMMARY: supported={} attempted={} home_ok={} unsupported_csp={}",
        supported, attempted, home_ok, unsupported_csp
    );
}

fn first_play_url(vod_play_url: &str) -> Option<&str> {
    vod_play_url
        .split('#')
        .next()
        .and_then(|episode| {
            episode
                .rsplit_once('$')
                .map(|(_, url)| url)
                .or(Some(episode))
        })
        .map(str::trim)
        .filter(|url| !url.is_empty())
}

async fn load_live(
    client: &reqwest::Client,
    live_url: &str,
) -> Result<(usize, usize), Box<dyn std::error::Error>> {
    let content =
        tokio::time::timeout(Duration::from_secs(20), network::http_get(client, live_url))
            .await??;
    let groups = live::parse_live_content(&content);
    let channel_count = groups.iter().map(|group| group.channel.len()).sum();
    Ok((groups.len(), channel_count))
}

fn resolve_url(base: &str, candidate: &str) -> String {
    if candidate.starts_with("http://") || candidate.starts_with("https://") {
        return candidate.to_string();
    }
    match url::Url::parse(base).and_then(|url| url.join(candidate)) {
        Ok(url) => url.to_string(),
        Err(_) => candidate.to_string(),
    }
}
