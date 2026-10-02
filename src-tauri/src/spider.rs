use std::collections::HashMap;
use std::sync::LazyLock;

use quick_xml::events::Event;
use quick_xml::Reader;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::AppError;

type HttpResult<T> = std::result::Result<T, AppError>;

// ==================== 正则编译缓存 ====================

static RE_VIDEO_URL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\.(?:m3u8|m3u|mp4|flv|hlv|f4v|mkv|avi|wmv|mov|webm|ts|m4s|mpd|aac|mp3|m4a)$")
        .unwrap()
});

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
    #[serde(default)]
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

fn extract_html_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    if let Some(start) = lower.find("<title") {
        if let Some(tag_end) = lower[start..].find('>') {
            let title_start = start + tag_end + 1;
            if let Some(end) = lower[title_start..].find("</title>") {
                let t = html[title_start..title_start + end].trim();
                if !t.is_empty() {
                    return Some(t.to_string());
                }
            }
        }
    }
    None
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
        let timeout = self.site.timeout.unwrap_or(8).clamp(3, 15) as u64;
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
            if e.is_timeout() {
                AppError::timeout(format!("站点 [{}] 请求超时 ({}s)", self.site.name, timeout))
            } else if e.is_connect() {
                AppError::network_error(format!("无法连接到站点 [{}]", self.site.name))
            } else {
                AppError::network_error(format!("API 请求失败 [{}]: {}", self.site.name, e))
            }
        })?;

        let status = resp.status();
        if !status.is_success() {
            return Err(AppError::network_error(format!(
                "站点服务异常 (HTTP {}): 接口响应错误",
                status.as_u16()
            )));
        }

        let text = resp
            .text()
            .await
            .map_err(|e| AppError::network_error(format!("读取响应失败: {}", e)))?;


        let trimmed = text.trim();
        if trimmed.starts_with("<!DOCTYPE")
            || trimmed.starts_with("<!doctype")
            || trimmed.starts_with("<html")
            || trimmed.starts_with("<head")
        {
            let title = extract_html_title(trimmed);
            let reason = if let Some(t) = title {
                format!("站点已暂停或维护（网页标题: {}）", t)
            } else {
                "站点返回了网页内容而非数据接口，该站点可能已下线或不可用".to_string()
            };
            return Err(AppError::parse_error(reason));
        }

        crate::network::safe_json_parse(trimmed).map_err(|e| {
            let msg = e.message;
            if msg.contains("expected value") || msg.contains("EOF while parsing") {
                AppError::parse_error("站点返回了非 JSON 内容，暂无法解析")
            } else {
                AppError::parse_error(format!("站点数据解析失败: {}", msg))
            }
        })
    }

    async fn fetch_xml(&self, url: &str) -> HttpResult<Value> {
        let client = crate::network::create_client()?;
        let timeout = self.site.timeout.unwrap_or(8).clamp(3, 15) as u64;
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
            if e.is_timeout() {
                AppError::timeout(format!("站点 [{}] XML 请求超时 ({}s)", self.site.name, timeout))
            } else if e.is_connect() {
                AppError::network_error(format!("无法连接到站点 [{}]", self.site.name))
            } else {
                AppError::network_error(format!("XML API 请求失败 [{}]: {}", self.site.name, e))
            }
        })?;

        let status = resp.status();
        if !status.is_success() {
            return Err(AppError::network_error(format!(
                "站点服务异常 (HTTP {}): XML 接口响应错误",
                status.as_u16()
            )));
        }

        let text = resp
            .text()
            .await
            .map_err(|e| AppError::network_error(format!("读取 XML 失败: {}", e)))?;


        let trimmed = text.trim();
        if trimmed.starts_with("<!DOCTYPE")
            || trimmed.starts_with("<!doctype")
            || trimmed.starts_with("<html")
            || trimmed.starts_with("<head")
        {
            let title = extract_html_title(trimmed);
            let reason = if let Some(t) = title {
                format!("站点已暂停或维护（网页标题: {}）", t)
            } else {
                "站点返回了网页内容而非 XML 接口，该站点可能已下线或不可用".to_string()
            };
            return Err(AppError::parse_error(reason));
        }

        parse_xml_api_response(trimmed)
    }

    fn build_url(&self, params: &HashMap<String, String>) -> String {
        let Ok(mut url) = url::Url::parse(&self.api_url) else {
            return self.api_url.clone();
        };
        let mut merged: HashMap<String, String> = url.query_pairs().into_owned().collect();
        if self.site_type == 4 {
            if let Some(ext) = &self.site.ext {
                merged.insert(
                    "extend".into(),
                    ext.as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| ext.to_string()),
                );
            }
        }
        merged.extend(params.clone());
        url.query_pairs_mut().clear().extend_pairs(merged);
        url.to_string()
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
                let lines = match item.pointer("/dl/dd") {
                    Some(Value::Array(items)) => items.iter().collect::<Vec<_>>(),
                    Some(item) => vec![item],
                    None => vec![],
                };
                let lines: Vec<(&str, &str)> = lines
                    .iter()
                    .filter_map(|line| {
                        let value = line
                            .as_str()
                            .or_else(|| line.get("#text").and_then(Value::as_str))?;
                        Some((
                            line.get("flag").and_then(Value::as_str).unwrap_or("默认"),
                            value,
                        ))
                    })
                    .collect();
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
                        .map(String::from)
                        .or_else(|| {
                            (!lines.is_empty()).then(|| {
                                lines
                                    .iter()
                                    .map(|(flag, _)| *flag)
                                    .collect::<Vec<_>>()
                                    .join("$$$")
                            })
                        }),
                    vod_play_url: item
                        .get("vod_play_url")
                        .and_then(Value::as_str)
                        .map(String::from)
                        .or_else(|| {
                            (!lines.is_empty()).then(|| {
                                lines
                                    .iter()
                                    .map(|(_, value)| *value)
                                    .collect::<Vec<_>>()
                                    .join("$$$")
                            })
                        }),
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

    async fn home_content_json(&self, filter: bool) -> HttpResult<SpiderResult> {
        let params = if self.site_type == 4 {
            HashMap::from([("filter".into(), filter.to_string())])
        } else {
            HashMap::from([("ac".into(), "detail".into())])
        };
        let url = self.build_url(&params);
        let data = self.fetch_json(&url).await?;

        let mut classes = parse_classes(&data);

        // MacCMS 的 ac=detail 不返回 class（且该响应体积很大）；补一次体积很小的 ac=list
        // 取完整分类表（含 type_pid 层级），比从首页 20 条里推断准确得多。
        if classes.is_empty() && self.site_type != 4 {
            let class_url = self.build_url(&HashMap::from([("ac".into(), "list".into())]));
            if let Ok(class_data) = self.fetch_json(&class_url).await {
                classes = parse_classes(&class_data);
            }
        }

        let list = Self::parse_json_vod_list(&data);

        // 两种模式都不返回 class 时，用影片条目的真实 type_id 推断分类。
        // 旧实现用 vod_id 当分类 ID，导致分类点击请求到不存在的分类而返回空列表。
        if classes.is_empty() {
            classes = infer_classes_from_list(&data);
        }

        let filters: Option<Value> = filter.then(|| data.get("filters").cloned()).flatten();

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

        let class_value = data.pointer("/class/ty").or_else(|| data.get("class"));
        let class_items = match class_value {
            Some(Value::Array(items)) => items.iter().collect::<Vec<_>>(),
            Some(item) => vec![item],
            None => vec![],
        };
        let classes: Vec<VodClass> = class_items
            .iter()
            .map(|c| VodClass {
                type_id: value_to_string(c.get("type_id").or_else(|| c.get("id")))
                    .unwrap_or_default(),
                type_name: c
                    .get("type_name")
                    .or_else(|| c.get("name"))
                    .or_else(|| c.get("#text"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            })
            .collect();

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

                if self.site_type == 4 {
                    use base64::Engine;
                    params.insert(
                        "ext".into(),
                        base64::engine::general_purpose::URL_SAFE
                            .encode(serde_json::to_vec(extend)?),
                    );
                } else if filter && !extend.is_empty() {
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
        flag: &str,
        id: &str,
        _vip_flags: &[String],
    ) -> HttpResult<PlayerResult> {
        if self.site_type == 4 {
            let params = HashMap::from([
                ("play".into(), id.to_string()),
                ("flag".into(), flag.to_string()),
            ]);
            let data = self.fetch_json(&self.build_url(&params)).await?;
            let result: PlayerResult =
                serde_json::from_value(data.get("data").cloned().unwrap_or(data))?;
            if result.url.trim().is_empty() {
                return Err(AppError::parse_error("播放接口未返回地址"));
            }
            return Ok(result);
        }
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

/// 解析接口返回的 `class` 表（`type_id`/`id` + `type_name`/`name`）。
/// MacCMS 的 `?ac=list` 会返回完整分类表；`?ac=detail` 通常不返回。
fn parse_classes(data: &Value) -> Vec<VodClass> {
    data.get("class")
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
        .unwrap_or_default()
}

/// 接口未返回 `class` 时，从影片条目的真实 `type_id` 推断分类列表。
///
/// 必须使用 `type_id`（`type_id_1` 是父分类，仅作兜底）：若用 `vod_id` 冒充分类 ID，
/// 后续 `?t=<vod_id>` 的分类请求会返回空列表，用户点分类后只会看到「暂无内容」。
/// 按 type_id 去重并按数值排序，避免同名标签重复和顺序随机。
fn infer_classes_from_list(data: &Value) -> Vec<VodClass> {
    let Some(items) = data.get("list").and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut seen: Vec<(String, String)> = Vec::new();
    for item in items {
        let type_id = value_to_string(item.get("type_id").or_else(|| item.get("type_id_1")));
        let type_name = item.get("type_name").and_then(Value::as_str);
        let (Some(type_id), Some(type_name)) = (type_id, type_name) else {
            continue;
        };
        if type_id.is_empty() || seen.iter().any(|(id, _)| id == &type_id) {
            continue;
        }
        seen.push((type_id, type_name.to_string()));
    }

    seen.sort_by(|a, b| match (a.0.parse::<i64>(), b.0.parse::<i64>()) {
        (Ok(left), Ok(right)) => left.cmp(&right),
        _ => a.0.cmp(&b.0),
    });

    seen.into_iter()
        .map(|(type_id, type_name)| VodClass { type_id, type_name })
        .collect()
}

/// 检测是否为可直接播放的视频格式
pub fn is_video_format(url: &str) -> bool {
    if url.is_empty() || url.starts_with("data:") || url.starts_with("blob:") {
        return false;
    }
    if url.starts_with("rtmp:") {
        return true;
    }
    url::Url::parse(url).is_ok_and(|parsed| {
        matches!(parsed.scheme(), "http" | "https")
            && (RE_VIDEO_URL.is_match(parsed.path()) || parsed.path().contains("video/tos"))
    })
}

/// 是否需要解析
pub fn need_parse(url: &str, play_url: Option<&str>) -> bool {
    if is_video_format(url) && play_url.is_none() {
        return false;
    }
    true
}

// ==================== XML API 解析（使用 quick-xml） ====================

const MAX_XML_INPUT_BYTES: u64 = 200 * 1024 * 1024; // 200 MB 硬上限，防止解压炸弹

/// 使用 quick-xml 安全解析 XML API 响应，转换为 JSON Value
/// TVBox XML API 的典型格式（含 <rss> 外层包装）：
///   <rss><list><video><vod_id>1</vod_id><vod_name>...</vod_name></video></list></rss>
fn parse_xml_api_response(xml: &str) -> HttpResult<Value> {
    let xml = xml.trim();
    if xml.is_empty() {
        return Ok(Value::Object(serde_json::Map::new()));
    }

    if xml.len() as u64 > MAX_XML_INPUT_BYTES {
        return Err(AppError::parse_error("XML 响应超过 200MB 大小限制"));
    }

    // 剥离 <rss> 外层包装（兼容无 rss 的情况）
    let content = strip_xml_wrapper(xml);
    let mut reader = Reader::from_str(content);
    reader.config_mut().trim_text(true);
    read_xml_element(&mut reader, 0)
}

/// 剥离 <?xml?> 和 <rss>...</rss> 外层
fn strip_xml_wrapper(xml: &str) -> &str {
    let rss_start = match xml.find("<rss") {
        Some(i) => i,
        None => return xml,
    };
    let inner_start = xml[rss_start..]
        .find('>')
        .map(|i| rss_start + i + 1)
        .unwrap_or(0);
    if let Some(end) = xml.rfind("</rss>") {
        &xml[inner_start..end]
    } else {
        xml
    }
}

/// 递归读取一个 XML 元素的所有子元素，返回 JSON Value
/// 每个子标签的结束标签（End）在递归调用返回后在父层消费，
/// 因此父层循环只在遇到自身的 End 时 break。
fn read_xml_element(reader: &mut Reader<&[u8]>, depth: usize) -> HttpResult<Value> {
    if depth > 128 {
        return Err(AppError::parse_error("XML 嵌套过深"));
    }
    let mut map = serde_json::Map::new();
    let mut text = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => {
                let tag_name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let mut attrs = serde_json::Map::new();
                for attr in e.attributes() {
                    let attr = attr.map_err(|e| AppError::parse_error(e.to_string()))?;
                    attrs.insert(
                        String::from_utf8_lossy(attr.key.as_ref()).to_string(),
                        Value::String(
                            attr.unescape_value()
                                .map_err(|e| AppError::parse_error(e.to_string()))?
                                .into_owned(),
                        ),
                    );
                }
                let mut child = read_xml_element(reader, depth + 1)?;
                if !attrs.is_empty() {
                    if let Value::Object(children) = child {
                        attrs.extend(children);
                    } else if !child.is_null() {
                        attrs.insert("#text".into(), child);
                    }
                    child = Value::Object(attrs);
                }
                merge_into_map(&mut map, &tag_name, child);
            }
            Ok(Event::Empty(ref e)) => {
                let tag_name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                merge_into_map(&mut map, &tag_name, Value::Null);
            }
            Ok(Event::Text(ref e)) => {
                text.push_str(
                    &e.unescape()
                        .map_err(|e| AppError::parse_error(e.to_string()))?,
                );
            }
            Ok(Event::CData(ref e)) => {
                text.push_str(&String::from_utf8_lossy(e.as_ref()));
            }
            Ok(Event::End(_)) | Ok(Event::Eof) => break,
            Err(error) => return Err(AppError::parse_error(error.to_string())),
            _ => {}
        }
    }

    if map.is_empty() {
        Ok(if text.trim().is_empty() {
            Value::Null
        } else {
            Value::String(text.trim().to_string())
        })
    } else {
        if !text.trim().is_empty() {
            map.insert("#text".into(), Value::String(text.trim().to_string()));
        }
        Ok(Value::Object(map))
    }
}

/// 将值按 key 合并到 JSON map，重复 key 自动合并为数组
fn merge_into_map(map: &mut serde_json::Map<String, Value>, key: &str, value: Value) {
    match map.get_mut(key) {
        Some(Value::Array(ref mut arr)) => arr.push(value),
        Some(existing) => {
            let old = std::mem::replace(existing, Value::Array(Vec::new()));
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
    fn xml_preserves_siblings_and_episode_lines() {
        let data = parse_xml_api_response(r#"<rss><class><ty id="1">电影</ty></class><list><video><id>1</id><name>First</name><dl><dd flag="hls"><![CDATA[一$https://example.com/1.m3u8#二$https://example.com/2.m3u8]]></dd><dd flag="mp4">一$https://example.com/1.mp4</dd></dl></video><video><id>2</id><name>Second</name></video></list></rss>"#).unwrap();
        let videos = HttpSpider::parse_xml_vod_list(&data);
        assert_eq!(videos.len(), 2);
        assert_eq!(videos[1].vod_id, "2");
        assert_eq!(videos[0].vod_play_from.as_deref(), Some("hls$$$mp4"));
        assert!(videos[0]
            .vod_play_url
            .as_ref()
            .unwrap()
            .contains("2.m3u8$$$"));
        assert_eq!(data["class"]["ty"]["id"], "1");
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
    fn parses_class_table_from_ac_list_response() {
        // ?ac=list 返回的完整分类表（带 type_pid 层级）
        let data = serde_json::json!({
            "code": 1,
            "list": [{ "vod_id": 1, "type_id": 22, "type_name": "喜剧片" }],
            "class": [
                { "type_id": 20, "type_pid": 0, "type_name": "电影片" },
                { "type_id": 22, "type_pid": 20, "type_name": "喜剧片" }
            ]
        });

        let classes = parse_classes(&data);
        assert_eq!(classes.len(), 2);
        assert_eq!(classes[0].type_id, "20");
        assert_eq!(classes[0].type_name, "电影片");
        assert_eq!(classes[1].type_id, "22");
        assert_eq!(classes[1].type_name, "喜剧片");

        // ac=detail 形态：没有 class → 空
        let detail = serde_json::json!({ "code": 1, "list": [{ "vod_id": 1 }] });
        assert!(parse_classes(&detail).is_empty());
    }

    #[test]
    fn infers_classes_from_real_type_id_not_vod_id() {
        // MacCMS 的 ?ac=detail 不返回 class，只能用列表条目的 type_id 推断分类；
        // 用 vod_id 冒充分类 ID 会让分类请求返回空列表。
        let data = serde_json::json!({
            "code": 1,
            "total": 161897,
            "list": [
                { "vod_id": 165066, "type_id": 22, "type_id_1": 20, "type_name": "喜剧片" },
                { "vod_id": 165065, "type_id": 20, "type_name": "欧美剧" },
                { "vod_id": 165064, "type_id": 22, "type_name": "喜剧片" },
                { "vod_id": 165063, "type_id": "7", "type_name": "国产剧" },
                { "vod_id": 165062, "type_name": "无类型的条目被忽略" }
            ]
        });

        let classes = infer_classes_from_list(&data);
        let pairs: Vec<(String, String)> = classes
            .iter()
            .map(|c| (c.type_id.clone(), c.type_name.clone()))
            .collect();

        assert_eq!(
            pairs,
            vec![
                ("7".to_string(), "国产剧".to_string()),
                ("20".to_string(), "欧美剧".to_string()),
                ("22".to_string(), "喜剧片".to_string()),
            ]
        );
        assert!(
            pairs.iter().all(|(id, _)| id != "165066" && id != "165065"),
            "分类 ID 不能是 vod_id: {:?}",
            pairs
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
