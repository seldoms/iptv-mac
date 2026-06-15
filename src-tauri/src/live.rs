use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ==================== 直播类型 ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Catchup {
    #[serde(rename = "type")]
    pub catchup_type: Option<String>,
    pub source: Option<String>,
    pub replace: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Drm {
    #[serde(rename = "type")]
    pub drm_type: String,
    pub key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Channel {
    pub name: String,
    pub urls: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub epg: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ua: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub click: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub referer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tvg_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tvg_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parse: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catchup: Option<Catchup>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drm: Option<Drm>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pass: Option<String>,
    pub channel: Vec<Channel>,
}

#[derive(Debug, Default, Clone)]
struct Directives {
    ua: Option<String>,
    origin: Option<String>,
    referer: Option<String>,
    header: Option<HashMap<String, String>>,
    format: Option<String>,
    parse: Option<i64>,
    click: Option<String>,
    force_key: bool,
}

/// 解析直播源内容，自动检测格式
pub fn parse_live_content(content: &str) -> Vec<Group> {
    let trimmed = content.trim();

    if trimmed.starts_with('[') {
        return parse_json_format(trimmed);
    }

    if trimmed.contains("#EXTM3U") && !trimmed.contains("#genre#") {
        return parse_m3u_format(trimmed);
    }

    parse_txt_format(trimmed)
}

// ==================== TXT 格式 ====================

fn parse_txt_format(content: &str) -> Vec<Group> {
    let mut groups: Vec<Group> = Vec::new();
    let mut current_group: Option<usize> = None;
    let mut group_directives = Directives::default();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        if line.contains("#genre#") {
            let comma_idx = line.find(',');
            let group_name = if comma_idx.is_some() && comma_idx.unwrap() > 0 {
                line[..comma_idx.unwrap()].trim().to_string()
            } else {
                line.replace("#genre#", "").trim().to_string()
            };

            // 密码在 #genre# 后: 香港,#genre#_secret
            let after_genre = if let Some(genre_idx) = line.find("#genre#") {
                if genre_idx + 7 < line.len() {
                    let rest = line[genre_idx + 7..].trim().to_string();
                    if rest.starts_with('_') && rest.len() > 1 {
                        Some(rest[1..].to_string())
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            };

            groups.push(Group {
                name: group_name,
                pass: after_genre,
                channel: Vec::new(),
            });
            current_group = Some(groups.len() - 1);
            group_directives = Directives::default();
            continue;
        }

        if let Some(directive) = parse_directive(line) {
            merge_directives(&mut group_directives, &directive);
            continue;
        }

        let comma_idx = match line.find(',') {
            Some(idx) if idx > 0 => idx,
            _ => continue,
        };

        let channel_name = line[..comma_idx].trim();
        let url_part = line[comma_idx + 1..].trim();

        if !url_part.contains("://") {
            if let Some(directive) = parse_directive(line) {
                merge_directives(&mut group_directives, &directive);
            }
            continue;
        }

        let group_idx = current_group.unwrap_or_else(|| {
            groups.push(Group {
                name: String::new(),
                pass: None,
                channel: Vec::new(),
            });
            current_group = Some(groups.len() - 1);
            current_group.unwrap()
        });

        let channel = parse_channel_urls(channel_name, url_part, &group_directives);
        groups[group_idx].channel.push(channel);
    }

    groups
}

// ==================== M3U 格式 ====================

fn parse_m3u_format(content: &str) -> Vec<Group> {
    let mut groups: Vec<Group> = Vec::new();
    let mut group_map: HashMap<String, usize> = HashMap::new();

    let mut global_catchup: Option<Catchup> = None;

    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return groups;
    }

    if lines[0].contains("#EXTM3U") {
        global_catchup = parse_m3u_catchup(lines[0]);
    }

    let mut pending_channel: Option<Channel> = None;
    let mut pending_group_name = String::new();
    let mut pending_directives = Directives::default();
    let mut start_line = 0;

    if lines[0].contains("#EXTM3U") {
        start_line = 1;
    }

    for i in start_line..lines.len() {
        let line = lines[i].trim();
        if line.is_empty() {
            continue;
        }

        if line.starts_with("#EXTINF:") {
            let parsed = parse_extinf_line(line);
            pending_channel = parsed.channel;
            pending_group_name = parsed.group_name;
            pending_directives = Directives::default();
            continue;
        }

        if line.starts_with('#') {
            let directive = parse_m3u_directive(line);
            if let Some(dir) = directive {
                if let Some(ch) = dir.channel {
                    if let Some(ref mut pc) = pending_channel {
                        merge_channels(pc, &ch);
                    }
                }
                if let Some(dirs) = dir.directives {
                    merge_directives(&mut pending_directives, &dirs);
                }
            }
            continue;
        }

        if line.contains("://") && pending_channel.is_some() {
            let (url, inline_headers) = parse_inline_headers(line);
            let pc = pending_channel.take().unwrap_or_else(|| Channel {
                name: String::new(),
                urls: vec![],
                ..Default::default()
            });
            let group_name = std::mem::take(&mut pending_group_name);

            let group_idx = match group_map.get(&group_name) {
                Some(&idx) => idx,
                None => {
                    let idx = groups.len();
                    groups.push(Group {
                        name: group_name.clone(),
                        pass: None,
                        channel: Vec::new(),
                    });
                    group_map.insert(group_name.clone(), idx);
                    idx
                }
            };

            let mut merged_dirs = pending_directives.clone();
            merge_header(&mut merged_dirs, &inline_headers);
            pending_directives = Directives::default();

            let mut ch = Channel {
                name: pc.name,
                urls: vec![url],
                number: pc.number,
                logo: pc.logo,
                epg: pc.epg,
                ua: pc.ua,
                click: pc.click,
                format: pc.format,
                origin: pc.origin,
                referer: pc.referer,
                tvg_id: pc.tvg_id,
                tvg_name: pc.tvg_name,
                catchup: pc.catchup.or_else(|| global_catchup.clone()),
                drm: pc.drm,
                ..Default::default()
            };
            apply_directives_to_channel(&mut ch, &merged_dirs);
            if pc.header.is_some() || !inline_headers.is_empty() {
                let mut h = pc.header.unwrap_or_default();
                for (k, v) in &inline_headers {
                    h.insert(k.clone(), v.clone());
                }
                ch.header = Some(h);
            }

            groups[group_idx].channel.push(ch);
        }
    }

    groups
}

// ==================== JSON 格式 ====================

fn parse_json_format(content: &str) -> Vec<Group> {
    let raw: Vec<Value> = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    raw.into_iter()
        .map(|g| {
            let name = g
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let pass = g.get("pass").and_then(Value::as_str).map(String::from);
            let channels = g
                .get("channel")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .map(|c| {
                            let name = c
                                .get("name")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string();
                            let urls = c
                                .get("urls")
                                .and_then(Value::as_array)
                                .map(|a| {
                                    a.iter()
                                        .filter_map(|v| v.as_str().map(String::from))
                                        .collect()
                                })
                                .unwrap_or_default();
                            let header = c.get("header").and_then(|v| {
                                v.as_object().map(|obj| {
                                    obj.iter()
                                        .map(|(k, v)| {
                                            (k.clone(), v.as_str().unwrap_or("").to_string())
                                        })
                                        .collect()
                                })
                            });
                            let catchup = c
                                .get("catchup")
                                .map(|v| serde_json::from_value(v.clone()).unwrap_or_default());
                            let drm = c
                                .get("drm")
                                .map(|v| serde_json::from_value(v.clone()).unwrap_or_default());

                            Channel {
                                name,
                                urls,
                                number: c.get("number").and_then(Value::as_str).map(String::from),
                                logo: c.get("logo").and_then(Value::as_str).map(String::from),
                                epg: c.get("epg").and_then(Value::as_str).map(String::from),
                                ua: c.get("ua").and_then(Value::as_str).map(String::from),
                                click: c.get("click").and_then(Value::as_str).map(String::from),
                                format: c.get("format").and_then(Value::as_str).map(String::from),
                                origin: c.get("origin").and_then(Value::as_str).map(String::from),
                                referer: c.get("referer").and_then(Value::as_str).map(String::from),
                                tvg_id: c
                                    .get("tvgId")
                                    .or_else(|| c.get("tvg_id"))
                                    .and_then(Value::as_str)
                                    .map(String::from),
                                tvg_name: c
                                    .get("tvgName")
                                    .or_else(|| c.get("tvg_name"))
                                    .and_then(Value::as_str)
                                    .map(String::from),
                                header,
                                parse: c.get("parse").and_then(Value::as_i64),
                                catchup,
                                drm,
                            }
                        })
                        .collect()
                })
                .unwrap_or_default();

            Group {
                name,
                pass,
                channel: channels,
            }
        })
        .collect()
}

