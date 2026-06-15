use serde_json::Value;
use tauri::State;

use crate::error::AppError;
use crate::AppState;

/// 获取缓存
pub fn handle_cache_get(state: &State<'_, AppState>, key: String) -> Result<Value, AppError> {
    state.database.lock().get_cache(&key).map_err(|e| AppError::database_error(e))
}

/// 设置缓存
pub fn handle_cache_set(state: &State<'_, AppState>, key: String, value: String) -> Result<Value, AppError> {
    if value.len() > 5 * 1024 * 1024 {
        return Ok(serde_json::json!({ "success": false, "error": "缓存值超过 5MB 限制" }));
    }
    state.database.lock().set_cache(&key, &value)?;
    Ok(serde_json::json!({ "success": true }))
}

/// 删除缓存
pub fn handle_cache_del(state: &State<'_, AppState>, key: String) -> Result<Value, AppError> {
    state.database.lock().delete_cache(&key)?;
    Ok(serde_json::json!({ "success": true }))
}
