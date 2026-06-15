use std::collections::{HashMap, HashSet};
use std::fs;
use std::time::{Duration, Instant};

use reqwest::header::{CONTENT_TYPE, RANGE};
use serde::Deserialize;
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
#[path = "../src/super_parse.rs"]
mod super_parse;

const TARGET_SAMPLES: usize = 10;
const MIN_SUCCESS_RATE: f64 = 0.85;
const MAX_CONFIGS: usize = 12;
const MAX_SITES_PER_CONFIG: usize = 12;
const MAX_HOME_ITEMS_PER_SITE: usize = 16;
const MAX_EPISODES_PER_VOD: usize = 1;
const MAX_SAMPLES_PER_CONFIG: usize = 10;
const MAX_SAMPLES_PER_SITE: usize = 10;

const DEFAULT_VOD_SOURCES: &[(&str, &str)] = &[
    (
        "开心点播 · 如意采集",
        "https://700sjro44343.vicp.fun/vip/vip/tv.json",
    ),
    ("饭太硬", "https://qist.wyfc.qzz.io/fty.json"),
    ("潇洒", "https://qist.wyfc.qzz.io/xiaosa/api.json"),
    ("肥猫影视", "http://fmys.top/fmys.json"),
    ("47.96 API", "http://47.96.82.41:5188/api.json"),
    ("124.223 API", "http://124.223.214.31:8/api.json"),
    ("203511", "https://tv.203511.xyz/0821.json"),
];

#[derive(Debug, Deserialize)]
struct ConfigStore {
    #[serde(default)]
    configs: Vec<StoredConfig>,
}

#[derive(Debug, Deserialize)]
struct StoredConfig {
    url: String,
    #[serde(default)]
    name: String,
}

#[derive(Debug)]
struct ProbeSample {
    source_name: String,
    config_url: String,
    site_key: String,
    site_name: String,
    vod_id: String,
    vod_name: String,
    flag: String,
    episode_url: String,
}

#[derive(Debug)]
struct ProbeResult {
    sample: ProbeSample,
    resolved_from: String,
    resolved_url: String,
    ok: bool,
    elapsed_ms: u128,
    error: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = network::create_client()?;
    let sources = load_sources();
    let mut samples = Vec::new();
    let mut seen = HashSet::new();

    println!("Alpha 2.1 playback probe");
    println!("target_samples={TARGET_SAMPLES} min_success_rate={MIN_SUCCESS_RATE}");

    for (source_name, config_url) in sources.into_iter().take(MAX_CONFIGS) {
        if samples.len() >= TARGET_SAMPLES {
            break;
        }

        println!("\n=== source: {source_name} ===");
        println!("config: {config_url}");
        let (effective_url, config_value) = match load_config(&client, &config_url).await {
            Ok(value) => value,
            Err(error) => {
                println!("CONFIG FAIL: {error}");
                continue;
            }
        };

        let sites = config_value
            .get("sites")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let parses = config_value
            .get("parses")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        println!(
            "CONFIG OK: effective={} sites={} parses={}",
            effective_url,
            sites.len(),
            parses.len()
        );

        collect_samples_from_config(
            &source_name,
            &effective_url,
            &sites,
            &mut samples,
            &mut seen,
        )
        .await;
    }

    if samples.len() < TARGET_SAMPLES {
        println!(
            "\nRESULT: FAIL - only collected {} VOD samples, need {}",
            samples.len(),
            TARGET_SAMPLES
        );
        return Err("not enough VOD samples".into());
    }

    println!("\n========== SAMPLE REQUESTS ==========");
    let mut results = Vec::new();
    for sample in samples.into_iter().take(TARGET_SAMPLES) {
        let result = probe_sample(&client, sample).await;
        print_result(&result);
        results.push(result);
    }

    let success = results.iter().filter(|result| result.ok).count();
    let total = results.len();
    let success_rate = success as f64 / total as f64;
    let mut elapsed: Vec<u128> = results
        .iter()
        .filter(|result| result.ok)
        .map(|result| result.elapsed_ms)
        .collect();
    elapsed.sort_unstable();
    let p50 = percentile(&elapsed, 0.50);
    let p90 = percentile(&elapsed, 0.90);

    println!("\n========== ALPHA 2.1 PLAYBACK PROBE RESULTS ==========");
    println!(
        "samples: total={total} success={success} failed={}",
        total - success
    );
    println!("playback_request_success_rate={:.0}%", success_rate * 100.0);
    println!(
        "request_elapsed_ms: p50={} p90={}",
        display_opt(p50),
        display_opt(p90)
    );

    if success_rate < MIN_SUCCESS_RATE {
        println!(
            "RESULT: FAIL - success rate {:.0}% below {:.0}%",
            success_rate * 100.0,
            MIN_SUCCESS_RATE * 100.0
        );
        return Err("playback probe failed".into());
    }

    println!("RESULT: PASS");
    Ok(())
}