// ==================== 辅助函数 ====================

impl Default for Channel {
    fn default() -> Self {
        Self {
            name: String::new(),
            urls: vec![],
            number: None,
            logo: None,
            epg: None,
            ua: None,
            click: None,
            format: None,
            origin: None,
            referer: None,
            tvg_id: None,
            tvg_name: None,
            header: None,
            parse: None,
            catchup: None,
            drm: None,
        }
    }
}

impl Default for Catchup {
    fn default() -> Self {
        Self {
            catchup_type: None,
            source: None,
            replace: None,
        }
    }
}

impl Default for Drm {
    fn default() -> Self {
        Self {
            drm_type: String::new(),
            key: String::new(),
            header: None,
        }
    }
}

fn parse_directive(line: &str) -> Option<Directives> {
    if line.starts_with("ua=") {
        Some(Directives {
            ua: Some(line[3..].trim().to_string()),
            ..Default::default()
        })
    } else if line.starts_with("origin=") {
        Some(Directives {
            origin: Some(line[7..].trim().to_string()),
            ..Default::default()
        })
    } else if line.starts_with("referer=") || line.starts_with("referrer=") {
        let eq_idx = line.find('=')?;
        Some(Directives {
            referer: Some(line[eq_idx + 1..].trim().to_string()),
            ..Default::default()
        })
    } else if line.starts_with("header=") {
        let header = serde_json::from_str::<HashMap<String, String>>(line[7..].trim()).ok();
        Some(Directives {
            header,
            ..Default::default()
        })
    } else if line.starts_with("format=") {
        Some(Directives {
            format: Some(map_format(line[7..].trim())),
            ..Default::default()
        })
    } else if line.starts_with("parse=") {
        Some(Directives {
            parse: line[6..].trim().parse::<i64>().ok(),
            ..Default::default()
        })
    } else if line.starts_with("click=") {
        Some(Directives {
            click: Some(line[6..].trim().to_string()),
            ..Default::default()
        })
    } else if line.starts_with("forceKey=") {
        Some(Directives {
            force_key: line[9..].trim() == "true",
            ..Default::default()
        })
    } else {
        None
    }
}

