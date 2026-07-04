use std::{
    collections::HashMap,
    sync::LazyLock,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::AppError;

const EPG_REFRESH_INTERVAL: u64 = 6 * 60 * 60; // 6 小时（秒）
const MAX_XMLTV_DECOMPRESSED_BYTES: u64 = 200 * 1024 * 1024; // 200MB decompressed limit

// ==================== 正则编译缓存 ====================

static RE_CHANNEL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"<channel\s+id="([^"]*)"[^>]*>([\s\S]*?)</channel>"#).unwrap()
});
static RE_DISPLAY_NAME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"<display-name[^>]*>([^<]*)</display-name>"#).unwrap()
});
static RE_ICON: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"<icon\s+src="([^"]*)""#).unwrap()
});
static RE_PROGRAMME_BLOCK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"<programme\s+([^>]*)>([\s\S]*?)</programme>"#).unwrap()
});
static RE_START: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?:\s|^)start="([^"]*)""#).unwrap()
});
static RE_STOP: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?:\s|^)stop="([^"]*)""#).unwrap()
});
static RE_PROG_CHANNEL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?:\s|^)channel="([^"]*)""#).unwrap()
});
static RE_TITLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"<title[^>]*>([^<]*)</title>"#).unwrap()
});
static RE_DESC: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"<desc[^>]*>([^<]*)</desc>"#).unwrap()
});

// ==================== 类型 ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpgProgram {
    pub channel: String,
    pub title: String,
    pub start: String,
    pub stop: String,
    pub desc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpgChannel {
    pub id: String,
    pub name: String,
    pub logo: Option<String>,
    pub programs: Vec<EpgProgram>,
}

// ==================== XMLTV 解析 ====================

/// 解析 XMLTV 格式内容
pub fn parse_xmltv(xml: &str) -> Vec<EpgChannel> {
    let mut channels: Vec<EpgChannel> = Vec::new();
    let mut channel_map: HashMap<String, usize> = HashMap::new();

    // 解析 <channel id="xxx">...</channel>
    for cap in RE_CHANNEL.captures_iter(xml) {
        let id = cap[1].to_string();
        let content = &cap[2];

        let name = RE_DISPLAY_NAME
            .captures(content)
            .map(|m| m[1].trim().to_string())
            .unwrap_or_else(|| id.clone());

        let logo = RE_ICON.captures(content).map(|m| m[1].to_string());

        let idx = channels.len();
        channels.push(EpgChannel {
            id: id.clone(),
            name,
            logo,
            programs: Vec::new(),
        });
        channel_map.insert(id, idx);
    }

    // 解析 <programme> 块
    for cap in RE_PROGRAMME_BLOCK.captures_iter(xml) {
        let attrs_str = &cap[1];
        let content = &cap[2];

        let start = RE_START
            .captures(attrs_str)
            .map(|m| format_xmltv_time(&m[1]))
            .unwrap_or_default();
        let stop = RE_STOP
            .captures(attrs_str)
            .map(|m| format_xmltv_time(&m[1]))
            .unwrap_or_default();
        let channel_id = RE_PROG_CHANNEL
            .captures(attrs_str)
            .map(|m| m[1].to_string())
            .unwrap_or_default();

        if channel_id.is_empty() {
            continue;
        }

        let title = RE_TITLE
            .captures(content)
            .map(|m| m[1].trim().to_string())
            .unwrap_or_default();

        let desc = RE_DESC.captures(content).map(|m| m[1].trim().to_string());

        if let Some(&idx) = channel_map.get(&channel_id) {
            channels[idx].programs.push(EpgProgram {
                channel: channel_id,
                title,
                start,
                stop,
                desc,
            });
        }
    }

    // 按时间排序
    for ch in &mut channels {
        ch.programs.sort_by(|a, b| a.start.cmp(&b.start));
    }

    channels
}

