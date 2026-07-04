use serde_json::Value;
use tauri::State;

use crate::error::AppError;
use crate::spider::{HttpSpider, SiteConfig};
use crate::AppState;

const MAX_INSPECT_SITE_PROBES: usize = 6;
const INSPECT_SITE_TIMEOUT_SECS: i64 = 5;

#[derive(Default)]
struct SiteProbeStats {
    inspected: i64,
    passed: i64,
    failed: i64,
    skipped: i64,
}

fn site_type(site: &Value) -> i64 {
    site.get("type").and_then(Value::as_i64).unwrap_or(1)
}

fn site_api(site: &Value) -> Option<&str> {
    site.get("api")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|api| !api.is_empty())
}

fn site_name(site: &Value) -> Option<&str> {
    site.get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
}

fn is_hidden_site(site: &Value) -> bool {
    site.get("hide").and_then(Value::as_i64) == Some(1)
}

fn is_http_api_site(site: &Value) -> bool {
    matches!(site_type(site), 0 | 1 | 4)
}

fn is_directly_supported_site(site: &Value) -> bool {
    is_http_api_site(site) && !is_hidden_site(site) && site_api(site).is_some()
}

fn is_searchable_site(site: &Value) -> bool {
    is_directly_supported_site(site) && site.get("searchable").and_then(Value::as_i64) != Some(0)
}

fn live_channel_count(live: &Value) -> i64 {
    if let Some(count) = live.get("channelCount").and_then(Value::as_i64) {
        return count;
    }

    live.get("groups")
        .and_then(Value::as_array)
        .map(|groups| {
            groups
                .iter()
                .map(|group| {
                    group
                        .get("channel")
                        .or_else(|| group.get("channels"))
                        .and_then(Value::as_array)
                        .map(|channels| channels.len() as i64)
                        .unwrap_or(0)
                })
                .sum()
        })
        .unwrap_or(0)
}

async fn probe_supported_sites(config_url: &str, config: &Value) -> SiteProbeStats {
    let mut stats = SiteProbeStats::default();
    let Some(sites) = config.get("sites").and_then(Value::as_array) else {
        return stats;
    };

    for site in sites.iter().filter(|site| is_directly_supported_site(site)) {
        if stats.inspected as usize >= MAX_INSPECT_SITE_PROBES {
            stats.skipped += 1;
            continue;
        }

        let Some(api) = site_api(site) else {
            continue;
        };

        stats.inspected += 1;
        let key = site
            .get("key")
            .and_then(Value::as_str)
            .filter(|key| !key.trim().is_empty())
            .unwrap_or(api);
        let timeout = site
            .get("timeout")
            .and_then(Value::as_i64)
            .filter(|timeout| *timeout > 0)
            .map(|timeout| timeout.min(INSPECT_SITE_TIMEOUT_SECS))
            .unwrap_or(INSPECT_SITE_TIMEOUT_SECS);
        let spider = HttpSpider::new(SiteConfig {
            key: key.to_string(),
            name: site_name(site).unwrap_or(key).to_string(),
            site_type: site_type(site),
            api: crate::config::resolve_relative_url(config_url, api),
            ext: site.get("ext").cloned(),
            play_url: site
                .get("playUrl")
                .and_then(Value::as_str)
                .map(String::from),
            click: site.get("click").and_then(Value::as_str).map(String::from),
            header: site.get("header").cloned(),
            timeout: Some(timeout),
        });

        let passed = match spider.home_content(true).await {
            Ok(result) => {
                result
                    .class
                    .as_ref()
                    .map(|items| !items.is_empty())
                    .unwrap_or(false)
                    || result
                        .list
                        .as_ref()
                        .map(|items| !items.is_empty())
                        .unwrap_or(false)
            }
            Err(_) => false,
        };

        if passed {
            stats.passed += 1;
        } else {
            stats.failed += 1;
        }
    }

    stats
}

/// 获取当前配置
pub fn handle_config_get_current(state: &State<'_, AppState>) -> Result<Value, AppError> {
    let url = state
        .config_manager
        .lock()
        .get_current_url()
        .map(|s| s.to_string());
    if let Some(url) = url {
        if let Some((cached_url, cached_config)) = state.current_config.lock().as_ref() {
            if cached_url == &url {
                return Ok(cached_config.clone());
            }
        }
        // 异步加载，在共享同步运行时上阻塞等待
        let mgr = state.config_manager.lock();
        match crate::block_on(mgr.load_from_url(&url)) {
            Ok(config) => {
                *state.current_config.lock() = Some((url, config.clone()));
                Ok(config)
            }
            Err(_) => Ok(Value::Null),
        }
    } else {
        Ok(Value::Null)
    }
}