fn merge_directives(target: &mut Directives, src: &Directives) {
    if src.ua.is_some() {
        target.ua = src.ua.clone();
    }
    if src.origin.is_some() {
        target.origin = src.origin.clone();
    }
    if src.referer.is_some() {
        target.referer = src.referer.clone();
    }
    if src.format.is_some() {
        target.format = src.format.clone();
    }
    if src.parse.is_some() {
        target.parse = src.parse;
    }
    if src.click.is_some() {
        target.click = src.click.clone();
    }
    if src.force_key {
        target.force_key = true;
    }
    if let Some(ref h) = src.header {
        merge_header(target, h);
    }
}

fn merge_header(dirs: &mut Directives, headers: &HashMap<String, String>) {
    let mut h = dirs.header.take().unwrap_or_default();
    for (k, v) in headers {
        h.insert(k.clone(), v.clone());
    }
    dirs.header = Some(h);
}

fn map_format(format: &str) -> String {
    match format.to_lowercase().as_str() {
        "hls" => "application/x-mpegURL".to_string(),
        "dash" | "mpd" => "application/dash+xml".to_string(),
        other => other.to_string(),
    }
}

fn parse_channel_urls(name: &str, url_part: &str, directives: &Directives) -> Channel {
    let mut all_headers = directives.header.clone().unwrap_or_default();
    let mut urls: Vec<String> = Vec::new();

    for segment in url_part.split('#') {
        let trimmed = segment.trim();
        if trimmed.is_empty() {
            continue;
        }
        let (url, headers) = parse_inline_headers(trimmed);
        urls.push(url);
        for (k, v) in headers {
            all_headers.insert(k, v);
        }
    }

    let mut ch = Channel {
        name: name.to_string(),
        urls,
        ..Default::default()
    };
    apply_directives_to_channel(&mut ch, directives);
    if !all_headers.is_empty() {
        ch.header = Some(all_headers);
    }
    ch
}

fn parse_inline_headers(url: &str) -> (String, HashMap<String, String>) {
    let mut headers = HashMap::new();
    let pipe_idx = match url.find('|') {
        Some(idx) => idx,
        None => return (url.to_string(), headers),
    };

    let actual_url = url[..pipe_idx].to_string();
    let header_part = &url[pipe_idx + 1..];

    for pair in header_part.split('&') {
        let eq_idx = match pair.find('=') {
            Some(idx) if idx > 0 => idx,
            _ => continue,
        };
        let key = decode_inline_part(&pair[..eq_idx]);
        let value = decode_inline_part(&pair[eq_idx + 1..]);
        if !key.is_empty() {
            headers.insert(key, value);
        }
    }

    (actual_url, headers)
}

fn decode_inline_part(value: &str) -> String {
    urlencoding::decode(value)
        .map(|s| s.to_string())
        .unwrap_or_else(|_| value.to_string())
}

