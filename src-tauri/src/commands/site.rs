use std::collections::HashMap;

use serde_json::Value;
use tauri::State;

use crate::error::AppError;
use crate::spider::{HttpSpider, SiteConfig};
use crate::AppState;

/// 创建 HttpSpider 实例
fn create_spider(state: &State<'_, AppState>, site_key: &str) -> Result<HttpSpider, AppError> {
    let config_url = match state.config_manager.lock().get_current_url() {
        Some(u) => u.to_string(),
        None => return Err(AppError::not_found("无当前配置")),
    };

    let rt = tokio::runtime::Runtime::new().map_err(|e| AppError::internal("创建运行时失败").with_internal(e.to_string()))?;
    let mgr = state.config_manager.lock();
    let config = match rt.block_on(mgr.load_from_url(&config_url)) {
        Ok(c) => c,
        Err(_) => return Err(AppError::not_found("配置加载失败")),
    };

    let sites = match config.get("sites").and_then(Value::as_array) {
        Some(s) => s,
        None => return Err(AppError::not_found("配置中无站点")),
    };

    let site_entry = match sites.iter().find(|s| s.get("key").and_then(Value::as_str) == Some(site_key)) {
        Some(s) => s,
        None => return Err(AppError::not_found(format!("站点不存在: {}", site_key))),
    };

    let site_type = site_entry.get("type").and_then(Value::as_i64).unwrap_or(1);
    let api = match site_entry.get("api").and_then(Value::as_str) {
        Some(a) => a,
        None => return Err(AppError::invalid_input(format!("站点 {} 无 API 地址", site_key))),
    };

    let resolved_api = crate::config::resolve_relative_url(&config_url, api);

    Ok(HttpSpider::new(SiteConfig {
        key: site_key.to_string(),
        name: site_entry.get("name").and_then(Value::as_str).unwrap_or(site_key).to_string(),
        site_type,
        api: resolved_api,
        ext: site_entry.get("ext").cloned(),
        play_url: site_entry.get("playUrl").and_then(Value::as_str).map(String::from),
        click: site_entry.get("click").and_then(Value::as_str).map(String::from),
        header: site_entry.get("header").cloned(),
        timeout: site_entry.get("timeout").and_then(Value::as_i64),
    }))
}

fn block_on<F, T>(fut: F) -> Result<T, AppError>
where F: std::future::Future<Output = Result<T, AppError>> {
    let rt = tokio::runtime::Runtime::new().map_err(|e| AppError::internal("创建运行时失败").with_internal(e.to_string()))?;
    rt.block_on(fut)
}

/// site:homeContent
pub fn handle_site_home_content(state: &State<'_, AppState>, site_key: String, filter: bool) -> Result<Value, AppError> {
    let spider = create_spider(state, &site_key)?;
    let result = block_on(spider.home_content(filter))?;
    Ok(serde_json::json!({ "success": true, "data": result }))
}

/// site:categoryContent
pub fn handle_site_category_content(
    state: &State<'_, AppState>,
    site_key: String, tid: String, pg: String, filter: bool, extend: Value,
) -> Result<Value, AppError> {
    let spider = create_spider(state, &site_key)?;
    let extend_map: HashMap<String, String> = extend.as_object()
        .map(|obj| obj.iter().map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string())).collect())
        .unwrap_or_default();
    let result = block_on(spider.category_content(&tid, &pg, filter, &extend_map))?;
    Ok(serde_json::json!({ "success": true, "data": result }))
}

/// site:detailContent
pub fn handle_site_detail_content(state: &State<'_, AppState>, site_key: String, ids: Vec<String>) -> Result<Value, AppError> {
    let spider = create_spider(state, &site_key)?;
    let result = block_on(spider.detail_content(&ids))?;
    Ok(serde_json::json!({ "success": true, "data": result }))
}

/// site:searchContent
pub fn handle_site_search_content(
    state: &State<'_, AppState>, site_key: String, keyword: String, quick: bool, pg: Option<String>,
) -> Result<Value, AppError> {
    let spider = create_spider(state, &site_key)?;
    let result = block_on(spider.search_content(&keyword, quick, pg.as_deref()))?;
    Ok(serde_json::json!({ "success": true, "data": result }))
}

/// site:playerContent
pub fn handle_site_player_content(
    state: &State<'_, AppState>, site_key: String, flag: String, id: String, vip_flags: Vec<String>,
) -> Result<Value, AppError> {
    let spider = create_spider(state, &site_key)?;
    let result = block_on(spider.player_content(&flag, &id, &vip_flags))?;
    Ok(serde_json::json!({ "success": true, "data": result }))
}

/// site:probe
pub fn handle_site_probe(state: &State<'_, AppState>, site_keys: Vec<String>) -> Result<Value, AppError> {
    let rt = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(e) => return Err(AppError::internal("创建运行时失败").with_internal(e.to_string())),
    };

    for site_key in &site_keys {
        let spider = match create_spider(state, site_key) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let result = match rt.block_on(spider.home_content(true)) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let has_content = result.class.as_ref().map(|c| !c.is_empty()).unwrap_or(false)
            || result.list.as_ref().map(|l| !l.is_empty()).unwrap_or(false);
        if has_content {
            return Ok(serde_json::json!({
                "success": true, "data": { "siteKey": site_key, "result": result }
            }));
        }
    }

    Ok(serde_json::json!({ "success": false, "error": "所有站点均不可用" }))
}

/// site:superParse
pub fn handle_site_super_parse(_state: &State<'_, AppState>, _params: Value) -> Result<Value, AppError> {
    Err(AppError::unsupported("SuperParse 尚未迁移到 Rust"))
}

/// site:findAcrossSites
pub fn handle_site_find_across_sites(_state: &State<'_, AppState>, _keyword: String, _options: Option<Value>) -> Result<Value, AppError> {
    Err(AppError::unsupported("跨站搜索尚未迁移到 Rust"))
}
