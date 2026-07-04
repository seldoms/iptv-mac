use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use regex::Regex;
use serde_json::Value;

use crate::error::AppError;
use crate::network::safe_json_parse;
use crate::path_safety;

/// 配置存储文件名
const CONFIG_STORE_FILE: &str = "config-store.json";

/// 配置存储路径（基于 data_dir）
fn config_store_path(data_dir: &PathBuf) -> PathBuf {
    data_dir.join(CONFIG_STORE_FILE)
}

/// 配置列表项
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigItem {
    pub url: String,
    pub name: String,
    #[serde(alias = "add_time")]
    pub add_time: i64,
    #[serde(alias = "update_time")]
    pub update_time: i64,
}

#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigStoreData {
    #[serde(default)]
    configs: Vec<ConfigItem>,
    #[serde(default, alias = "current_url")]
    current_url: String,
}

/// 配置管理器
pub struct ConfigManager {
    store_path: PathBuf,
    data_dir: PathBuf,
    items: Vec<ConfigItem>,
    current_url: Option<String>,
}

impl ConfigManager {
    pub fn new(data_dir: PathBuf) -> Self {
        let store_path = config_store_path(&data_dir);
        let mut store = Self::load_store(&store_path);
        let mut changed = false;
        if store.current_url.is_empty() && !store.configs.is_empty() {
            store.current_url = store
                .configs
                .first()
                .map(|item| item.url.clone())
                .unwrap_or_default();
            changed = true;
        }
        if changed {
            let _ = Self::save_store_data(&store_path, &store);
        }
        let current_url = if store.current_url.is_empty() {
            store.configs.first().map(|item| item.url.clone())
        } else {
            Some(store.current_url.clone())
        };
        Self {
            store_path,
            data_dir,
            items: store.configs,
            current_url,
        }
    }

    fn load_store(path: &PathBuf) -> ConfigStoreData {
        let Ok(text) = fs::read_to_string(path) else {
            return ConfigStoreData::default();
        };

        if let Ok(store) = serde_json::from_str::<ConfigStoreData>(&text) {
            return store;
        }

        serde_json::from_str::<Vec<ConfigItem>>(&text)
            .map(|configs| ConfigStoreData {
                configs,
                current_url: String::new(),
            })
            .unwrap_or_default()
    }

    fn save_store_data(path: &PathBuf, store: &ConfigStoreData) -> Result<(), AppError> {
        let text = serde_json::to_string_pretty(store)
            .map_err(|e| AppError::internal("序列化配置列表失败").with_internal(e.to_string()))?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, &text)?;
        fs::rename(&tmp, path)?;
        Ok(())
    }

    fn save_store(&self) -> Result<(), AppError> {
        let store = ConfigStoreData {
            configs: self.items.clone(),
            current_url: self.current_url.clone().unwrap_or_default(),
        };
        Self::save_store_data(&self.store_path, &store)
    }

    pub fn list(&self) -> &[ConfigItem] {
        &self.items
    }

    pub fn add(&mut self, url: &str, name: &str) -> Result<(), AppError> {
        let now = now_secs();
        if let Some(item) = self.items.iter_mut().find(|i| i.url == url) {
            item.name = name.to_string();
            item.update_time = now;
        } else {
            self.items.push(ConfigItem {
                url: url.to_string(),
                name: name.to_string(),
                add_time: now,
                update_time: now,
            });
        }
        self.save_store()
    }

    pub fn remove(&mut self, url: &str) -> Result<(), AppError> {
        let Some(removed_index) = self.items.iter().position(|i| i.url == url) else {
            return Err(AppError::not_found(format!("配置不存在: {}", url)));
        };

        self.items.remove(removed_index);
        if self.current_url.as_deref() == Some(url) {
            self.current_url = self
                .items
                .get(removed_index)
                .or_else(|| self.items.last())
                .map(|item| item.url.clone());
        }

        self.save_store()
    }

    pub fn rename(&mut self, url: &str, name: &str) -> Result<(), AppError> {
        let item = self
            .items
            .iter_mut()
            .find(|i| i.url == url)
            .ok_or_else(|| AppError::not_found(format!("配置不存在: {}", url)))?;
        item.name = name.to_string();
        item.update_time = now_secs();
        self.save_store()
    }

    pub fn get_current_url(&self) -> Option<&str> {
        self.current_url.as_deref()
    }

    pub fn set_current_url(&mut self, url: Option<String>) -> Result<(), AppError> {
        self.current_url = url;
        self.save_store()
    }

    /// 从 URL 加载配置文本并解析。
    ///
    /// TVBox JSON 配置原样返回；直播 M3U/TXT/JSON 直链会包装成只含一个
    /// lives 条目的配置，让 config/load/refresh 等入口共享同一流程。
    pub async fn load_from_url(&self, url: &str) -> Result<Value, AppError> {
        load_config_from_url(url, Some(&self.data_dir)).await
    }
}