/// 获取当前配置 URL
pub fn handle_config_get_current_url(state: &State<'_, AppState>) -> Result<Value, AppError> {
    let url = state
        .config_manager
        .lock()
        .get_current_url()
        .map(|s| s.to_string());
    Ok(url.map(Value::String).unwrap_or(Value::Null))
}

/// 获取配置列表
pub fn handle_config_list(state: &State<'_, AppState>) -> Result<Value, AppError> {
    let items = state.config_manager.lock().list().to_vec();
    Ok(serde_json::to_value(items).unwrap_or_default())
}

/// 获取配置预检信息
pub fn handle_config_inspect(state: &State<'_, AppState>, url: String) -> Result<Value, AppError> {
    let config_result = {
        let mgr = state.config_manager.lock();
        crate::block_on(mgr.load_from_url(&url))
    };

    match config_result {
        Ok(config) => {
            let sites = config
                .get("sites")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let lives = config
                .get("lives")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let parses = config
                .get("parses")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let has_spider = config
                .get("spider")
                .and_then(Value::as_str)
                .map(|s| !s.is_empty())
                .unwrap_or(false);
            let source_type = config
                .get("sourceType")
                .and_then(Value::as_str)
                .unwrap_or("tvbox");

            let mut warnings: Vec<String> = Vec::new();
            if source_type == "live" {
                warnings.push("已识别为直播源直链，将作为单个直播源加载".to_string());
            }

            let site_entries = config
                .get("sites")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();

            let visible_sites = site_entries
                .iter()
                .filter(|site| is_directly_supported_site(site))
                .count() as i64;

            let searchable_sites = site_entries
                .iter()
                .filter(|site| is_searchable_site(site))
                .count() as i64;

            let hidden_sites = site_entries
                .iter()
                .filter(|site| is_hidden_site(site))
                .count() as i64;

            let csp_sites = site_entries
                .iter()
                .filter(|site| site_type(site) == 3)
                .count() as i64;

            let missing_api_sites = site_entries
                .iter()
                .filter(|site| {
                    is_http_api_site(site) && !is_hidden_site(site) && site_api(site).is_none()
                })
                .count() as i64;

            let unsupported_sites = site_entries
                .iter()
                .filter(|site| !is_hidden_site(site) && !is_directly_supported_site(site))
                .count() as i64;

            if csp_sites > 0 {
                warnings.push(format!(
                    "包含 {} 个 type=3 CSP/Jar/JS/Python 站点，当前桌面端暂不执行此类爬虫",
                    csp_sites
                ));
            }
            if hidden_sites > 0 {
                warnings.push(format!("已忽略 {} 个 hide=1 的隐藏站点", hidden_sites));
            }
            if missing_api_sites > 0 {
                warnings.push(format!(
                    "有 {} 个 HTTP API 站点缺少 api 地址，已排除",
                    missing_api_sites
                ));
            }

            let probe_stats = crate::block_on(probe_supported_sites(&url, &config));
            if probe_stats.inspected > 0 && probe_stats.passed == 0 {
                warnings.push(format!(
                    "已抽样测试 {} 个 HTTP API 站点，暂未拿到首页分类或列表",
                    probe_stats.inspected
                ));
            } else if probe_stats.failed > 0 {
                warnings.push(format!(
                    "抽样测试中 {} 个 HTTP API 站点未返回可用首页内容",
                    probe_stats.failed
                ));
            }
            if probe_stats.skipped > 0 {
                warnings.push(format!(
                    "为避免预检过慢，另有 {} 个 HTTP API 站点留待导入后探测",
                    probe_stats.skipped
                ));
            }

            let live_channels = config
                .get("lives")
                .and_then(Value::as_array)
                .map(|items| items.iter().map(live_channel_count).sum::<i64>())
                .unwrap_or(0);

            let has_probe_data = probe_stats.inspected > 0;
            let direct_sites_ready =
                visible_sites > 0 && (!has_probe_data || probe_stats.passed > 0);
            let has_live_sources = lives > 0;
            let (compatibility, compatibility_label, can_import) = if direct_sites_ready {
                ("ready", "点播可用", true)
            } else if has_live_sources {
                ("live", "仅直播可用", true)
            } else if sites > 0 || parses > 0 {
                ("unsupported", "暂不兼容", false)
            } else {
                ("invalid", "不可用", false)
            };

            if !can_import {
                warnings.push("当前项目没有可消费的 type=0/1/4 HTTP API 站点或直播源".to_string());
            }

            let name = config
                .get("sites")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.iter().find(|site| is_directly_supported_site(site)))
                .and_then(site_name)
                .or_else(|| {
                    config
                        .get("sites")
                        .and_then(|v| v.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(site_name)
                })
                .or_else(|| {
                    config
                        .get("lives")
                        .and_then(|v| v.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|l| l.get("name").and_then(Value::as_str))
                })
                .unwrap_or(&url)
                .to_string();

            Ok(serde_json::json!({
                "success": true,
                "data": {
                    "url": url,
                    "name": name,
                    "siteCount": sites,
                    "visibleSiteCount": visible_sites,
                    "searchableSiteCount": searchable_sites,
                    "unsupportedSiteCount": unsupported_sites,
                    "liveCount": lives,
                    "parseCount": parses,
                    "hasSpider": has_spider,
                    "sourceType": source_type,
                    "compatibility": compatibility,
                    "compatibilityLabel": compatibility_label,
                    "canImport": can_import,
                    "hiddenSiteCount": hidden_sites,
                    "cspSiteCount": csp_sites,
                    "missingApiSiteCount": missing_api_sites,
                    "probeInspectedSiteCount": probe_stats.inspected,
                    "probePassedSiteCount": probe_stats.passed,
                    "probeFailedSiteCount": probe_stats.failed,
                    "probeSkippedSiteCount": probe_stats.skipped,
                    "liveChannelCount": live_channels,
                    "warnings": warnings,
                }
            }))
        }
        Err(e) => {
            let error_msg = e.to_string();
            let friendly = if error_msg.contains("超时") {
                "配置地址连接超时，请稍后重试或检查网络"
            } else if error_msg.contains("无法连接") {
                "配置地址无法连接，请检查域名、网络或代理设置"
            } else if error_msg.contains("JSON") {
                "配置 JSON 格式错误，请检查内容是否完整"
            } else {
                "配置预检失败，请检查地址、网络或 JSON 格式"
            };
            Ok(serde_json::json!({
                "success": false,
                "error": friendly,
            }))
        }
    }
}

