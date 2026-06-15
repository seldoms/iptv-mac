use std::time::Duration;

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

const SOURCES: &[(&str, &str)] = &[
    ("开心点播 · 如意采集", "https://700sjro44343.vicp.fun/vip/vip/tv.json"),
    ("migu", "https://develop202.github.io/migu_video/interface.txt"),
    ("live", "https://epg.pw/test_channels.m3u"),
    ("develop202/综合直播", "https://gh.927223.xyz/https://raw.githubusercontent.com/develop202/migu_video/refs/heads/main/interface.txt"),
    ("Kimentanm", "https://gh.927223.xyz/https://raw.githubusercontent.com/Kimentanm/aptv/master/m3u/iptv.m3u"),
    ("范明明", "https://nos.netease.com/ysf/3d75a78a0fc7ede372c03598d6d10367.m3u"),
    ("世界杯", "http://82.156.243.185:33389/fwc.m3u"),
    ("虎牙一起看", "https://sub.ottiptv.cc/huyayqk.m3u"),
    ("斗鱼一起看", "https://sub.ottiptv.cc/douyuyqk.m3u"),
    ("B站直播", "https://sub.ottiptv.cc/bililive.m3u"),
    ("YY轮播", "https://sub.ottiptv.cc/yylunbo.m3u"),
    ("24live", "https://urlzf.zone.id/iptv-api/output/user_result.m3u"),
    ("16万·MV", "https://gh.tryxd.cn/raw.githubusercontent.com/lystv/short/main/影视/tvb/MTV.txt"),
];

#[derive(Default)]
struct Totals {
    configs_ok: usize,
    configs_failed: usize,
    vod_sites_checked: usize,
    vod_play_links: usize,
    live_entries: usize,
    live_loaded: usize,
    live_play_links: usize,
    live_alive_samples: usize,
    live_empty_entries: usize,
    groups: usize,
    channels: usize,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = network::create_client()?;
    let mut totals = Totals::default();

    for (name, url) in SOURCES {
        println!("\n=== {} ===", name);
        println!("config: {}", url);

        let (effective_url, config) = match load_config(&client, url).await {
            Ok(value) => value,
            Err(error) => {
                totals.configs_failed += 1;
                println!("CONFIG FAIL: {}", error);
                continue;
            }
        };

        totals.configs_ok += 1;
        let sites = config.get("sites").and_then(Value::as_array).cloned().unwrap_or_default();
        let lives = config.get("lives").and_then(Value::as_array).cloned().unwrap_or_default();
        println!("CONFIG OK: effective={} sites={} lives={}", effective_url, sites.len(), lives.len());

        if let Some((site_name, play_url)) = probe_vod(&sites).await {
            totals.vod_sites_checked += 1;
            totals.vod_play_links += 1;
            println!("VOD PLAY OK [{}]: {}", site_name, play_url);
        } else if sites.iter().any(is_supported_site) {
            totals.vod_sites_checked += 1;
            println!("VOD PLAY FAIL: supported site exists, but no playable link was obtained");
        }

        for live_entry in lives {
            totals.live_entries += 1;
            let live_name = live_entry.get("name").and_then(Value::as_str).unwrap_or("未命名直播源");
            let Some(live_url) = live_entry.get("url").and_then(Value::as_str) else {
                println!("LIVE FAIL [{}]: missing url", live_name);
                continue;
            };
            let live_url = config::resolve_relative_url(&effective_url, live_url);

            let content = match tokio::time::timeout(Duration::from_secs(30), network::http_get(&client, &live_url)).await {
                Ok(Ok(text)) => text,
                Ok(Err(error)) => {
                    println!("LIVE FAIL [{}]: {} url={}", live_name, error, live_url);
                    continue;
                }
                Err(_) => {
                    println!("LIVE FAIL [{}]: timeout url={}", live_name, live_url);
                    continue;
                }
            };

            let groups = live::parse_live_content(&content);
            let channel_count: usize = groups.iter().map(|group| group.channel.len()).sum();
            totals.live_loaded += 1;
            totals.groups += groups.len();
            totals.channels += channel_count;

            if let Some((channel_name, play_url)) = first_live_play_url(&groups) {
                totals.live_play_links += 1;
                let test = live::test_url(&play_url, 4_000).await;
                if test.alive {
                    totals.live_alive_samples += 1;
                }
                println!(
                    "LIVE PLAY {} [{} / {}]: groups={} channels={} latency={} url={}",
                    if test.alive { "OK" } else { "LINK" },
                    live_name,
                    channel_name,
                    groups.len(),
                    channel_count,
                    test.latency,
                    play_url
                );
            } else {
                totals.live_empty_entries += 1;
                println!("LIVE EMPTY [{}]: groups={} channels={} url={}", live_name, groups.len(), channel_count, live_url);
            }
        }
    }