pub async fn load_config_from_url(
    url: &str,
    data_dir: Option<&std::path::PathBuf>,
) -> Result<Value, AppError> {
    if url.starts_with("http://") || url.starts_with("https://") {
        let client = crate::network::create_client()?;
        let text = crate::network::http_get(&client, url).await?;

        // 检测多仓配置
        if let Ok(parsed) = crate::network::safe_json_parse(&text) {
            if is_multi_warehouse_config(&parsed) {
                let configs = load_multi_warehouse_configs(&client, &parsed, url).await?;
                if !configs.is_empty() {
                    return Ok(merge_tvbox_configs(configs));
                }
            }
        }

        return match parse_config_or_live_source(url, &text) {
            Ok(config) => Ok(config),
            Err(error) => {
                if let Some(config) = load_link3_public_configs(&client, url, &text).await? {
                    return Ok(config);
                }
                if let Some(fallback_url) = github_raw_fallback_url(url) {
                    let fallback_text = crate::network::http_get(&client, &fallback_url).await?;
                    parse_config_or_live_source(&fallback_url, &fallback_text)
                } else {
                    Err(error)
                }
            }
        };
    }

    let text = if url.starts_with("file://") {
        let data_dir = data_dir.ok_or_else(|| {
            AppError::invalid_input("file:// 协议只能在应用目录内使用")
        })?;
        let path_str = url.strip_prefix("file://").unwrap_or(url);
        // 使用 path_safety 的路径规范化函数防止路径遍历
        let safe_path = path_safety::resolve_safe_path(
            &data_dir.to_string_lossy(),
            path_str,
            false,
        )
        .ok_or_else(|| {
            AppError::invalid_input(format!("不允许访问路径: {}", path_str))
        })?;
        fs::read_to_string(&safe_path).map_err(|e| {
            AppError::not_found(format!("文件不存在: {}", safe_path.display())).with_internal(e.to_string())
        })?
    } else {
        // 尝试作为本地文件路径
        let path = PathBuf::from(url);
        if path.exists() {
            fs::read_to_string(url).map_err(|e| {
                AppError::not_found(format!("文件读取失败: {}", url)).with_internal(e.to_string())
            })?
        } else {
            return Err(AppError::invalid_input(format!(
                "不支持的配置地址: {}",
                url
            )));
        }
    };

    parse_config_or_live_source(url, &text)
}

pub fn parse_config_or_live_source(url: &str, text: &str) -> Result<Value, AppError> {
    if let Ok(config) = safe_json_parse(text) {
        if is_tvbox_config(&config) {
            return Ok(config);
        }

        let groups = crate::live::parse_live_content(text);
        let channel_count: usize = groups.iter().map(|group| group.channel.len()).sum();
        if channel_count > 0 {
            return Ok(wrap_live_source_config(url, groups.len(), channel_count));
        }

        return Err(AppError::parse_error(
            "JSON 内容不是 TVBox 配置或直播源，请检查是否返回了网页、接口数据或未公开文档",
        ));
    }

    let groups = crate::live::parse_live_content(text);
    let channel_count: usize = groups.iter().map(|group| group.channel.len()).sum();
    if channel_count > 0 {
        return Ok(wrap_live_source_config(url, groups.len(), channel_count));
    }

    Err(AppError::parse_error(
        "无法识别配置格式，请检查是否为 TVBox JSON、M3U 或 TXT 直播源",
    ))
}

fn is_tvbox_config(value: &Value) -> bool {
    value.get("sites").and_then(Value::as_array).is_some()
        || value.get("lives").and_then(Value::as_array).is_some()
        || value.get("parses").and_then(Value::as_array).is_some()
}

