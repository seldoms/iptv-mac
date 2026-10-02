use serde_json::Value;
use tauri::State;

use crate::error::AppError;
use crate::site_filter::{
    compatibility_of, config_display_name, config_warnings, friendly_config_error,
    is_directly_supported_site, site_api, site_name, site_type, summarize_config,
    SiteProbeStats,
};
use crate::spider::{HttpSpider, SiteConfig};
use crate::AppState;

const MAX_INSPECT_SITE_PROBES: usize = 6;
const INSPECT_SITE_TIMEOUT_SECS: i64 = 5;

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
///
/// 命令层只做编排：取数（加载配置 / 抽样探测）→ 纯函数汇总（site_filter）→ 拼装返回值。
pub fn handle_config_inspect(state: &State<'_, AppState>, url: String) -> Result<Value, AppError> {
    let config_result = {
        let mgr = state.config_manager.lock();
        crate::block_on(mgr.load_from_url(&url))
    };

    match config_result {
        Ok(config) => {
            let summary = summarize_config(&config);
            let probe = crate::block_on(probe_supported_sites(&url, &config));
            let (compatibility, compatibility_label, can_import) =
                compatibility_of(&summary, &probe);
            let warnings = config_warnings(&summary, &probe, can_import);
            let name = config_display_name(&config, &url);

            Ok(serde_json::json!({
                "success": true,
                "data": {
                    "url": url,
                    "name": name,
                    "siteCount": summary.sites,
                    "visibleSiteCount": summary.visible_sites,
                    "searchableSiteCount": summary.searchable_sites,
                    "unsupportedSiteCount": summary.unsupported_sites,
                    "liveCount": summary.lives,
                    "parseCount": summary.parses,
                    "hasSpider": summary.has_spider,
                    "sourceType": summary.source_type,
                    "compatibility": compatibility,
                    "compatibilityLabel": compatibility_label,
                    "canImport": can_import,
                    "hiddenSiteCount": summary.hidden_sites,
                    "cspSiteCount": summary.csp_sites,
                    "missingApiSiteCount": summary.missing_api_sites,
                    "probeInspectedSiteCount": probe.inspected,
                    "probePassedSiteCount": probe.passed,
                    "probeFailedSiteCount": probe.failed,
                    "probeSkippedSiteCount": probe.skipped,
                    "liveChannelCount": summary.live_channels,
                    "warnings": warnings,
                }
            }))
        }
        Err(error) => Ok(serde_json::json!({
            "success": false,
            "error": friendly_config_error(&error),
        })),
    }
}

/// 加载并切换配置（async 版本，不阻塞主线程）
pub async fn handle_config_load_async(
    state: &State<'_, AppState>,
    url: String,
    name: Option<String>,
) -> Result<Value, AppError> {
    let data_dir = state.data_dir.clone();
    let revision = state
        .config_load_revision
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        + 1;
    let config = crate::config::load_config_from_url(&url, Some(&data_dir)).await?;

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
        if state
            .config_load_revision
            .load(std::sync::atomic::Ordering::SeqCst)
            != revision
        {
            return Err(AppError::invalid_input("配置加载已被新的选择取消"));
        }
        if name.is_some() || !mgr.list().iter().any(|item| item.url == url) {
            mgr.add(&url, &display_name)?;
        }
        mgr.set_current_url(Some(url.clone()))?;
        *state.current_config.lock() = Some((url.clone(), config.clone()));
    }

    Ok(serde_json::json!({ "success": true, "data": config }))
}

/// 加载并切换配置（同步版本，阻塞主线程 — 保留向后兼容）
pub fn handle_config_load(
    state: &State<'_, AppState>,
    url: String,
    name: Option<String>,
) -> Result<Value, AppError> {
    crate::block_on(handle_config_load_async(state, url, name))
}

/// 删除配置
pub fn handle_config_remove(state: &State<'_, AppState>, url: String) -> Result<Value, AppError> {
    state
        .config_load_revision
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    state.config_manager.lock().remove(&url)?;
    crate::commands::request_live_refresh();
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