/// 格式化 XMLTV 时间
/// 输入: "20260312140000 +0800" → 输出: "2026-03-12 14:00:00"
fn format_xmltv_time(time: &str) -> String {
    let cleaned = time.trim().split_whitespace().next().unwrap_or(time);
    if cleaned.len() < 14 {
        return time.to_string();
    }
    format!(
        "{}-{}-{} {}:{}:{}",
        &cleaned[0..4],
        &cleaned[4..6],
        &cleaned[6..8],
        &cleaned[8..10],
        &cleaned[10..12],
        &cleaned[12..14]
    )
}

// ==================== 缓存 ====================

struct EpgCache {
    channels: Vec<EpgChannel>,
    load_time: u64,
}

static EPG_CACHE: Mutex<Option<HashMap<String, EpgCache>>> = Mutex::new(None);

fn get_cache() -> std::sync::MutexGuard<'static, Option<HashMap<String, EpgCache>>> {
    EPG_CACHE.lock().unwrap()
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ==================== EPG 加载 ====================

/// 获取 EPG 数据
pub async fn get_epg_data(
    epg_url: &str,
    channel_map: Option<&HashMap<String, Value>>,
) -> Result<Vec<EpgChannel>, AppError> {
    if epg_url.is_empty() {
        return Ok(Vec::new());
    }

    let urls: Vec<&str> = epg_url
        .split(',')
        .map(|u| u.trim())
        .filter(|u| !u.is_empty())
        .collect();
    let mut all_channels: Vec<EpgChannel> = Vec::new();
    let mut name_index: HashMap<String, usize> = HashMap::new();

    for url in &urls {
        let channels = if url.contains('{') {
            load_api_epg(url, channel_map).await
        } else {
            load_xmltv_epg(url).await
        };

        match channels {
            Ok(channels) => {
                for ch in channels {
                    let key = ch.name.clone();
                    if let Some(&idx) = name_index.get(&key) {
                        all_channels[idx].programs.extend(ch.programs);
                    } else {
                        name_index.insert(key.clone(), all_channels.len());
                        name_index.insert(ch.id.clone(), all_channels.len());
                        all_channels.push(ch);
                    }
                }
            }
            Err(e) => {
                eprintln!("[epg] 加载失败 [{}]: {}", url, e);
            }
        }
    }

    // 按时间排序
    for ch in &mut all_channels {
        ch.programs.sort_by(|a, b| a.start.cmp(&b.start));
    }

    Ok(all_channels)
}

async fn load_xmltv_epg(url: &str) -> Result<Vec<EpgChannel>, AppError> {
    let cache_key = cache_key(url);
    let now = now_secs();

    // 检查内存缓存
    let mut cache = get_cache();
    let cache_ref = cache.get_or_insert_with(HashMap::new);
    if let Some(entry) = cache_ref.get(&cache_key) {
        if now - entry.load_time < EPG_REFRESH_INTERVAL {
            return Ok(entry.channels.clone());
        }
    }

    // 从网络加载
    let xml_content = if url.ends_with(".gz") {
        let _client = crate::network::create_client()?;
        let bytes = reqwest::get(url)
            .await
            .map_err(|e| AppError::network_error(format!("EPG 下载失败: {}", e)))?
            .bytes()
            .await
            .map_err(|e| AppError::network_error(format!("EPG 读取失败: {}", e)))?;

        if bytes.len() > 50 * 1024 * 1024 {
            return Err(AppError::network_error("EPG 文件超过 50MB 限制"));
        }

        use std::io::Read;
        let decoder = flate2::read::GzDecoder::new(&bytes[..]);
        let mut text = String::new();
        // 限制解压后大小，防止 zip bomb DoS 攻击
        decoder
            .take(MAX_XMLTV_DECOMPRESSED_BYTES)
            .read_to_string(&mut text)
            .map_err(|e| AppError::parse_error("EPG 解压失败").with_internal(e.to_string()))?;
        // 检查是否被 take() 截断（文件超过 200MB）
        if text.len() as u64 >= MAX_XMLTV_DECOMPRESSED_BYTES {
            return Err(AppError::network_error(
                "EPG 文件解压后超过 200MB 限制，已中止",
            ));
        }
        text
    } else {
        let client = crate::network::create_client()?;
        crate::network::http_get(&client, url).await?
    };

    let channels = parse_xmltv(&xml_content);

    // 写入缓存
    let mut cache = get_cache();
    cache.get_or_insert_with(HashMap::new).insert(
        cache_key,
        EpgCache {
            channels: channels.clone(),
            load_time: now,
        },
    );

    Ok(channels)
}

