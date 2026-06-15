use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::Value;

use crate::error::AppError;
use crate::network::safe_json_parse;

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
        let before = self.items.len();
        self.items.retain(|i| i.url != url);
        if self.items.len() == before {
            return Err(AppError::not_found(format!("配置不存在: {}", url)));
        }
        if self.current_url.as_deref() == Some(url) {
            self.current_url = None;
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
                    if let Some(fallback_url) = github_raw_fallback_url(url) {
                        let fallback_text =
                            crate::network::http_get(&client, &fallback_url).await?;
                        parse_config_or_live_source(&fallback_url, &fallback_text)
                    } else {
                        Err(error)
                    }
                }
            };
        }

        let text = if url.starts_with("file://") {
            let path = url.strip_prefix("file://").unwrap_or(url);
            fs::read_to_string(path).map_err(|e| {
                AppError::not_found(format!("文件不存在: {}", path)).with_internal(e.to_string())
            })?
        } else {
            // 尝试作为本地文件路径
            let path = PathBuf::from(url);
            if path.exists() {
                fs::read_to_string(url).map_err(|e| {
                    AppError::not_found(format!("文件读取失败: {}", url))
                        .with_internal(e.to_string())
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

        return Ok(config);
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
    let mut seen_site_keys: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut spider: Option<&str> = None;

    for config in &configs {
        if let Some(sites) = config.get("sites").and_then(Value::as_array) {
            for site in sites {
                let key = site.get("key").and_then(Value::as_str).unwrap_or("").to_string();
                if !key.is_empty() && !seen_site_keys.contains(&key) {
                    seen_site_keys.insert(key);
                    all_sites.push(site.clone());
                } else if key.is_empty() {
                    all_sites.push(site.clone());
                }
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
        return Ok(parsed);
    }
    // 可能直播源文本
    let groups = crate::live::parse_live_content(&text);
    let channel_count: usize = groups.iter().map(|group| group.channel.len()).sum();
    if channel_count > 0 {
        return Ok(wrap_live_source_config(url, groups.len(), channel_count));
    }
    Err(AppError::parse_error(
        "无法识别子配置格式",
    ))
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
    fn load_from_local_file_fails_on_nonexistent() {
        let dir = test_dir("iptv-config-test-4");
        let mgr = ConfigManager::new(dir.clone());
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(mgr.load_from_url("/nonexistent/path/config.json"));
        assert!(result.is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
