use serde_json::Value;
use tauri::{Manager, State};

use crate::error::AppError;
use crate::AppState;

/// 保存播放器状态
pub fn handle_window_save_player_state(state: &State<'_, AppState>, player_state: Value) -> Result<Value, AppError> {
    *state.player_state.lock() = Some(player_state);
    Ok(serde_json::json!({ "success": true }))
}

/// 获取播放器状态
pub fn handle_window_get_player_state(state: &State<'_, AppState>) -> Result<Value, AppError> {
    Ok(state.player_state.lock().clone().unwrap_or(Value::Null))
}

/// 进入迷你模式
pub fn handle_window_enter_mini_mode(app: &tauri::AppHandle) -> Result<Value, AppError> {
    let window = app.get_webview_window("main")
        .ok_or_else(|| AppError::internal("主窗口不存在"))?;
    window.set_always_on_top(true).map_err(|e| AppError::internal(e.to_string()))?;
    window.set_decorations(false).map_err(|e| AppError::internal(e.to_string()))?;
    window.set_size(tauri::LogicalSize::new(480.0, 300.0)).map_err(|e| AppError::internal(e.to_string()))?;
    Ok(serde_json::json!({ "success": true }))
}

/// 退出迷你模式
pub fn handle_window_exit_mini_mode(app: &tauri::AppHandle) -> Result<Value, AppError> {
    let window = app.get_webview_window("main")
        .ok_or_else(|| AppError::internal("主窗口不存在"))?;
    window.set_always_on_top(false).map_err(|e| AppError::internal(e.to_string()))?;
    window.set_decorations(true).map_err(|e| AppError::internal(e.to_string()))?;
    window.set_size(tauri::LogicalSize::new(1280.0, 800.0)).map_err(|e| AppError::internal(e.to_string()))?;
    Ok(serde_json::json!({ "success": true }))
}