async fn load_api_epg(
    template: &str,
    channel_map: Option<&HashMap<String, Value>>,
) -> Result<Vec<EpgChannel>, AppError> {
    let map = match channel_map {
        Some(m) => m,
        None => return Ok(Vec::new()),
    };

    let client = crate::network::create_client()?;
    let mut channels: Vec<EpgChannel> = Vec::new();

    for (key, info) in map {
        let name = info.get("name").and_then(Value::as_str).unwrap_or(key);
        let id = info.get("id").and_then(Value::as_str).unwrap_or(name);

        let url = template
            .replace("{id}", id)
            .replace("{name}", &urlencoding::encode(name));

        match crate::network::http_get(&client, &url).await {
            Ok(text) => {
                let data: Value = serde_json::from_str(&text)
                    .map_err(|_| AppError::parse_error("EPG API 返回格式错误"))?;

                let programs: Vec<EpgProgram> = if let Some(arr) = data.as_array() {
                    arr.iter()
                        .map(|p| EpgProgram {
                            channel: name.to_string(),
                            title: p
                                .get("title")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string(),
                            start: p
                                .get("start")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string(),
                            stop: p
                                .get("stop")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string(),
                            desc: p.get("desc").and_then(Value::as_str).map(String::from),
                        })
                        .collect()
                } else if let Some(progs) = data.get("programs").and_then(Value::as_array) {
                    progs
                        .iter()
                        .map(|p| {
                            serde_json::from_value(p.clone()).unwrap_or_else(|_| EpgProgram {
                                channel: name.to_string(),
                                title: String::new(),
                                start: String::new(),
                                stop: String::new(),
                                desc: None,
                            })
                        })
                        .collect()
                } else {
                    Vec::new()
                };

                channels.push(EpgChannel {
                    id: id.to_string(),
                    name: name.to_string(),
                    logo: None,
                    programs,
                });
            }
            Err(_) => {
                // 单个频道加载失败不影响其他频道
            }
        }
    }

    Ok(channels)
}

fn cache_key(url: &str) -> String {
    let mut hash: u64 = 0;
    for b in url.bytes() {
        hash = hash.wrapping_mul(31).wrapping_add(b as u64);
    }
    format!("epg_{:x}", hash)
}

/// 获取当前播放的节目
pub fn get_current_program(channels: &[EpgChannel], channel_name: &str) -> Option<EpgProgram> {
    let channel = channels
        .iter()
        .find(|c| c.name == channel_name || c.id == channel_name)?;

    let now = now_secs();
    // 把 now 转成 "YYYY-MM-DD HH:MM:SS" 格式进行比较
    let _secs = now % 86400;
    let days = now / 86400;
    // 粗略计算，从 1970-01-01 开始
    let _year = 1970 + (days as f64 / 365.25) as u64;
    // 简化比较：直接使用 start <= now_str && stop > now_str
    // 由于时间格式是 "YYYY-MM-DD HH:MM:SS"，可以直接字符串比较
    let now_str = format_xmltv_time(&format_now(now));

    channel
        .programs
        .iter()
        .find(|p| p.start.as_str() <= now_str.as_str() && p.stop.as_str() > now_str.as_str())
        .cloned()
}

