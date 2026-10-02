use serde_json::Value;
use tauri::{Manager, State};

use std::sync::Mutex;

use crate::error::AppError;
use crate::AppState;

/// 保存播放器状态
pub fn handle_window_save_player_state(
    state: &State<'_, AppState>,
    player_state: Value,
) -> Result<Value, AppError> {
    *state.player_state.lock() = Some(player_state);
    Ok(serde_json::json!({ "success": true }))
}

/// 获取播放器状态
pub fn handle_window_get_player_state(state: &State<'_, AppState>) -> Result<Value, AppError> {
    Ok(state.player_state.lock().clone().unwrap_or(Value::Null))
}

/// 进入迷你模式
/// 进入精简模式前的窗口尺寸，退出时还原（原来写死回 1280x800，会把用户自己调好的尺寸冲掉）
static PRE_MINI_SIZE: Mutex<Option<(f64, f64)>> = Mutex::new(None);

pub fn handle_window_enter_mini_mode(app: &tauri::AppHandle) -> Result<Value, AppError> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::internal("主窗口不存在"))?;
    window
        .set_always_on_top(true)
        .map_err(|e| AppError::internal(e.to_string()))?;
    window
        .set_decorations(false)
        .map_err(|e| AppError::internal(e.to_string()))?;
    if let Ok(size) = window.inner_size() {
        let scale = window.scale_factor().unwrap_or(1.0);
        let logical = size.to_logical::<f64>(scale);
        if let Ok(mut saved) = PRE_MINI_SIZE.lock() {
            *saved = Some((logical.width, logical.height));
        }
    }
    window
        .set_size(tauri::LogicalSize::new(480.0, 300.0))
        .map_err(|e| AppError::internal(e.to_string()))?;
    Ok(serde_json::json!({ "success": true }))
}

/// 按视频比例调整迷你模式窗口尺寸
pub fn handle_window_resize_mini_mode(
    app: &tauri::AppHandle,
    width: f64,
    height: f64,
) -> Result<Value, AppError> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::internal("主窗口不存在"))?;
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err(AppError::invalid_input("窗口尺寸无效"));
    }
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| AppError::internal(e.to_string()))?;
    Ok(serde_json::json!({ "success": true }))
}

/// 设置窗口全屏
pub fn handle_window_set_fullscreen(
    app: &tauri::AppHandle,
    fullscreen: bool,
) -> Result<Value, AppError> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::internal("主窗口不存在"))?;
    window
        .set_fullscreen(fullscreen)
        .map_err(|e| AppError::internal(e.to_string()))?;
    Ok(serde_json::json!({ "success": true }))
}

/// 退出迷你模式
pub fn handle_window_exit_mini_mode(app: &tauri::AppHandle) -> Result<Value, AppError> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::internal("主窗口不存在"))?;
    window
        .set_always_on_top(false)
        .map_err(|e| AppError::internal(e.to_string()))?;
    window
        .set_decorations(true)
        .map_err(|e| AppError::internal(e.to_string()))?;
    // 还原进入小窗前的尺寸；没有记录（例如直接以 mini 启动）时退回默认
    let (width, height) = PRE_MINI_SIZE
        .lock()
        .ok()
        .and_then(|mut saved| saved.take())
        .unwrap_or((1280.0, 800.0));
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| AppError::internal(e.to_string()))?;
    Ok(serde_json::json!({ "success": true }))
}

/// 把窗口装饰状态同步到当前 UI 模式，避免「UI 认为在精简模式但窗口还带着边框」这类错位
/// （错位时会出现：界面是完整的，窗口却是 480x300 无边框，拖不动也缩放不了）。
///
/// - mini：无边框 + 置顶 + 480x300，与既有精简模式一致；
/// - normal：恢复系统边框与可缩放，但**不重置窗口尺寸**，
///   避免每次启动都把用户调整过的窗口拉回 1280x800。
/// 查询窗口是否处于全屏：用户可能用系统绿灯键/手势退出全屏，
/// UI 必须能主动核对，否则会一直停在全屏布局样式上。
pub fn handle_window_is_fullscreen(app: &tauri::AppHandle) -> Result<Value, AppError> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::internal("主窗口不存在"))?;
    let fullscreen = window.is_fullscreen().unwrap_or(false);
    Ok(serde_json::json!({ "fullscreen": fullscreen }))
}

pub fn handle_window_apply_mode(app: &tauri::AppHandle, mini: bool) -> Result<Value, AppError> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::internal("主窗口不存在"))?;
    if mini {
        window
            .set_always_on_top(true)
            .map_err(|e| AppError::internal(e.to_string()))?;
        window
            .set_decorations(false)
            .map_err(|e| AppError::internal(e.to_string()))?;
        window
            .set_size(tauri::LogicalSize::new(480.0, 300.0))
            .map_err(|e| AppError::internal(e.to_string()))?;
    } else {
        window
            .set_always_on_top(false)
            .map_err(|e| AppError::internal(e.to_string()))?;
        window
            .set_decorations(true)
            .map_err(|e| AppError::internal(e.to_string()))?;
    }
    Ok(serde_json::json!({ "success": true }))
}