    println!("\n========== BUSINESS FLOW RESULTS ==========");
    println!("configs: ok={} failed={}", totals.configs_ok, totals.configs_failed);
    println!("vod: sites_checked={} play_links={}", totals.vod_sites_checked, totals.vod_play_links);
    println!(
        "live: entries={} loaded={} play_links={} alive_samples={} empty_entries={}",
        totals.live_entries,
        totals.live_loaded,
        totals.live_play_links,
        totals.live_alive_samples,
        totals.live_empty_entries
    );
    println!("parsed live: groups={} channels={}", totals.groups, totals.channels);

    if totals.configs_failed > 0 || totals.vod_play_links == 0 || totals.live_play_links == 0 {
        return Err("business flow probe failed".into());
    }

    println!("RESULT: PASS");
    Ok(())
}

async fn load_config(client: &reqwest::Client, url: &str) -> Result<(String, Value), error::AppError> {
    let text = network::http_get(client, url).await?;
    match config::parse_config_or_live_source(url, &text) {
        Ok(value) => Ok((url.to_string(), value)),
        Err(error) => {
            if let Some(fallback_url) = config::github_raw_fallback_url(url) {
                let fallback_text = network::http_get(client, &fallback_url).await?;
                let value = config::parse_config_or_live_source(&fallback_url, &fallback_text)?;
                Ok((fallback_url, value))
            } else {
                Err(error)
            }
        }
    }
}

async fn probe_vod(sites: &[Value]) -> Option<(String, String)> {
    for site in sites.iter().filter(|site| is_supported_site(site)) {
        let key = site.get("key").and_then(Value::as_str).unwrap_or_default();
        let name = site.get("name").and_then(Value::as_str).unwrap_or(key).to_string();
        let api = site.get("api").and_then(Value::as_str)?;
        let spider = spider::HttpSpider::new(spider::SiteConfig {
            key: key.to_string(),
            name: name.clone(),
            site_type: site.get("type").and_then(Value::as_i64).unwrap_or(1),
            api: api.to_string(),
            ext: site.get("ext").cloned(),
            play_url: site.get("playUrl").or_else(|| site.get("play_url")).and_then(Value::as_str).map(String::from),
            click: site.get("click").and_then(Value::as_str).map(String::from),
            header: site.get("header").cloned(),
            timeout: site.get("timeout").and_then(Value::as_i64),
        });

        let Ok(home) = spider.home_content(false).await else { continue; };
        let first_vod = home.list.as_ref().and_then(|list| list.first())?;
        let Ok(detail) = spider.detail_content(std::slice::from_ref(&first_vod.vod_id)).await else { continue; };
        let Some(play_url) = detail
            .list
            .as_ref()
            .and_then(|items| items.first())
            .and_then(|vod| vod.vod_play_url.as_deref())
            .and_then(first_episode_url)
        else {
            continue;
        };

        let Ok(player) = spider.player_content("", play_url, &[]).await else { continue; };
        if !player.url.trim().is_empty() {
            return Some((name, player.url));
        }
    }
    None
}

fn is_supported_site(site: &Value) -> bool {
    matches!(site.get("type").and_then(Value::as_i64).unwrap_or(0), 0 | 1 | 4)
}

fn first_episode_url(vod_play_url: &str) -> Option<&str> {
    vod_play_url
        .split('#')
        .next()
        .and_then(|episode| episode.rsplit_once('$').map(|(_, url)| url).or(Some(episode)))
        .map(str::trim)
        .filter(|url| !url.is_empty())
}

fn first_live_play_url(groups: &[live::Group]) -> Option<(String, String)> {
    groups.iter().find_map(|group| {
        group.channel.iter().find_map(|channel| {
            channel.urls.first().map(|url| {
                (channel.name.clone(), url.clone())
            })
        })
    })
}