fn load_sources() -> Vec<(String, String)> {
    let mut sources = Vec::new();
    for (name, url) in DEFAULT_VOD_SOURCES {
        sources.push(((*name).to_string(), (*url).to_string()));
    }

    if let Ok(text) = fs::read_to_string("data/config-store.json") {
        if let Ok(store) = serde_json::from_str::<ConfigStore>(&text) {
            for item in store.configs {
                if !item.url.trim().is_empty()
                    && !sources.iter().any(|(_, existing)| existing == &item.url)
                {
                    let name = if item.name.trim().is_empty() {
                        "saved".to_string()
                    } else {
                        item.name
                    };
                    sources.push((name, item.url));
                }
            }
        }
    }
    sources
}

async fn load_config(
    client: &reqwest::Client,
    url: &str,
) -> Result<(String, Value), error::AppError> {
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

async fn collect_samples_from_config(
    source_name: &str,
    config_url: &str,
    sites: &[Value],
    samples: &mut Vec<ProbeSample>,
    seen: &mut HashSet<String>,
) {
    let config_start_len = samples.len();
    for site in sites
        .iter()
        .filter(|site| is_supported_site(site))
        .take(MAX_SITES_PER_CONFIG)
    {
        if samples.len() >= TARGET_SAMPLES
            || samples.len().saturating_sub(config_start_len) >= MAX_SAMPLES_PER_CONFIG
        {
            break;
        }

        let Some(spider) = spider_from_site(config_url, site) else {
            continue;
        };
        let site_key = site.get("key").and_then(Value::as_str).unwrap_or_default();
        let site_name = site
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(site_key)
            .to_string();
        let home =
            match tokio::time::timeout(Duration::from_secs(12), spider.home_content(false)).await {
                Ok(Ok(home)) => home,
                Ok(Err(error)) => {
                    println!("  SITE FAIL [{site_name}]: {error}");
                    continue;
                }
                Err(_) => {
                    println!("  SITE FAIL [{site_name}]: timeout");
                    continue;
                }
            };
        let Some(list) = home.list else {
            continue;
        };

        let site_start_len = samples.len();
        for vod in list.into_iter().take(MAX_HOME_ITEMS_PER_SITE) {
            if samples.len() >= TARGET_SAMPLES
                || samples.len().saturating_sub(config_start_len) >= MAX_SAMPLES_PER_CONFIG
                || samples.len().saturating_sub(site_start_len) >= MAX_SAMPLES_PER_SITE
            {
                break;
            }
            if vod.vod_id.is_empty() || vod.vod_name.is_empty() {
                continue;
            }
            let details = match tokio::time::timeout(
                Duration::from_secs(12),
                spider.detail_content(std::slice::from_ref(&vod.vod_id)),
            )
            .await
            {
                Ok(Ok(details)) => details,
                _ => continue,
            };
            let Some(detail) = details.list.and_then(|items| items.into_iter().next()) else {
                continue;
            };
            let Some(play_url) = detail.vod_play_url.as_deref() else {
                continue;
            };
            let flags = parse_flags(detail.vod_play_from.as_deref());
            for (group_index, episode_url) in first_episode_urls(play_url)
                .into_iter()
                .take(MAX_EPISODES_PER_VOD)
                .enumerate()
            {
                let key = format!("{site_key}::{}::{episode_url}", vod.vod_id);
                if !seen.insert(key) {
                    continue;
                }
                let flag = flags
                    .get(group_index)
                    .cloned()
                    .unwrap_or_else(|| "默认".to_string());
                samples.push(ProbeSample {
                    source_name: source_name.to_string(),
                    config_url: config_url.to_string(),
                    site_key: site_key.to_string(),
                    site_name: site_name.clone(),
                    vod_id: vod.vod_id.clone(),
                    vod_name: vod.vod_name.clone(),
                    flag,
                    episode_url,
                });
                if samples.len() >= TARGET_SAMPLES {
                    break;
                }
            }
        }
    }
}

async fn probe_sample(client: &reqwest::Client, sample: ProbeSample) -> ProbeResult {
    let started = Instant::now();
    let resolved = resolve_sample(&sample).await;
    let (resolved_from, resolved_url, header) = match resolved {
        Ok(value) => value,
        Err(error) => {
            return ProbeResult {
                sample,
                resolved_from: "-".to_string(),
                resolved_url: "-".to_string(),
                ok: false,
                elapsed_ms: started.elapsed().as_millis(),
                error: Some(error),
            };
        }
    };

    let request_result = test_playback_request(client, &resolved_url, header.as_ref()).await;
    ProbeResult {
        sample,
        resolved_from,
        resolved_url,
        ok: request_result.is_ok(),
        elapsed_ms: started.elapsed().as_millis(),
        error: request_result.err(),
    }
}

async fn resolve_sample(
    sample: &ProbeSample,
) -> Result<(String, String, Option<HashMap<String, String>>), String> {
    let config_text = network::http_get(
        &network::create_client().map_err(|error| error.to_string())?,
        &sample.config_url,
    )
    .await
    .map_err(|error| error.to_string())?;
    let config_value = config::parse_config_or_live_source(&sample.config_url, &config_text)
        .map_err(|error| error.to_string())?;
    let sites = config_value
        .get("sites")
        .and_then(Value::as_array)
        .ok_or_else(|| "config has no sites".to_string())?;
    let parses = config_value
        .get("parses")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let site = sites
        .iter()
        .find(|site| site.get("key").and_then(Value::as_str) == Some(sample.site_key.as_str()))
        .ok_or_else(|| format!("site not found: {}", sample.site_key))?;
    let spider =
        spider_from_site(&sample.config_url, site).ok_or_else(|| "unsupported site".to_string())?;
    let player = spider
        .player_content(&sample.flag, &sample.episode_url, &[])
        .await
        .map_err(|error| error.to_string())?;
    let player_value = serde_json::to_value(&player).map_err(|error| error.to_string())?;
    let parse_result = super_parse::super_parse(
        &sample.episode_url,
        &sample.flag,
        &sample.site_key,
        Some(&player_value),
        Some(&parses),
    )
    .await
    .map_err(|error| error.to_string())?
    .ok_or_else(|| "super_parse returned no playable URL".to_string())?;

    Ok((parse_result.from, parse_result.url, parse_result.header))
}

async fn test_playback_request(
    client: &reqwest::Client,
    url: &str,
    headers: Option<&HashMap<String, String>>,
) -> Result<(), String> {
    let mut request = client
        .get(url)
        .timeout(Duration::from_secs(10))
        .header(RANGE, "bytes=0-2047");
    if let Some(headers) = headers {
        for (key, value) in headers {
            request = request.header(key, value);
        }
    }

    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {}", status.as_u16()));
    }

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let looks_like_hls = url.to_ascii_lowercase().contains(".m3u8")
        || content_type.contains("mpegurl")
        || content_type.contains("vnd.apple");

    if looks_like_hls {
        let text = response.text().await.map_err(|error| error.to_string())?;
        if text.contains("#EXTM3U")
            || text.contains("#EXTINF")
            || text.contains("#EXT-X-STREAM-INF")
        {
            return Ok(());
        }
        return Err("HLS manifest response did not contain playlist markers".to_string());
    }

    Ok(())
}