/// 检查是否为多仓配置（根级有 urls 数组，或根级为结构化的数组）
pub fn is_multi_warehouse_config(value: &Value) -> bool {
    // Case 1: 根级有 "urls" 数组
    if let Some(urls) = value.get("urls").and_then(Value::as_array) {
        return !urls.is_empty();
    }
    // Case 2: 根级是数组，且元素含 url 字段或是 URL 字符串
    if let Some(arr) = value.as_array() {
        if arr.is_empty() {
            return false;
        }
        return arr.iter().any(|item| {
            item.get("url").and_then(Value::as_str).is_some() || item.as_str().is_some()
        });
    }
    false
}

/// 合并多个 TVBox 配置为一个（去重 sites，合并 lives/parses）
pub fn merge_tvbox_configs(configs: Vec<Value>) -> Value {
    let mut all_sites: Vec<Value> = Vec::new();
    let mut all_lives: Vec<Value> = Vec::new();
    let mut all_parses: Vec<Value> = Vec::new();
    let mut site_key_counts: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    let mut seen_site_fingerprints: std::collections::HashSet<String> =
        std::collections::HashSet::new();
    let mut spider: Option<&str> = None;

    for config in &configs {
        if let Some(sites) = config.get("sites").and_then(Value::as_array) {
            for site in sites {
                let key = site
                    .get("key")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let api = site.get("api").and_then(Value::as_str).unwrap_or("");
                let name = site.get("name").and_then(Value::as_str).unwrap_or("");
                let fingerprint = format!("{}\n{}\n{}", key, api, name);
                if !seen_site_fingerprints.insert(fingerprint) {
                    continue;
                }

                let mut site = site.clone();
                if !key.is_empty() {
                    let count = site_key_counts.entry(key.clone()).or_insert(0);
                    *count += 1;
                    if *count > 1 {
                        site["key"] = Value::String(format!("{}__{}", key, count));
                    }
                }
                all_sites.push(site);
            }
        }
        if let Some(lives) = config.get("lives").and_then(Value::as_array) {
            all_lives.extend(lives.iter().cloned());
        }
        if let Some(parses) = config.get("parses").and_then(Value::as_array) {
            all_parses.extend(parses.iter().cloned());
        }
        if spider.is_none() {
            if let Some(s) = config.get("spider").and_then(Value::as_str) {
                if !s.is_empty() {
                    spider = Some(s);
                }
            }
        }
    }

    let mut merged = serde_json::json!({
        "sites": all_sites,
        "lives": all_lives,
        "parses": all_parses,
    });
    if let Some(spider_str) = spider {
        merged["spider"] = serde_json::Value::String(spider_str.to_string());
    }
    merged
}

/// 从多仓配置中加载所有子配置并合并
pub async fn load_multi_warehouse_configs(
    client: &reqwest::Client,
    value: &Value,
    base_url: &str,
) -> Result<Vec<Value>, AppError> {
    let mut configs = Vec::new();

    // Case 1: "urls" 数组
    if let Some(urls) = value.get("urls").and_then(Value::as_array) {
        for url_value in urls {
            if let Some(url) = url_value.as_str() {
                let resolved = resolve_relative_url(base_url, url);
                match load_single_sub_config(client, &resolved).await {
                    Ok(config) => configs.push(config),
                    Err(e) => eprintln!("[config] 子配置加载失败 [{}]: {}", resolved, e),
                }
            }
        }
        return Ok(configs);
    }

    // Case 2: 根级数组
    if let Some(arr) = value.as_array() {
        for item in arr {
            if let Some(url) = item.get("url").and_then(Value::as_str) {
                let resolved = resolve_relative_url(base_url, url);
                match load_single_sub_config(client, &resolved).await {
                    Ok(config) => configs.push(config),
                    Err(e) => eprintln!("[config] 子配置加载失败 [{}]: {}", resolved, e),
                }
            } else if let Some(url_str) = item.as_str() {
                let resolved = resolve_relative_url(base_url, url_str);
                match load_single_sub_config(client, &resolved).await {
                    Ok(config) => configs.push(config),
                    Err(e) => eprintln!("[config] 子配置加载失败 [{}]: {}", resolved, e),
                }
            }
        }
        return Ok(configs);
    }

    Ok(configs)
}