fn apply_directives_to_channel(ch: &mut Channel, dirs: &Directives) {
    if let Some(ref ua) = dirs.ua {
        ch.ua = Some(ua.clone());
    }
    if let Some(ref origin) = dirs.origin {
        ch.origin = Some(origin.clone());
    }
    if let Some(ref referer) = dirs.referer {
        ch.referer = Some(referer.clone());
    }
    if let Some(ref format) = dirs.format {
        ch.format = Some(format.clone());
    }
    if let Some(parse) = dirs.parse {
        ch.parse = Some(parse);
    }
    if let Some(ref click) = dirs.click {
        ch.click = Some(click.clone());
    }
    if let Some(ref header) = dirs.header {
        let mut h = ch.header.take().unwrap_or_default();
        for (k, v) in header {
            h.insert(k.clone(), v.clone());
        }
        ch.header = Some(h);
    }
}

fn merge_channels(target: &mut Channel, src: &Channel) {
    if src.ua.is_some() {
        target.ua = src.ua.clone();
    }
    if src.referer.is_some() {
        target.referer = src.referer.clone();
    }
    if src.origin.is_some() {
        target.origin = src.origin.clone();
    }
    if src.drm.is_some() {
        target.drm = src.drm.clone();
    }
    if src.header.is_some() {
        let mut h = target.header.take().unwrap_or_default();
        if let Some(ref sh) = src.header {
            for (k, v) in sh {
                h.insert(k.clone(), v.clone());
            }
        }
        target.header = Some(h);
    }
}