fn spider_from_site(config_url: &str, site: &Value) -> Option<spider::HttpSpider> {
    let site_type = site.get("type").and_then(Value::as_i64).unwrap_or(1);
    if !matches!(site_type, 0 | 1 | 4) {
        return None;
    }
    if site.get("hide").and_then(Value::as_i64) == Some(1) {
        return None;
    }
    let key = site.get("key").and_then(Value::as_str)?.trim();
    let api = site.get("api").and_then(Value::as_str)?.trim();
    if key.is_empty() || api.is_empty() {
        return None;
    }

    Some(spider::HttpSpider::new(spider::SiteConfig {
        key: key.to_string(),
        name: site
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(key)
            .to_string(),
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
    }))
}

fn is_supported_site(site: &Value) -> bool {
    site.get("api").and_then(Value::as_str).is_some()
        && matches!(
            site.get("type").and_then(Value::as_i64).unwrap_or(1),
            0 | 1 | 4
        )
        && site.get("hide").and_then(Value::as_i64) != Some(1)
}

fn parse_flags(value: Option<&str>) -> Vec<String> {
    value
        .unwrap_or_default()
        .split("$$$")
        .map(str::trim)
        .filter(|flag| !flag.is_empty())
        .map(String::from)
        .collect()
}

fn first_episode_urls(vod_play_url: &str) -> Vec<String> {
    let mut urls = Vec::new();
    for group in vod_play_url.split("$$$") {
        for episode in group.split('#') {
            let url = episode
                .rsplit_once('$')
                .map(|(_, url)| url)
                .unwrap_or(episode)
                .trim();
            if !url.is_empty() {
                urls.push(url.to_string());
                break;
            }
        }
    }
    urls
}

fn percentile(values: &[u128], percentile: f64) -> Option<u128> {
    if values.is_empty() {
        return None;
    }
    let index = ((values.len() - 1) as f64 * percentile).round() as usize;
    values.get(index).copied()
}

fn display_opt(value: Option<u128>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "-".to_string())
}

fn print_result(result: &ProbeResult) {
    let status = if result.ok { "OK" } else { "FAIL" };
    println!(
        "{status} [{} / {} / {} ({})] from={} elapsed={}ms url={}{}",
        result.sample.source_name,
        result.sample.site_name,
        result.sample.vod_name,
        result.sample.vod_id,
        result.resolved_from,
        result.elapsed_ms,
        result.resolved_url,
        result
            .error
            .as_ref()
            .map(|error| format!(" error={error}"))
            .unwrap_or_default()
    );
}