async fn load_link3_public_configs(
    client: &reqwest::Client,
    source_url: &str,
    html: &str,
) -> Result<Option<Value>, AppError> {
    let Some(username) = extract_link3_username(source_url, html) else {
        return Ok(None);
    };

    let response = client
        .post("https://v5.api.link3.cc:5678/api/no_auth/user")
        .json(&serde_json::json!({ "username": username }))
        .send()
        .await;
    let Ok(response) = response else {
        return Ok(None);
    };

    if !response.status().is_success() {
        return Ok(None);
    }

    let Ok(value) = response.json::<Value>().await else {
        return Ok(None);
    };
    let links = link3_links(&value);
    if links.is_empty() {
        return Ok(None);
    }

    let mut configs = Vec::new();
    for candidate in extract_link3_candidate_urls(&links) {
        match load_single_sub_config(client, &candidate).await {
            Ok(config) => configs.push(config),
            Err(e) => eprintln!("[config] Link3 候选配置加载失败 [{}]: {}", candidate, e),
        }
    }

    if configs.is_empty() {
        Ok(None)
    } else if configs.len() == 1 {
        Ok(configs.pop())
    } else {
        Ok(Some(merge_tvbox_configs(configs)))
    }
}

fn extract_link3_username(source_url: &str, html: &str) -> Option<String> {
    if let Ok(parsed) = url::Url::parse(source_url) {
        if parsed
            .host_str()
            .is_some_and(|host| host.ends_with("link3.cc"))
        {
            if let Some(username) = parsed
                .path_segments()
                .and_then(|mut segments| segments.next())
                .and_then(clean_link3_username)
            {
                return Some(username);
            }
        }
    }

    if !html.to_ascii_lowercase().contains("link3") {
        return None;
    }

    let marker = "link3.cc/";
    let mut search_start = 0;
    while let Some(offset) = html[search_start..].find(marker) {
        let start = search_start + offset + marker.len();
        let username: String = html[start..]
            .chars()
            .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-')
            .collect();
        if let Some(username) = clean_link3_username(&username) {
            return Some(username);
        }
        search_start = start;
    }

    None
}

fn clean_link3_username(value: &str) -> Option<String> {
    let username = value.trim().trim_matches('/').trim();
    if username.is_empty()
        || matches!(
            username,
            "api" | "auths" | "user" | "account" | "admin" | "search" | "weixin" | "js" | "css"
        )
    {
        return None;
    }
    Some(username.to_string())
}

fn link3_links(value: &Value) -> Vec<Value> {
    let Some(raw_links) = value.get("data").and_then(|data| data.get("links")) else {
        return Vec::new();
    };

    if let Some(items) = raw_links.as_array() {
        return items.clone();
    }

    raw_links
        .as_str()
        .and_then(|text| serde_json::from_str::<Vec<Value>>(text).ok())
        .unwrap_or_default()
}

fn extract_link3_candidate_urls(links: &[Value]) -> Vec<String> {
    let mut urls = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for item in links {
        if item.get("enable").and_then(Value::as_bool) == Some(false) {
            continue;
        }
        let Some(type_value) = item.get("typeValue").and_then(Value::as_object) else {
            continue;
        };

        for field in [
            "content",
            "nav_url",
            "url",
            "link",
            "copy_text",
            "copy_content",
            "text",
        ] {
            let Some(text) = type_value.get(field).and_then(Value::as_str) else {
                continue;
            };
            for url in extract_urls_from_text(text) {
                if seen.insert(url.clone()) {
                    urls.push(url);
                }
            }
        }
    }

    urls
}

fn extract_urls_from_text(text: &str) -> Vec<String> {
    let Ok(re) = Regex::new(r#"https?://[^\s<>"',，。；;、]+"#) else {
        return Vec::new();
    };

    re.find_iter(text)
        .map(|m| {
            m.as_str()
                .trim()
                .trim_matches(|ch: char| matches!(ch, ')' | '）' | ']' | '】' | '"' | '\''))
                .to_string()
        })
        .filter(|url| url.starts_with("http://") || url.starts_with("https://"))
        .collect()
}

