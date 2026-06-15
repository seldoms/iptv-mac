use std::collections::HashMap;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::AppError;

type HttpResult<T> = std::result::Result<T, AppError>;

// ==================== 类型定义 ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VodClass {
    pub type_id: String,
    pub type_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterValue {
    pub n: String,
    pub v: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Filter {
    pub key: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub init: Option<String>,
    pub value: Vec<FilterValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vod {
    pub vod_id: String,
    pub vod_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vod_pic: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vod_remarks: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub type_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vod_year: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vod_area: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vod_director: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vod_actor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vod_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vod_play_from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vod_play_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vod_tag: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiderResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub class: Option<Vec<VodClass>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filters: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list: Option<Vec<Vod>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pagecount: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerResult {
    pub url: String,
    pub parse: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "playUrl")]
    pub play_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub click: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header: Option<Value>,
}

/// 站点配置
#[derive(Debug, Clone)]
pub struct SiteConfig {
    pub key: String,
    pub name: String,
    pub site_type: i64,
    pub api: String,
    pub ext: Option<Value>,
    pub play_url: Option<String>,
    pub click: Option<String>,
    pub header: Option<Value>,
    pub timeout: Option<i64>,
}

// ==================== HttpSpider ====================

/// HTTP API Spider for type 0/1/4
pub struct HttpSpider {
    site: SiteConfig,
    api_url: String,
    site_type: i64,
}

impl HttpSpider {
    pub fn new(site: SiteConfig) -> Self {
        let api_url = site.api.clone();
        Self {
            api_url,
            site_type: site.site_type,
            site,
        }
    }

    async fn fetch_json(&self, url: &str) -> HttpResult<Value> {
        let client = crate::network::create_client()?;
        let timeout = self.site.timeout.unwrap_or(15) as u64;
        let mut req = client
            .get(url)
            .timeout(std::time::Duration::from_secs(timeout));
        if let Some(header) = &self.site.header {
            if let Some(obj) = header.as_object() {
                for (k, v) in obj {
                    if let Some(val) = v.as_str() {
                        req = req.header(k.as_str(), val);
                    }
                }
            }
        }
        let resp = req.send().await.map_err(|e| {
            AppError::network_error(format!("API 请求失败 [{}]: {}", self.site.key, e))
        })?;
        let text = resp
            .text()
            .await
            .map_err(|e| AppError::network_error(format!("读取响应失败: {}", e)))?;
        serde_json::from_str(&text)
            .map_err(|e| AppError::parse_error(format!("API 返回非 JSON: {}", e)))
    }

    async fn fetch_xml(&self, url: &str) -> HttpResult<Value> {
        let client = crate::network::create_client()?;
        let timeout = self.site.timeout.unwrap_or(15) as u64;
        let mut req = client
            .get(url)
            .timeout(std::time::Duration::from_secs(timeout));
        if let Some(header) = &self.site.header {
            if let Some(obj) = header.as_object() {
                for (k, v) in obj {
                    if let Some(val) = v.as_str() {
                        req = req.header(k.as_str(), val);
                    }
                }
            }
        }
        let resp = req.send().await.map_err(|e| {
            AppError::network_error(format!("XML API 请求失败 [{}]: {}", self.site.key, e))
        })?;
        let text = resp
            .text()
            .await
            .map_err(|e| AppError::network_error(format!("读取 XML 失败: {}", e)))?;
        parse_xml_api_response(&text)
    }

    fn build_url(&self, params: &HashMap<String, String>) -> String {
        let api_url = &self.api_url;
        let mut existing = HashMap::new();
        let base_url = if let Some(q_idx) = api_url.find('?') {
            let qs = &api_url[q_idx + 1..];
            for pair in qs.split('&') {
                if let Some(eq_idx) = pair.find('=') {
                    if eq_idx > 0 {
                        let k = urlencoding::decode(&pair[..eq_idx])
                            .unwrap_or_default()
                            .into_owned();
                        let v = urlencoding::decode(&pair[eq_idx + 1..])
                            .unwrap_or_default()
                            .into_owned();
                        existing.insert(k, v);
                    }
                }
            }
            api_url[..q_idx].to_string()
        } else {
            api_url.clone()
        };

        let merged: Vec<String> = existing
            .into_iter()
            .chain(params.clone())
            .map(|(k, v)| format!("{}={}", urlencoding::encode(&k), urlencoding::encode(&v)))
            .collect();
        format!("{}?{}", base_url, merged.join("&"))
    }

    fn parse_vod_item(item: &Value) -> Vod {
        Vod {
            vod_id: value_to_string(item.get("vod_id")).unwrap_or_default(),
            vod_name: item
                .get("vod_name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            vod_pic: item
                .get("vod_pic")
                .and_then(Value::as_str)
                .map(String::from),
            vod_remarks: item
                .get("vod_remarks")
                .and_then(Value::as_str)
                .map(String::from),
            type_name: item
                .get("type_name")
                .and_then(Value::as_str)
                .map(String::from),
            vod_year: item
                .get("vod_year")
                .and_then(Value::as_str)
                .map(String::from),
            vod_area: item
                .get("vod_area")
                .and_then(Value::as_str)
                .map(String::from),
            vod_director: item
                .get("vod_director")
                .and_then(Value::as_str)
                .map(String::from),
            vod_actor: item
                .get("vod_actor")
                .and_then(Value::as_str)
                .map(String::from),
            vod_content: item
                .get("vod_content")
                .and_then(Value::as_str)
                .map(String::from),
            vod_play_from: item
                .get("vod_play_from")
                .and_then(Value::as_str)
                .map(String::from),
            vod_play_url: item
                .get("vod_play_url")
                .and_then(Value::as_str)
                .map(String::from),
            vod_tag: item
                .get("vod_tag")
                .and_then(Value::as_str)
                .map(String::from),
        }
    }

    fn parse_json_vod_list(data: &Value) -> Vec<Vod> {
        let list = data.get("list").and_then(Value::as_array);
        match list {
            Some(arr) => arr.iter().map(Self::parse_vod_item).collect(),
            None => vec![],
        }
    }

    fn parse_xml_vod_list(data: &Value) -> Vec<Vod> {
        let list = data.get("list");
        let video = list.and_then(|l| l.get("video"));
        let items = match video {
            Some(Value::Array(arr)) => arr.clone(),
            Some(v) => vec![v.clone()],
            None => vec![],
        };
        items
            .iter()
            .map(|item| {
                // XML parsed by quick-xml may have different structure, be flexible
                let vod_id = item
                    .get("vod_id")
                    .or_else(|| item.get("id"))
                    .and_then(|v| value_to_string(Some(v)))
                    .unwrap_or_default();
                let vod_name = item
                    .get("vod_name")
                    .or_else(|| item.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                Vod {
                    vod_id,
                    vod_name,
                    vod_pic: item
                        .get("vod_pic")
                        .or_else(|| item.get("pic"))
                        .and_then(Value::as_str)
                        .map(String::from),
                    vod_remarks: item
                        .get("vod_remarks")
                        .or_else(|| item.get("remarks"))
                        .and_then(Value::as_str)
                        .map(String::from),
                    type_name: item
                        .get("type_name")
                        .or_else(|| item.get("type"))
                        .and_then(Value::as_str)
                        .map(String::from),
                    vod_year: item
                        .get("vod_year")
                        .and_then(Value::as_str)
                        .map(String::from),
                    vod_area: item
                        .get("vod_area")
                        .and_then(Value::as_str)
                        .map(String::from),
                    vod_director: item
                        .get("vod_director")
                        .and_then(Value::as_str)
                        .map(String::from),
                    vod_actor: item
                        .get("vod_actor")
                        .and_then(Value::as_str)
                        .map(String::from),
                    vod_content: item
                        .get("vod_content")
                        .and_then(Value::as_str)
                        .map(String::from),
                    vod_play_from: item
                        .get("vod_play_from")
                        .and_then(Value::as_str)
                        .map(String::from),
                    vod_play_url: item
                        .get("vod_play_url")
                        .and_then(Value::as_str)
                        .map(String::from),
                    vod_tag: item
                        .get("vod_tag")
                        .and_then(Value::as_str)
                        .map(String::from),
                }
            })
            .collect()
    }

    pub async fn home_content(&self, filter: bool) -> HttpResult<SpiderResult> {
        match self.site_type {
            0 => self.home_content_xml(filter).await,
            _ => self.home_content_json(filter).await,
        }
    }

    async fn home_content_json(&self, _filter: bool) -> HttpResult<SpiderResult> {
        let url = self.build_url(&HashMap::from([("ac".to_string(), "detail".to_string())]));
        let data = self.fetch_json(&url).await?;

        let mut classes: Vec<VodClass> = data
            .get("class")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .map(|c| VodClass {
                        type_id: value_to_string(c.get("type_id").or_else(|| c.get("id")))
                            .unwrap_or_default(),
                        type_name: c
                            .get("type_name")
                            .or_else(|| c.get("name"))
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();

        let list = Self::parse_json_vod_list(&data);

        // If no classes but we have list items, try to infer from list
        if classes.is_empty() && !list.is_empty() {
            let mut seen = HashMap::new();
            for vod in &list {
                if let Some(ref tn) = vod.type_name {
                    let tid = vod.vod_id.split('_').next().unwrap_or("");
                    if !tid.is_empty() && !seen.contains_key(tid) {
                        seen.insert(tid.to_string(), tn.clone());
                    }
                }
            }
            classes = seen
                .into_iter()
                .map(|(type_id, type_name)| VodClass { type_id, type_name })
                .collect();
        }

        let filters: Option<Value> = _filter.then(|| data.get("filters").cloned()).flatten();

        Ok(SpiderResult {
            class: Some(classes),
            filters,
            list: Some(list),
            pagecount: None,
        })
    }

    async fn home_content_xml(&self, _filter: bool) -> HttpResult<SpiderResult> {
        let url = self.build_url(&HashMap::from([(
            "ac".to_string(),
            "videolist".to_string(),
        )]));
        let data = self.fetch_xml(&url).await?;

        let classes: Vec<VodClass> = data
            .get("class")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .map(|c| VodClass {
                        type_id: value_to_string(c.get("type_id").or_else(|| c.get("id")))
                            .unwrap_or_default(),
                        type_name: c
                            .get("type_name")
                            .or_else(|| c.get("name"))
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();

        let list = Self::parse_xml_vod_list(&data);
        Ok(SpiderResult {
            class: Some(classes),
            filters: None,
            list: Some(list),
            pagecount: None,
        })
    }

    pub async fn category_content(
        &self,
        tid: &str,
        pg: &str,
        filter: bool,
        extend: &HashMap<String, String>,
    ) -> HttpResult<SpiderResult> {
        let mut params = HashMap::new();
        match self.site_type {
            0 => {
                params.insert("ac".to_string(), "videolist".to_string());
                params.insert("t".to_string(), tid.to_string());
                params.insert("pg".to_string(), pg.to_string());
                let data = self.fetch_xml(&self.build_url(&params)).await?;
                let list = Self::parse_xml_vod_list(&data);
                let pagecount = data.get("pagecount").and_then(Value::as_i64);
                Ok(SpiderResult {
                    class: None,
                    filters: None,
                    list: Some(list),
                    pagecount,
                })
            }
            _ => {
                params.insert("ac".to_string(), "detail".to_string());
                params.insert("t".to_string(), tid.to_string());
                params.insert("pg".to_string(), pg.to_string());

                if filter && !extend.is_empty() {
                    params.insert(
                        "f".to_string(),
                        serde_json::to_string(extend).unwrap_or_default(),
                    );
                }
                let data = self.fetch_json(&self.build_url(&params)).await?;
                let list = Self::parse_json_vod_list(&data);
                let pagecount = data.get("pagecount").and_then(Value::as_i64);
                Ok(SpiderResult {
                    class: None,
                    filters: None,
                    list: Some(list),
                    pagecount,
                })
            }
        }
    }

    pub async fn detail_content(&self, ids: &[String]) -> HttpResult<SpiderResult> {
        let mut params = HashMap::new();
        let ids_str = ids.join(",");
        match self.site_type {
            0 => {
                params.insert("ac".to_string(), "videolist".to_string());
                params.insert("ids".to_string(), ids_str);
                let data = self.fetch_xml(&self.build_url(&params)).await?;
                Ok(SpiderResult {
                    class: None,
                    filters: None,
                    list: Some(Self::parse_xml_vod_list(&data)),
                    pagecount: None,
                })
            }
            _ => {
                params.insert("ac".to_string(), "detail".to_string());
                params.insert("ids".to_string(), ids_str);
                let data = self.fetch_json(&self.build_url(&params)).await?;
                Ok(SpiderResult {
                    class: None,
                    filters: None,
                    list: Some(Self::parse_json_vod_list(&data)),
                    pagecount: None,
                })
            }
        }
    }

    pub async fn search_content(
        &self,
        keyword: &str,
        _quick: bool,
        pg: Option<&str>,
    ) -> HttpResult<SpiderResult> {
        let mut params = HashMap::new();
        match self.site_type {
            0 => {
                params.insert("ac".to_string(), "videolist".to_string());
                params.insert("wd".to_string(), keyword.to_string());
                if let Some(p) = pg {
                    params.insert("pg".to_string(), p.to_string());
                }
                let data = self.fetch_xml(&self.build_url(&params)).await?;
                Ok(SpiderResult {
                    class: None,
                    filters: None,
                    list: Some(Self::parse_xml_vod_list(&data)),
                    pagecount: None,
                })
            }
            _ => {
                params.insert("ac".to_string(), "detail".to_string());
                params.insert("wd".to_string(), keyword.to_string());
                if let Some(p) = pg {
                    params.insert("pg".to_string(), p.to_string());
                }
                let data = self.fetch_json(&self.build_url(&params)).await?;
                Ok(SpiderResult {
                    class: None,
                    filters: None,
                    list: Some(Self::parse_json_vod_list(&data)),
                    pagecount: None,
                })
            }
        }
    }

    pub async fn player_content(
        &self,
        _flag: &str,
        id: &str,
        _vip_flags: &[String],
    ) -> HttpResult<PlayerResult> {
        let is_direct = is_video_format(id);
        let has_play_url = self.site.play_url.is_some();
        Ok(PlayerResult {
            url: id.to_string(),
            parse: if is_direct && !has_play_url { 0 } else { 1 },
            play_url: self.site.play_url.clone(),
            click: self.site.click.clone(),
            header: self.site.header.clone(),
        })
    }
}

fn value_to_string(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

/// 检测是否为可直接播放的视频格式
pub fn is_video_format(url: &str) -> bool {
    if url.is_empty() || url.starts_with("data:") || url.starts_with("blob:") {
        return false;
    }
    let re = Regex::new(r"(?i)https?://[^\s]{12,}\.(?:m3u8|m3u|mp4|flv|hlv|f4v|mkv|avi|wmv|mov|webm|ts|m4s|mpd|aac|mp3|m4a)(?:\?.*)?$").unwrap();
    if re.is_match(url) {
        return true;
    }
    if url.contains("video/tos") {
        return true;
    }
    if url.starts_with("rtmp:") {
        return true;
    }
    false
}

/// 是否需要解析
pub fn need_parse(url: &str, play_url: Option<&str>) -> bool {
    if is_video_format(url) && play_url.is_none() {
        return false;
    }
    true
}

// ==================== XML API 解析 ====================

/// 解析 XML API 响应
fn parse_xml_api_response(xml: &str) -> HttpResult<Value> {
    // Simple XML to JSON conversion using recursive approach
    // Only handles the TV API XML format (no backreferences needed)
    let xml = xml.trim();
    if xml.is_empty() {
        return Ok(Value::Object(serde_json::Map::new()));
    }

    // Extract content within rss tag or use whole document
    let content = if let Some(start) = xml.find("<rss") {
        if let Some(end) = xml.rfind("</rss>") {
            let inner_start = xml[start..]
                .find('>')
                .map(|i| start + i + 1)
                .unwrap_or(start);
            &xml[inner_start..end]
        } else {
            xml
        }
    } else {
        xml
    };

    Ok(parse_xml_elements(content))
}

fn parse_xml_elements(xml: &str) -> Value {
    let xml = xml.trim();
    if xml.is_empty() {
        return Value::Null;
    }

    let mut map = serde_json::Map::new();
    let mut pos = 0;
    let bytes = xml.as_bytes();

    while pos < xml.len() {
        // Find next <tag>
        let tag_start = match xml[pos..].find('<') {
            Some(i) => pos + i,
            None => break,
        };

        // Skip comments and processing instructions
        if tag_start + 1 < xml.len()
            && (bytes[tag_start + 1] == b'?' || bytes[tag_start + 1] == b'!')
        {
            let close = if bytes[tag_start + 1] == b'?' {
                b'?'
            } else {
                b'>'
            };
            let end_tag = match xml[tag_start..].find(close as char) {
                Some(i) => tag_start + i + 1,
                None => break,
            };
            let end_close = xml[end_tag..]
                .find('>')
                .map(|i| end_tag + i + 1)
                .unwrap_or(xml.len());
            pos = end_close;
            continue;
        }

        // Skip self-closing tags
        if tag_start + 1 < xml.len() && bytes[tag_start + 1] == b'/' {
            let end = xml[tag_start..]
                .find('>')
                .map(|i| tag_start + i + 1)
                .unwrap_or(xml.len());
            pos = end;
            continue;
        }

        // Extract tag name
        let tag_end = xml[tag_start..]
            .find(|c: char| c.is_whitespace() || c == '>' || c == '/')
            .map(|i| tag_start + i)
            .unwrap_or(xml.len());

        let tag_name = &xml[tag_start + 1..tag_end];

        // Find end of opening tag
        let open_end = match xml[tag_start..].find('>') {
            Some(i) => tag_start + i + 1,
            None => break,
        };

        // Check if self-closing
        if open_end > 1 && bytes[open_end - 2] == b'/' {
            pos = open_end;
            add_to_map(&mut map, tag_name, Value::Null);
            continue;
        }

        // Find closing tag
        let close_tag = format!("</{}>", tag_name);
        let close_start = match xml[open_end..].find(&close_tag) {
            Some(i) => open_end + i,
            None => {
                pos = open_end;
                continue;
            }
        };

        let inner = &xml[open_end..close_start];
        let child = parse_xml_elements(inner);

        // Check if inner text is just whitespace (no tags)
        let inner_trimmed = inner.trim();
        let is_leaf = !inner_trimmed.contains('<') && !inner_trimmed.contains('>');

        let value = if is_leaf && !inner_trimmed.is_empty() {
            Value::String(inner_trimmed.to_string())
        } else if child.is_object()
            && child.as_object().map(|m| m.is_empty()).unwrap_or(true)
            && !inner_trimmed.is_empty()
        {
            Value::String(inner_trimmed.to_string())
        } else {
            child
        };

        add_to_map(&mut map, tag_name, value);
        pos = close_start + close_tag.len();
    }

    Value::Object(map)
}

fn add_to_map(map: &mut serde_json::Map<String, Value>, key: &str, value: Value) {
    match map.get_mut(key) {
        Some(Value::Array(ref mut arr)) => arr.push(value),
        Some(existing) => {
            let old = std::mem::replace(existing, Value::Array(vec![]));
            if let Value::Array(ref mut arr) = existing {
                arr.push(old);
                arr.push(value);
            }
        }
        None => {
            map.insert(key.to_string(), value);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_video_formats() {
        assert!(is_video_format("https://example.com/video.m3u8"));
        assert!(is_video_format("https://example.com/video.mp4?token=abc"));
        assert!(is_video_format("https://example.com/stream.m3u8?t=123"));
        assert!(!is_video_format("https://example.com/page.html"));
        assert!(!is_video_format(""));
    }

    #[test]
    fn need_parse_returns_false_for_direct_video() {
        assert!(!need_parse("https://example.com/v.mp4", None));
        assert!(need_parse("https://example.com/page.html", None));
        // With playUrl, needs parse even for direct video URLs
        assert!(need_parse(
            "https://example.com/v.mp4",
            Some("https://example.com/play.php")
        ));
    }

    #[test]
    fn parses_xml_api() {
        let xml = r#"<?xml version="1.0"?>
<rss>
  <list>
    <video>
      <vod_id>1</vod_id>
      <vod_name>Test Movie</vod_name>
      <vod_pic>http://example.com/pic.jpg</vod_pic>
    </video>
  </list>
</rss>"#;
        let result = parse_xml_api_response(xml).unwrap();
        let list = result.get("list").and_then(|v| v.as_object());
        assert!(list.is_some(), "Should have 'list' key");
        let video = list
            .and_then(|m| m.get("video"))
            .and_then(|v| v.as_object());
        assert!(video.is_some(), "Should have 'video' key");
        assert_eq!(
            video.and_then(|m| m.get("vod_id")).and_then(Value::as_str),
            Some("1")
        );
        assert_eq!(
            video
                .and_then(|m| m.get("vod_name"))
                .and_then(Value::as_str),
            Some("Test Movie")
        );
    }

    #[test]
    fn parses_numeric_json_ids_as_strings() {
        let data = serde_json::json!({
            "class": [{ "type_id": 22, "type_name": "动漫" }],
            "list": [{ "vod_id": 75220, "vod_name": "Test Movie" }]
        });
        let list = HttpSpider::parse_json_vod_list(&data);
        assert_eq!(list[0].vod_id, "75220");
        assert_eq!(
            value_to_string(data["class"][0].get("type_id")),
            Some("22".to_string())
        );
    }

    #[test]
    fn build_url_merges_params() {
        let spider = HttpSpider::new(SiteConfig {
            key: "test".to_string(),
            name: "Test".to_string(),
            site_type: 1,
            api: "https://api.example.com/api.php".to_string(),
            ext: None,
            play_url: None,
            click: None,
            header: None,
            timeout: None,
        });
        let url = spider.build_url(&HashMap::from([
            ("ac".to_string(), "detail".to_string()),
            ("wd".to_string(), "test".to_string()),
        ]));
        assert!(url.contains("ac=detail"));
        assert!(url.contains("wd=test"));
        assert!(url.starts_with("https://api.example.com/api.php?"));
    }

    #[test]
    fn build_url_preserves_existing_params() {
        let spider = HttpSpider::new(SiteConfig {
            key: "test".to_string(),
            name: "Test".to_string(),
            site_type: 1,
            api: "https://api.example.com/api.php?existing=1".to_string(),
            ext: None,
            play_url: None,
            click: None,
            header: None,
            timeout: None,
        });
        let url = spider.build_url(&HashMap::from([("ac".to_string(), "detail".to_string())]));
        assert!(url.contains("existing=1"));
        assert!(url.contains("ac=detail"));
    }
}