fn extract_attr(line: &str, attr: &str) -> Option<String> {
    let pattern = format!(r#"{}=["']([^"']*)["']"#, regex::escape(attr));
    let re = regex::Regex::new(&pattern).ok()?;
    re.captures(line)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
}

fn parse_extinf_line(line: &str) -> M3uParsedLine {
    let mut channel = Channel::default();

    let comma_idx = line.rfind(',');
    if let Some(idx) = comma_idx {
        channel.name = line[idx + 1..].trim().to_string();
    }

    channel.tvg_id = extract_attr(line, "tvg-id");
    channel.tvg_name = extract_attr(line, "tvg-name");
    channel.number = extract_attr(line, "tvg-chno");
    channel.logo = extract_attr(line, "tvg-logo");
    let group_name = extract_attr(line, "group-title").unwrap_or_default();

    if let Some(ua) = extract_attr(line, "http-user-agent") {
        channel.ua = Some(ua);
    }

    let catchup_type = extract_attr(line, "catchup");
    let catchup_source = extract_attr(line, "catchup-source");
    let catchup_replace = extract_attr(line, "catchup-replace");
    if catchup_type.is_some() || catchup_source.is_some() {
        channel.catchup = Some(Catchup {
            catchup_type,
            source: catchup_source,
            replace: catchup_replace,
        });
    }

    M3uParsedLine {
        channel: Some(channel),
        group_name,
    }
}

fn parse_m3u_catchup(line: &str) -> Option<Catchup> {
    let catchup_type = extract_attr(line, "catchup");
    let catchup_source = extract_attr(line, "catchup-source");
    let catchup_replace = extract_attr(line, "catchup-replace");

    if catchup_type.is_none() && catchup_source.is_none() {
        return None;
    }

    Some(Catchup {
        catchup_type,
        source: catchup_source,
        replace: catchup_replace,
    })
}

struct M3uParsedLine {
    channel: Option<Channel>,
    group_name: String,
}

struct M3uDirectiveResult {
    channel: Option<Channel>,
    directives: Option<Directives>,
}

fn parse_m3u_directive(line: &str) -> Option<M3uDirectiveResult> {
    if line.starts_with("#EXTHTTP:") {
        let header: HashMap<String, String> = serde_json::from_str(&line[9..].trim()).ok()?;
        return Some(M3uDirectiveResult {
            channel: Some(Channel {
                header: Some(header),
                ..Default::default()
            }),
            directives: None,
        });
    }

    if line.starts_with("#EXTVLCOPT:http-user-agent=") {
        return Some(M3uDirectiveResult {
            channel: Some(Channel {
                ua: Some(line[27..].trim().to_string()),
                ..Default::default()
            }),
            directives: None,
        });
    }

    if line.starts_with("#EXTVLCOPT:http-referrer=") {
        return Some(M3uDirectiveResult {
            channel: Some(Channel {
                referer: Some(line[25..].trim().to_string()),
                ..Default::default()
            }),
            directives: None,
        });
    }

    if line.starts_with("#EXTVLCOPT:http-origin=") {
        return Some(M3uDirectiveResult {
            channel: Some(Channel {
                origin: Some(line[22..].trim().to_string()),
                ..Default::default()
            }),
            directives: None,
        });
    }

    if line.starts_with("#KODIPROP:") {
        return Some(parse_kodi_prop(&line[10..].trim()));
    }

    if let Some(dirs) = parse_directive(line) {
        return Some(M3uDirectiveResult {
            channel: None,
            directives: Some(dirs),
        });
    }

    None
}

fn parse_kodi_prop(prop: &str) -> M3uDirectiveResult {
    let mut result = M3uDirectiveResult {
        channel: None,
        directives: None,
    };

    if prop.starts_with("inputstream.adaptive.license_type=") {
        let drm_type = prop[34..].trim();
        result.channel = Some(Channel {
            drm: Some(Drm {
                drm_type: drm_type.to_string(),
                key: String::new(),
                header: None,
            }),
            ..Default::default()
        });
    } else if prop.starts_with("inputstream.adaptive.license_key=") {
        let license_key = prop[33..].trim();
        let pipe_idx = license_key.find('|');
        let key = pipe_idx
            .map(|i| &license_key[..i])
            .unwrap_or(license_key)
            .to_string();

        let mut drm = Drm {
            drm_type: String::new(),
            key,
            header: None,
        };
        if let Some(pi) = pipe_idx {
            let header_part = &license_key[pi + 1..];
            let mut header = HashMap::new();
            for pair in header_part.split('&') {
                if let Some(eq_idx) = pair.find('=') {
                    if eq_idx > 0 {
                        header.insert(pair[..eq_idx].to_string(), pair[eq_idx + 1..].to_string());
                    }
                }
            }
            drm.header = Some(header);
        }

        if result.channel.is_some() {
            if let Some(ref mut ch) = result.channel {
                if let Some(ref mut d) = ch.drm {
                    d.key = drm.key.clone();
                    if drm.header.is_some() {
                        d.header = drm.header.clone();
                    }
                }
            }
        } else {
            result.channel = Some(Channel {
                drm: Some(drm),
                ..Default::default()
            });
        }
    } else if prop.starts_with("inputstream.adaptive.drm_legacy=") {
        let legacy = prop[32..].trim();
        let pipe_idx = legacy.find('|');
        if let Some(pi) = pipe_idx {
            result.channel = Some(Channel {
                drm: Some(Drm {
                    drm_type: legacy[..pi].to_string(),
                    key: legacy[pi + 1..].to_string(),
                    header: None,
                }),
                ..Default::default()
            });
        }
    } else if prop.starts_with("inputstream.adaptive.manifest_type=") {
        let manifest_type = map_format(prop[35..].trim());
        result.directives = Some(Directives {
            format: Some(manifest_type),
            ..Default::default()
        });
    } else if prop.starts_with("inputstream.adaptive.stream_headers=")
        || prop.starts_with("inputstream.adaptive.common_headers=")
    {
        let eq_idx = prop.find('=').unwrap_or(0);
        let headers_part = &prop[eq_idx + 1..];
        let mut header = HashMap::new();
        let mut drm_type: Option<String> = None;
        let mut drm_key: Option<String> = None;

        for pair in headers_part.split('&') {
            if let Some(eq) = pair.find('=') {
                if eq > 0 {
                    let k = pair[..eq].to_string();
                    let v = pair[eq + 1..].to_string();
                    match k.as_str() {
                        "drmScheme" => drm_type = Some(v),
                        "drmLicense" => drm_key = Some(v),
                        _ => {
                            header.insert(k, v);
                        }
                    }
                }
            }
        }

        let mut ch = Channel {
            ..Default::default()
        };
        if !header.is_empty() {
            ch.header = Some(header);
        }
        if drm_type.is_some() || drm_key.is_some() {
            ch.drm = Some(Drm {
                drm_type: drm_type.unwrap_or_default(),
                key: drm_key.unwrap_or_default(),
                header: None,
            });
        }
        result.channel = Some(ch);
    }

    result
}

// ==================== 连通性测试 ====================

/// URL 测试结果
#[derive(Debug, Clone, Serialize)]
pub struct TestResult {
    pub url: String,
    pub alive: bool,
    pub latency: i64,
    pub error: Option<String>,
}

const GET_PREFERRED_EXTENSIONS: &[&str] = &["m3u8", "m3u", "mpd", "xml", "json", "txt"];

fn should_prefer_get(url: &str) -> bool {
    let path = url.split('?').next().unwrap_or(url);
    GET_PREFERRED_EXTENSIONS
        .iter()
        .any(|ext| path.ends_with(ext))
}

/// 测试单个 URL 连通性
pub async fn test_url(url: &str, timeout_ms: u64) -> TestResult {
    let start = std::time::Instant::now();
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return TestResult {
                url: url.to_string(),
                alive: false,
                latency: -1,
                error: Some(e.to_string()),
            }
        }
    };

    let method = if should_prefer_get(url) {
        "GET"
    } else {
        "HEAD"
    };

    let result = if method == "GET" {
        client.get(url).send().await
    } else {
        // HEAD first, fallback to GET if 405/501
        match client.head(url).send().await {
            Ok(resp) if resp.status().as_u16() < 400 => Ok(resp),
            Ok(resp) if [405u16, 501].contains(&resp.status().as_u16()) => {
                client.get(url).send().await
            }
            Ok(resp) => Ok(resp),
            Err(e) => Err(e),
        }
    };

    match result {
        Ok(resp) => {
            let latency = start.elapsed().as_millis() as i64;
            let status = resp.status().as_u16();
            TestResult {
                url: url.to_string(),
                alive: status < 400,
                latency,
                error: if status >= 400 {
                    Some(format!("HTTP {}", status))
                } else {
                    None
                },
            }
        }
        Err(e) => TestResult {
            url: url.to_string(),
            alive: false,
            latency: -1,
            error: if e.is_timeout() {
                Some("Timeout".to_string())
            } else if e.is_connect() {
                Some(format!("Connect error: {}", e))
            } else {
                Some(e.to_string())
            },
        },
    }
}