async fn load_single_sub_config(client: &reqwest::Client, url: &str) -> Result<Value, AppError> {
    let text = crate::network::http_get(client, url).await?;
    // 子配置也尝试多仓解析（递归一层）
    if let Ok(parsed) = crate::network::safe_json_parse(&text) {
        if is_multi_warehouse_config(&parsed) {
            let subs = Box::pin(load_multi_warehouse_configs(client, &parsed, url)).await?;
            if !subs.is_empty() {
                return Ok(merge_tvbox_configs(subs));
            }
        }
        // 子配置是 TVBox JSON 或直播源
        if is_tvbox_config(&parsed) {
            return Ok(parsed);
        }
        // 包装直播源
        let groups = crate::live::parse_live_content(&text);
        let channel_count: usize = groups.iter().map(|group| group.channel.len()).sum();
        if channel_count > 0 {
            return Ok(wrap_live_source_config(url, groups.len(), channel_count));
        }
        return Err(AppError::parse_error("无法识别子配置格式"));
    }
    // 可能直播源文本
    let groups = crate::live::parse_live_content(&text);
    let channel_count: usize = groups.iter().map(|group| group.channel.len()).sum();
    if channel_count > 0 {
        return Ok(wrap_live_source_config(url, groups.len(), channel_count));
    }
    Err(AppError::parse_error("无法识别子配置格式"))
}

fn wrap_live_source_config(url: &str, group_count: usize, channel_count: usize) -> Value {
    let name = infer_live_source_name(url);
    serde_json::json!({
        "sourceType": "live",
        "sites": [],
        "lives": [{
            "name": name,
            "type": 0,
            "url": url,
            "playerType": 1,
            "groupCount": group_count,
            "channelCount": channel_count
        }],
        "parses": []
    })
}

fn infer_live_source_name(url: &str) -> String {
    let trimmed = url.trim_end_matches('/');
    if let Ok(parsed) = url::Url::parse(trimmed) {
        if let Some(segment) = parsed
            .path_segments()
            .and_then(|mut segments| segments.next_back())
        {
            if !segment.is_empty() {
                return urlencoding::decode(segment)
                    .map(|text| text.to_string())
                    .unwrap_or_else(|_| segment.to_string());
            }
        }
        if let Some(host) = parsed.host_str() {
            return host.to_string();
        }
    }

    PathBuf::from(trimmed)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "直播源".to_string())
}

pub fn github_raw_fallback_url(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    if parsed.host_str() == Some("raw.githubusercontent.com") {
        return None;
    }

    if parsed.host_str() == Some("github.com") {
        let parts: Vec<&str> = parsed.path().trim_start_matches('/').split('/').collect();
        if parts.len() >= 5 && (parts[2] == "blob" || parts[2] == "raw") {
            let owner = parts[0];
            let repo = parts[1];
            let branch = parts[3];
            let file_path = parts[4..].join("/");
            if !owner.is_empty() && !repo.is_empty() && !branch.is_empty() && !file_path.is_empty()
            {
                return Some(format!(
                    "https://raw.githubusercontent.com/{}/{}/{}/{}",
                    owner, repo, branch, file_path
                ));
            }
        }
    }

    let path = parsed.path().trim_start_matches('/');
    let raw_path = path.strip_prefix("raw.githubusercontent.com/")?;
    let mut fallback = format!("https://raw.githubusercontent.com/{}", raw_path);
    if let Some(query) = parsed.query() {
        fallback.push('?');
        fallback.push_str(query);
    }
    Some(fallback)
}