fn format_now(timestamp: u64) -> String {
    let secs = timestamp % 86400;
    let days = timestamp / 86400;
    let hours = secs / 3600;
    let minutes = (secs % 3600) / 60;
    let seconds = secs % 60;

    // 粗略计算年月日
    let mut y = 1970i64;
    let mut remaining_days = days as i64;
    loop {
        let days_in_year = if is_leap(y) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        y += 1;
    }

    let months_days: &[i64] = if is_leap(y) {
        &[31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        &[31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut m = 1;
    for &md in months_days {
        if remaining_days < md {
            break;
        }
        remaining_days -= md;
        m += 1;
    }

    format!(
        "{:04}{:02}{:02}{:02}{:02}{:02}",
        y,
        m,
        remaining_days + 1,
        hours,
        minutes,
        seconds
    )
}

fn is_leap(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_xml() -> &'static str {
        r#"<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="test">
  <channel id="cctv1.example.com">
    <display-name>CCTV-1</display-name>
    <icon src="http://example.com/cctv1.png"/>
  </channel>
  <channel id="hunan.example.com">
    <display-name>湖南卫视</display-name>
  </channel>
  <programme channel="cctv1.example.com" start="20260101000000 +0800" stop="20260101010000 +0800">
    <title>新闻联播</title>
    <desc>每日新闻</desc>
  </programme>
  <programme channel="cctv1.example.com" start="20260101010000 +0800" stop="20260101020000 +0800">
    <title>焦点访谈</title>
  </programme>
  <programme channel="hunan.example.com" start="20260101000000 +0800" stop="20260101003000 +0800">
    <title>湖南新闻</title>
  </programme>
</tv>"#
    }

    #[test]
    fn parses_xmltv_sample() {
        let channels = parse_xmltv(sample_xml());
        assert_eq!(channels.len(), 2);
        assert_eq!(channels[0].name, "CCTV-1");
        assert_eq!(channels[1].name, "湖南卫视");
    }

    #[test]
    fn parses_xmltv_programs() {
        let channels = parse_xmltv(sample_xml());
        let cctv1 = channels.iter().find(|c| c.name == "CCTV-1").unwrap();
        assert_eq!(cctv1.programs.len(), 2);
        assert_eq!(cctv1.programs[0].title, "新闻联播");
        assert_eq!(cctv1.programs[1].title, "焦点访谈");

        let hunan = channels.iter().find(|c| c.name == "湖南卫视").unwrap();
        assert_eq!(hunan.programs.len(), 1);
        assert_eq!(hunan.programs[0].title, "湖南新闻");
    }

    #[test]
    fn parses_xmltv_program_desc() {
        let channels = parse_xmltv(sample_xml());
        let cctv1 = channels.iter().find(|c| c.name == "CCTV-1").unwrap();
        assert_eq!(cctv1.programs[0].desc.as_deref(), Some("每日新闻"));
    }

    #[test]
    fn programs_are_sorted_by_time() {
        let xml = r#"<?xml version="1.0"?>
        <tv>
          <channel id="ch1"><display-name>Channel 1</display-name></channel>
          <programme start="20260301020000" stop="20260301030000" channel="ch1">
            <title>Second</title>
          </programme>
          <programme start="20260301000000" stop="20260301010000" channel="ch1">
            <title>First</title>
          </programme>
        </tv>"#;
        let channels = parse_xmltv(xml);
        assert_eq!(channels[0].programs[0].title, "First");
        assert_eq!(channels[0].programs[1].title, "Second");
    }

    #[test]
    fn formats_xmltv_time() {
        assert_eq!(
            format_xmltv_time("20260312140000 +0800"),
            "2026-03-12 14:00:00"
        );
        assert_eq!(format_xmltv_time("20260312140000"), "2026-03-12 14:00:00");
    }

    #[test]
    fn formats_short_time_returns_original() {
        assert_eq!(format_xmltv_time("short"), "short");
    }

    #[test]
    fn detects_channel_logo() {
        let xml = r#"<?xml version="1.0"?>
        <tv>
          <channel id="ch1">
            <display-name>Channel 1</display-name>
            <icon src="http://example.com/logo.png"/>
          </channel>
        </tv>"#;
        let channels = parse_xmltv(xml);
        assert_eq!(
            channels[0].logo.as_deref(),
            Some("http://example.com/logo.png")
        );
    }
}
