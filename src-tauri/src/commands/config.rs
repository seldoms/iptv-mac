use serde_json::Value;
use tauri::State;

use crate::error::AppError;
use crate::AppState;

/// 获取当前配置
pub fn handle_config_get_current(state: &State<'_, AppState>) -> Result<Value, AppError> {
    let url = state
        .config_manager
        .lock()
        .get_current_url()
        .map(|s| s.to_string());
    if let Some(url) = url {
        // 异步加载，这里做简单同步获取
        // 完整实现需要迁移到异步 command
        let mgr = state.config_manager.lock();
        let rt = tokio::runtime::Runtime::new()
            .map_err(|e| AppError::internal("创建运行时失败").with_internal(e.to_string()))?;
        match rt.block_on(mgr.load_from_url(&url)) {
            Ok(config) => Ok(config),
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
    let mgr = state.config_manager.lock();
    let rt = tokio::runtime::Runtime::new()
        .map_err(|e| AppError::internal("创建运行时失败").with_internal(e.to_string()))?;

    match rt.block_on(mgr.load_from_url(&url)) {
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
            if sites == 0 && lives == 0 {
                warnings.push("配置中没有可用站点或直播源".to_string());
            }
            if source_type == "live" {
                warnings.push("已识别为直播源直链，将作为单个直播源加载".to_string());
            }

            let visible_sites = config
                .get("sites")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter(|s| {
                            let t = s.get("type").and_then(Value::as_i64).unwrap_or(0);
                            t == 0 || t == 1 || t == 4
                        })
                        .count() as i64
                })
                .unwrap_or(0);

            let searchable_sites = config
                .get("sites")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter(|s| s.get("searchable").and_then(Value::as_i64) != Some(0))
                        .count() as i64
                })
                .unwrap_or(0);

            let unsupported_sites = config
                .get("sites")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter(|s| s.get("type").and_then(Value::as_i64).unwrap_or(0) == 3)
                        .count() as i64
                })
                .unwrap_or(0);

            if unsupported_sites > 0 {
                warnings.push(format!(
                    "包含 {} 个暂不支持的 CSP Jar 站点",
                    unsupported_sites
                ));
            }

            let name = config
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
    let rt = tokio::runtime::Runtime::new()
        .map_err(|e| AppError::internal("创建运行时失败").with_internal(e.to_string()))?;

    let config = {
        let mgr = state.config_manager.lock();
        rt.block_on(mgr.load_from_url(&url))?
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

    // 返回配置数据
    Ok(serde_json::json!({ "success": true, "data": config }))
}

/// 删除配置
pub fn handle_config_remove(state: &State<'_, AppState>, url: String) -> Result<Value, AppError> {
    state.config_manager.lock().remove(&url)?;
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
    let rt = tokio::runtime::Runtime::new()
        .map_err(|e| AppError::internal("创建运行时失败").with_internal(e.to_string()))?;

    match rt.block_on(mgr.load_from_url(&url)) {
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