pub fn resolve_relative_url(base: &str, candidate: &str) -> String {
    let candidate = candidate.trim();
    if candidate.is_empty()
        || candidate.starts_with("http://")
        || candidate.starts_with("https://")
        || candidate.starts_with("file://")
    {
        return candidate.to_string();
    }

    if let Ok(base_url) = url::Url::parse(base) {
        if let Ok(joined) = base_url.join(candidate) {
            return joined.to_string();
        }
    }

    let base_path = PathBuf::from(base);
    let parent = if base_path.is_dir() {
        base_path
    } else {
        base_path.parent().map(PathBuf::from).unwrap_or_default()
    };
    parent.join(candidate).to_string_lossy().to_string()
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn config_manager_add_list_remove() {
        let dir = test_dir("iptv-config-test-1");
        let mut mgr = ConfigManager::new(dir.clone());
        for item in mgr.list().to_vec() {
            mgr.remove(&item.url).unwrap();
        }
        mgr.add("https://example.com/config.json", "测试配置")
            .unwrap();
        assert_eq!(mgr.list().len(), 1);
        assert_eq!(mgr.list()[0].name, "测试配置");

        mgr.remove("https://example.com/config.json").unwrap();
        assert!(mgr.list().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn config_manager_selects_next_config_when_current_is_removed() {
        let dir = test_dir("iptv-config-test-remove-current");
        let mut mgr = ConfigManager::new(dir.clone());
        mgr.add("https://example.com/a.json", "A").unwrap();
        mgr.add("https://example.com/b.json", "B").unwrap();
        mgr.add("https://example.com/c.json", "C").unwrap();
        mgr.set_current_url(Some("https://example.com/b.json".to_string()))
            .unwrap();

        mgr.remove("https://example.com/b.json").unwrap();
        assert_eq!(mgr.get_current_url(), Some("https://example.com/c.json"));
        assert_eq!(mgr.list().len(), 2);

        let reloaded = ConfigManager::new(dir.clone());
        assert_eq!(
            reloaded.get_current_url(),
            Some("https://example.com/c.json")
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn config_manager_clears_current_when_last_config_is_removed() {
        let dir = test_dir("iptv-config-test-remove-last");
        let mut mgr = ConfigManager::new(dir.clone());
        mgr.add("https://example.com/only.json", "Only").unwrap();
        mgr.set_current_url(Some("https://example.com/only.json".to_string()))
            .unwrap();

        mgr.remove("https://example.com/only.json").unwrap();
        assert!(mgr.list().is_empty());
        assert_eq!(mgr.get_current_url(), None);

        let reloaded = ConfigManager::new(dir.clone());
        assert_eq!(reloaded.get_current_url(), None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn config_manager_rename() {
        let dir = test_dir("iptv-config-test-2");
        let mut mgr = ConfigManager::new(dir.clone());
        for item in mgr.list().to_vec() {
            mgr.remove(&item.url).unwrap();
        }
        mgr.add("https://example.com/a.json", "旧名称").unwrap();
        mgr.rename("https://example.com/a.json", "新名称").unwrap();
        assert_eq!(mgr.list()[0].name, "新名称");

        let result = mgr.rename("https://example.com/nonexist.json", "x");
        assert!(result.is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn config_manager_persists_across_reload() {
        let dir = test_dir("iptv-config-test-3");
        {
            let mut mgr = ConfigManager::new(dir.clone());
            for item in mgr.list().to_vec() {
                mgr.remove(&item.url).unwrap();
            }
            mgr.add("https://example.com/c.json", "持久化测试").unwrap();
            mgr.set_current_url(Some("https://example.com/c.json".to_string()))
                .unwrap();
        }
        {
            let mgr = ConfigManager::new(dir.clone());
            assert!(mgr.list().iter().any(|item| item.name == "持久化测试"));
            assert_eq!(mgr.get_current_url(), Some("https://example.com/c.json"));
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn config_manager_reads_legacy_array_store() {
        let dir = test_dir("iptv-config-test-legacy");
        let path = config_store_path(&dir);
        std::fs::write(
            &path,
            r#"[{"url":"https://example.com/legacy.json","name":"Legacy","addTime":1,"updateTime":2}]"#,
        )
        .unwrap();

        let mgr = ConfigManager::new(dir.clone());
        assert!(mgr.list().iter().any(|item| item.name == "Legacy"));
        assert_eq!(
            mgr.get_current_url(),
            Some("https://example.com/legacy.json")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn config_manager_starts_empty_without_saved_sources() {
        let dir = test_dir("iptv-config-test-defaults");
        let mgr = ConfigManager::new(dir.clone());

        assert!(mgr.list().is_empty());
        assert_eq!(mgr.get_current_url(), None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn config_manager_preserves_only_saved_sources() {
        let dir = test_dir("iptv-config-test-default-merge");
        let path = config_store_path(&dir);
        std::fs::write(
            &path,
            serde_json::json!({
                "configs": [
                    {
                        "url": "https://example.com/custom.json",
                        "name": "Custom",
                        "addTime": 1,
                        "updateTime": 2
                    }
                ],
                "currentUrl": "https://example.com/custom.json"
            })
            .to_string(),
        )
        .unwrap();

        let mgr = ConfigManager::new(dir.clone());

        assert_eq!(
            mgr.get_current_url(),
            Some("https://example.com/custom.json")
        );
        assert_eq!(mgr.list().len(), 1);
        assert_eq!(mgr.list()[0].name, "Custom");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn config_item_serializes_camel_case() {
        let item = ConfigItem {
            url: "https://example.com/config.json".to_string(),
            name: "Config".to_string(),
            add_time: 1,
            update_time: 2,
        };
        let value = serde_json::to_value(item).unwrap();
        assert_eq!(value["addTime"], 1);
        assert_eq!(value["updateTime"], 2);
        assert!(value.get("add_time").is_none());
    }

    #[test]
    fn resolve_relative_url_against_config_file() {
        let result = resolve_relative_url("https://example.com/path/config.json", "lib/live.txt");
        assert_eq!(result, "https://example.com/path/lib/live.txt");

        let parent = resolve_relative_url("https://example.com/path/config.json", "../live.txt");
        assert_eq!(parent, "https://example.com/live.txt");
    }

    #[test]
    fn parse_tvbox_config_returns_original_config() {
        let config = parse_config_or_live_source(
            "https://example.com/tv.json",
            r#"{"sites":[{"key":"a","name":"A","type":1,"api":"https://api.example.com"}],"lives":[]}"#,
        )
        .unwrap();

        assert_eq!(config["sourceType"], Value::Null);
        assert_eq!(config["sites"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn parse_live_source_wraps_m3u_as_config() {
        let config = parse_config_or_live_source(
            "https://example.com/live.m3u",
            "#EXTM3U\n#EXTINF:-1 group-title=\"News\",Test Channel\nhttps://example.com/live.m3u8\n",
        )
        .unwrap();

        assert_eq!(config["sourceType"], "live");
        assert_eq!(config["lives"][0]["url"], "https://example.com/live.m3u");
        assert_eq!(config["lives"][0]["channelCount"], 1);
    }

    #[test]
    fn parse_unknown_json_rejects_non_config_payload() {
        let result = parse_config_or_live_source(
            "https://example.com/api.json",
            r#"{"code":200,"list":[{"name":"not a config"}]}"#,
        );

        assert!(result.is_err());
    }

    #[test]
    fn parse_html_rejects_non_config_payload() {
        let result = parse_config_or_live_source(
            "https://example.com/",
            r#"<!doctype html><html><head><title>Not Config</title></head><body>入口,http://example.com/tv.json</body></html>"#,
        );

        assert!(result.is_err());
    }

    #[test]
    fn extracts_link3_username_from_html() {
        let html = r#"<html><head><title>link3.cc/uuccc | Link3</title></head></html>"#;
        assert_eq!(
            extract_link3_username("http://影视仓.com/", html).as_deref(),
            Some("uuccc")
        );
    }

    #[test]
    fn extracts_link3_candidate_config_urls() {
        let links: Vec<Value> = serde_json::from_str(
            r#"[
                {"enable":true,"type":"text","typeValue":{"title":"主接口","content":"http://www.影视仓.com"}},
                {"enable":true,"type":"text","typeValue":{"title":"备用接口","content":"https://example.com/tv.json"}},
                {"enable":true,"type":"url","typeValue":{"title":"教程","nav_url":"https://www.kdocs.cn/l/doc"}}
            ]"#,
        )
        .unwrap();

        assert_eq!(
            extract_link3_candidate_urls(&links),
            vec![
                "http://www.影视仓.com".to_string(),
                "https://example.com/tv.json".to_string(),
                "https://www.kdocs.cn/l/doc".to_string()
            ]
        );
    }

    #[test]
    fn github_raw_fallback_rewrites_proxy_url() {
        let fallback = github_raw_fallback_url(
            "https://gh.example.com/raw.githubusercontent.com/owner/repo/main/live.txt",
        );

        assert_eq!(
            fallback.as_deref(),
            Some("https://raw.githubusercontent.com/owner/repo/main/live.txt")
        );
    }

    #[test]
    fn github_raw_fallback_rewrites_blob_url() {
        let fallback =
            github_raw_fallback_url("https://github.com/owner/repo/blob/main/path/config.json");

        assert_eq!(
            fallback.as_deref(),
            Some("https://raw.githubusercontent.com/owner/repo/main/path/config.json")
        );
    }

    #[test]
    fn load_from_local_file_fails_on_nonexistent() {
        let dir = test_dir("iptv-config-test-4");
        let mgr = ConfigManager::new(dir.clone());
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(mgr.load_from_url("/nonexistent/path/config.json"));
        assert!(result.is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
