use serde_json::Value;
use tauri::State;

use crate::error::AppError;
use crate::AppState;

/// 添加历史记录
pub fn handle_history_add(state: &State<'_, AppState>, item: &Value) -> Result<Value, AppError> {
    state.database.lock().add_history(item)?;
    Ok(serde_json::json!({ "success": true }))
}

/// 获取历史记录列表
pub fn handle_history_list(
    state: &State<'_, AppState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Value, AppError> {
    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);
    state
        .database
        .lock()
        .history_list(limit, offset)
        .map_err(|e| AppError::database_error(e))
}

/// 删除历史记录
pub fn handle_history_delete(
    state: &State<'_, AppState>,
    site_key: String,
    vod_id: String,
) -> Result<Value, AppError> {
    state.database.lock().delete_history(&site_key, &vod_id)?;
    Ok(serde_json::json!({ "success": true }))
}