/// 加载并切换配置
pub fn handle_config_load(
    state: &State<'_, AppState>,
    url: String,
    name: Option<String>,
) -> Result<Value, AppError> {
    let config = {
        let mgr = state.config_manager.lock();
        crate::block_on(mgr.load_from_url(&url))?
    };

    let display_name = name.clone().unwrap_or_else(|| {
        config
            .get("sites")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|s| s.get("name").and_then(Value::as_str))
            .or_else(|| {
                config
                    .get("lives")
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|l| l.get("name").and_then(Value::as_str))
            })
            .unwrap_or(&url)
            .to_string()
    });

    {
        let mut mgr = state.config_manager.lock();
        mgr.add(&url, &display_name)?;
        mgr.set_current_url(Some(url.clone()))?;
    }
    *state.current_config.lock() = Some((url.clone(), config.clone()));

    // 返回配置数据
    Ok(serde_json::json!({ "success": true, "data": config }))
}

/// 删除配置
pub fn handle_config_remove(state: &State<'_, AppState>, url: String) -> Result<Value, AppError> {
    state.config_manager.lock().remove(&url)?;
    let current_url = state
        .config_manager
        .lock()
        .get_current_url()
        .map(str::to_string);
    let should_clear_cache = state
        .current_config
        .lock()
        .as_ref()
        .map(|(cached_url, _)| Some(cached_url) != current_url.as_ref())
        .unwrap_or(false);
    if should_clear_cache {
        *state.current_config.lock() = None;
    }
    Ok(serde_json::json!({ "success": true }))
}

/// 重命名配置
pub fn handle_config_rename(
    state: &State<'_, AppState>,
    url: String,
    name: String,
) -> Result<Value, AppError> {
    state.config_manager.lock().rename(&url, &name)?;
    Ok(serde_json::json!({ "success": true }))
}

/// 预检直播源
pub fn handle_config_peek_lives(
    state: &State<'_, AppState>,
    url: String,
) -> Result<Value, AppError> {
    let mgr = state.config_manager.lock();
    match crate::block_on(mgr.load_from_url(&url)) {
        Ok(config) => {
            let lives = config.get("lives").cloned().unwrap_or(Value::Array(vec![]));
            Ok(serde_json::json!({ "success": true, "data": lives }))
        }
        Err(_) => Ok(serde_json::json!({
            "success": false,
            "error": "配置预览失败，请检查地址和格式"
        })),
    }
}