// ==================== 频道去重 ====================

/// 归一化频道名称用于去重比较
pub fn normalize_name(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

/// 去重并选择最优 URL
pub fn dedup_channels(groups: Vec<Group>) -> Vec<Group> {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    groups
        .into_iter()
        .map(|mut group| {
            group.channel = group
                .channel
                .into_iter()
                .filter(|ch| seen.insert(normalize_name(&ch.name)))
                .collect();
            group
        })
        .filter(|g| !g.channel.is_empty())
        .collect()
}

// ==================== 分类器 ====================

/// 国家/地区代码
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Country {
    China,
    Uk,
    Us,
    Japan,
    Korea,
    Other,
}

/// 频道分类
#[derive(Debug, Clone)]
pub struct ClassifiedChannel {
    pub channel: Channel,
    pub country: Country,
    pub category: String,
    pub sort_order: f64,
}

/// 对国家进行排序
fn country_sort_key(country: &Country) -> i32 {
    match country {
        Country::China => 0,
        Country::Uk => 1,
        Country::Us => 2,
        Country::Japan => 3,
        Country::Korea => 4,
        Country::Other => 5,
    }
}

/// 分类频道
pub fn classify_channel(name: &str) -> (Country, String, f64) {
    let lower = name.to_lowercase();

    // 检测中国频道 (CCTV 系列)
    if lower.contains("cctv") || lower.starts_with("cctv") {
        let num: f64 = lower
            .chars()
            .skip_while(|c| !c.is_ascii_digit())
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect::<String>()
            .parse()
            .unwrap_or(99.0);
        return (Country::China, "CCTV".to_string(), num);
    }

    if lower.contains("央视") || lower.contains("中央") {
        return (Country::China, "CCTV".to_string(), 0.0);
    }

    // CCTV 子台 (CCTV-1, CCTV-5 等)
    if lower.starts_with("cctv") || lower.contains("cctv") {
        let num: f64 = lower
            .trim_start_matches("cctv")
            .trim_start_matches('-')
            .trim_start_matches(' ')
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse()
            .unwrap_or(99.0);
        return (Country::China, "CCTV".to_string(), num);
    }

    // 卫视
    if lower.contains("卫视") || lower.contains("卫视") {
        return (Country::China, "卫视".to_string(), 0.0);
    }

    // 地方台
    let local_keywords = [
        "上海",
        "北京",
        "广东",
        "深圳",
        "浙江",
        "江苏",
        "湖南",
        "湖北",
        "四川",
        "山东",
        "福建",
        "天津",
        "重庆",
        "安徽",
        "辽宁",
        "河南",
        "河北",
        "陕西",
        "云南",
        "贵州",
        "广西",
        "江西",
        "山西",
        "吉林",
        "黑龙江",
        "内蒙古",
        "新疆",
        "甘肃",
        "海南",
        "宁夏",
        "青海",
        "西藏",
        "channel",
        "本地",
    ];
    if local_keywords.iter().any(|k| lower.contains(k)) {
        return (Country::China, "地方".to_string(), 0.0);
    }

    // 英国频道
    let uk_keywords = [
        "bbc",
        "itv",
        "channel 4",
        "channel 5",
        "sky news",
        "dave",
        "drama",
        "film4",
        "uktv",
        "british",
    ];
    if uk_keywords.iter().any(|k| lower.contains(k)) || lower.ends_with(".uk") {
        return (Country::Uk, guess_category(&lower).to_string(), 0.0);
    }

    // 美国频道
    let us_keywords = [
        "cnn",
        "fox",
        "nbc",
        "abc",
        "cbs",
        "hbo",
        "discovery",
        "national geographic",
        "history channel",
        "espn",
        "mtv",
        "comedy central",
        "tlc",
        "usa network",
        "pbs",
        "nfl",
        "nba",
        "mlb",
        "nhl",
    ];
    if us_keywords.iter().any(|k| lower.contains(k)) {
        return (Country::Us, guess_category(&lower).to_string(), 0.0);
    }

    // 日本频道
    let jp_keywords = [
        "nhk",
        "tv asahi",
        "fuji tv",
        "tbs",
        "tv tokyo",
        "ntv",
        "japan",
        "東京",
        "テレビ",
    ];
    if jp_keywords.iter().any(|k| lower.contains(k)) {
        return (Country::Japan, guess_category(&lower).to_string(), 0.0);
    }

    // 韩国频道
    let kr_keywords = ["kbs", "mbc", "sbs", "jtbc", "tvn", "korea", "한국"];
    if kr_keywords.iter().any(|k| lower.contains(k)) {
        return (Country::Korea, guess_category(&lower).to_string(), 0.0);
    }

    (Country::Other, guess_category(&lower).to_string(), 0.0)
}

fn guess_category(name: &str) -> &str {
    let lower = name.to_lowercase();
    let categories: &[(&[&str], &str)] = &[
        (
            &[
                "news", "bbc", "cnn", "nbc", "abc", "cbs", "pbs", "itv", "sky", "新闻", "報導",
            ],
            "News",
        ),
        (
            &[
                "sport", "espn", "nfl", "nba", "mlb", "nhl", "体育", "運動", "赛事",
            ],
            "Sports",
        ),
        (&["movie", "film", "hbo", "电影", "影院", "影视"], "Movies"),
        (&["music", "mtv", "音乐", "音樂", "mv"], "Music"),
        (
            &[
                "kids", "children", "disney", "cartoon", "儿童", "卡通", "少儿",
            ],
            "Kids",
        ),
        (
            &[
                "document",
                "discovery",
                "national geographic",
                "history",
                "纪录片",
                "纪实",
            ],
            "Documentary",
        ),
        (&["drama", "剧集", "电视剧", "连续剧"], "Drama"),
        (&["entertain", "综艺", "娱乐", "真人秀"], "Entertainment"),
        (&["education", "学习", "教育", "教学"], "Education"),
        (&["food", "cooking", "美食", "烹饪"], "Food"),
        (&["travel", "旅游", "旅行"], "Travel"),
        (&["tech", "technology", "科技", "数码"], "Technology"),
    ];

    for (keywords, category) in categories {
        if keywords.iter().any(|k| lower.contains(k)) {
            return category;
        }
    }

    "General"
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==================== TXT 解析 ====================

    #[test]
    fn parses_txt_with_groups() {
        let input = "CCTV,#genre#\nCCTV-1,http://example.com/1.m3u8\nCCTV-2,http://example.com/2.m3u8\n卫视,#genre#\n湖南卫视,http://example.com/hn.m3u8";
        let groups = parse_txt_format(input);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].name, "CCTV");
        assert_eq!(groups[0].channel.len(), 2);
        assert_eq!(groups[1].name, "卫视");
        assert_eq!(groups[1].channel.len(), 1);
    }

    #[test]
    fn parses_txt_with_password() {
        let input = "香港,#genre#_secret\nTVB,http://example.com/tvb.m3u8";
        let groups = parse_txt_format(input);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].name, "香港");
        assert_eq!(groups[0].pass.as_deref(), Some("secret"));
    }

    #[test]
    fn parses_txt_with_directives() {
        let input = "CCTV,#genre#\nua=Mozilla/5.0\nreferer=http://example.com\nCCTV-1,http://example.com/1.m3u8";
        let groups = parse_txt_format(input);
        let ch = &groups[0].channel[0];
        assert_eq!(ch.ua.as_deref(), Some("Mozilla/5.0"));
        assert_eq!(ch.referer.as_deref(), Some("http://example.com"));
    }

    #[test]
    fn parses_txt_inline_headers() {
        let input = "CCTV,#genre#\nCCTV-1,http://example.com/1.m3u8|referer=http://example.com|user-agent=Mozilla/5.0";
        let groups = parse_txt_format(input);
        let ch = &groups[0].channel[0];
        assert_eq!(ch.urls.len(), 1);
        assert!(ch.header.is_some());
    }

    #[test]
    fn parses_txt_multi_url() {
        let input = "CCTV,#genre#\nCCTV-1,http://example.com/1.m3u8#http://backup.com/1.m3u8";
        let groups = parse_txt_format(input);
        assert_eq!(groups[0].channel[0].urls.len(), 2);
    }

    // ==================== M3U 解析 ====================

    #[test]
    fn parses_m3u_basic() {
        let input = "#EXTM3U\n#EXTINF:-1 tvg-id=\"cctv1\" group-title=\"央视\",CCTV-1\nhttp://example.com/1.m3u8\n#EXTINF:-1 group-title=\"央视\",CCTV-2\nhttp://example.com/2.m3u8";
        let groups = parse_m3u_format(input);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].name, "央视");
        assert_eq!(groups[0].channel.len(), 2);
        assert_eq!(groups[0].channel[0].tvg_id.as_deref(), Some("cctv1"));
    }

    #[test]
    fn parses_m3u_kodiprop_drm() {
        // 使用 drm_legacy 格式在一行中同时设置 type 和 key
        let input = "#EXTM3U\n#EXTINF:-1,CCTV-1\n#KODIPROP:inputstream.adaptive.drm_legacy=com.widevine.alpha|http://lic.example.com/key\nhttp://example.com/1.m3u8";
        let groups = parse_m3u_format(input);
        let ch = &groups[0].channel[0];
        assert!(ch.drm.is_some(), "DRM should be present");
        let drm = ch.drm.as_ref().unwrap();
        assert_eq!(drm.drm_type, "com.widevine.alpha");
        assert_eq!(drm.key, "http://lic.example.com/key");
    }

    #[test]
    fn parses_m3u_extvlcopt() {
        let input = "#EXTM3U\n#EXTINF:-1,CCTV-1\n#EXTVLCOPT:http-user-agent=Mozilla/5.0\nhttp://example.com/1.m3u8";
        let groups = parse_m3u_format(input);
        assert_eq!(groups[0].channel[0].ua.as_deref(), Some("Mozilla/5.0"));
    }

    // ==================== JSON 解析 ====================

    #[test]
    fn parses_json_basic() {
        let input = r#"[
          {"name":"央视","channel":[
            {"name":"CCTV-1","urls":["http://example.com/1.m3u8"]}
          ]}
        ]"#;
        let groups = parse_json_format(input);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].channel[0].name, "CCTV-1");
    }

    #[test]
    fn parses_json_invalid_returns_empty() {
        let groups = parse_json_format("not json");
        assert!(groups.is_empty());
    }

    // ==================== 自动检测 ====================

    #[test]
    fn auto_detects_txt() {
        let input = "CCTV,#genre#\nCCTV-1,http://example.com/1.m3u8";
        let groups = parse_live_content(input);
        assert_eq!(groups.len(), 1);
    }

    #[test]
    fn auto_detects_m3u() {
        let input = "#EXTM3U\n#EXTINF:-1,CCTV-1\nhttp://example.com/1.m3u8";
        let groups = parse_live_content(input);
        assert_eq!(groups.len(), 1);
    }

    #[test]
    fn auto_detects_json() {
        let input = r#"[{"name":"G","channel":[{"name":"C","urls":["http://e.com"]}]}]"#;
        let groups = parse_live_content(input);
        assert_eq!(groups.len(), 1);
    }

    // ==================== URL 测试 ====================

    #[tokio::test]
    async fn test_url_rejects_bad_url() {
        let result = test_url("not a url", 5000).await;
        assert!(!result.alive);
    }

    // ==================== 去重 ====================

    #[test]
    fn dedup_normalizes_names() {
        let n1 = normalize_name("CCTV-1");
        let n2 = normalize_name("cctv1");
        assert_eq!(n1, n2, "normalized '{}' != '{}'", n1, n2);
    }

    #[test]
    fn dedup_removes_duplicates() {
        let groups = vec![Group {
            name: "CCTV".to_string(),
            pass: None,
            channel: vec![
                Channel {
                    name: "CCTV-1".to_string(),
                    urls: vec!["http://a.com".to_string()],
                    ..Default::default()
                },
                Channel {
                    name: "cctv 1".to_string(),
                    urls: vec!["http://b.com".to_string()],
                    ..Default::default()
                },
            ],
        }];
        let result = dedup_channels(groups);
        assert_eq!(result[0].channel.len(), 1);
    }

    // ==================== 分类器 ====================

    #[test]
    fn classifies_cctv() {
        let (country, category, order) = classify_channel("CCTV-1");
        assert_eq!(country, Country::China);
        assert_eq!(category, "CCTV");
        assert_eq!(order, 1.0);
    }

    #[test]
    fn classifies_bbc() {
        let (country, _, _) = classify_channel("BBC World News");
        assert_eq!(country, Country::Uk);
    }

    #[test]
    fn classifies_cnn() {
        let (country, _, _) = classify_channel("CNN International");
        assert_eq!(country, Country::Us);
    }

    #[test]
    fn classifies_nhk() {
        let (country, _, _) = classify_channel("NHK World");
        assert_eq!(country, Country::Japan);
    }

    #[test]
    fn classifies_kbs() {
        let (country, _, _) = classify_channel("KBS World");
        assert_eq!(country, Country::Korea);
    }

    #[test]
    fn classifies_chinese_local() {
        let (country, _, _) = classify_channel("湖南卫视");
        assert_eq!(country, Country::China);
    }
}
