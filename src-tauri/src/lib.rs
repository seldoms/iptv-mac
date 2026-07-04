mod commands;
mod config;
mod database;
mod epg;
mod error;
mod hls;
mod live;
mod local_proxy;
mod logging;
mod network;
mod path_safety;
mod spider;
mod super_parse;

use std::sync::LazyLock;
use std::{fs, path::PathBuf, time::SystemTime};

use parking_lot::Mutex;
use serde_json::{json, Map, Value};
use tauri::{Manager, State};

use database::Database;
use error::AppError;

/// 全局共享的 Tokio 运行时，避免每个同步命令重复创建。
/// 用 LazyLock 延迟初始化，仅创建一次。
static SHARED_RUNTIME: LazyLock<tokio::runtime::Runtime> = LazyLock::new(|| {
    tokio::runtime::Runtime::new().expect("初始化 Tokio 运行时失败")
});

/// 在共享运行时上同步阻塞异步任务。
/// 用于 Tauri 同步 command 中需要调用 async 函数的场景。
pub fn block_on<F: std::future::Future<Output = T>, T>(fut: F) -> T {
    SHARED_RUNTIME.block_on(fut)
}

const MAX_SETTINGS_FILE_SIZE: u64 = 1 * 1024 * 1024; // 1MB
const MAX_SETTINGS_VALUE_SIZE: usize = 100 * 1024; // 100KB
const MAX_SETTINGS_KEY_LENGTH: usize = 100;
const ALPHA_PLAYBACK_SMOKE_KEY: &str = "__alphaPlaybackSmoke";
const BETA_CONTINUE_SMOKE_KEY: &str = "__betaContinueSmoke";
const DEFAULT_ALPHA_PLAYBACK_SMOKE_MEDIA_URL: &str =
    "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

pub struct AppState {
    pub database: Mutex<Database>,
    pub config_manager: Mutex<config::ConfigManager>,
    pub current_config: Mutex<Option<(String, Value)>>,
    pub settings_path: PathBuf,
    pub settings: Mutex<Map<String, Value>>,
    pub player_state: Mutex<Option<Value>>,
    pub local_proxy: local_proxy::LocalProxyInfo,
    pub data_dir: PathBuf,
}

/// 加载设置。
/// 注意：设置以明文 JSON 存储（`settings.json`），
/// 不包含敏感数据（无 token/密码/密钥仅存储 UI 偏好和播放状态）。
/// 如需存储敏感凭证，应使用数据库加密字段。
fn load_settings(path: &PathBuf) -> Map<String, Value> {
    match fs::read_to_string(path) {
        Ok(text) => {
            if text.len() > MAX_SETTINGS_FILE_SIZE as usize {
                corrupt_settings_backup(path);
                return Map::new();
            }
            match serde_json::from_str::<Map<String, Value>>(&text) {
                Ok(map) => map,
                Err(_) => {
                    corrupt_settings_backup(path);
                    Map::new()
                }
            }
        }
        Err(_) => Map::new(),
    }
}

fn corrupt_settings_backup(path: &PathBuf) {
    let timestamp = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let backup = path.with_extension(format!("json.backup-{}", timestamp));
    let _ = fs::copy(path, &backup);
    let _ = fs::remove_file(path);
}

fn persist_settings(state: &AppState) -> Result<(), String> {
    let text =
        serde_json::to_string_pretty(&*state.settings.lock()).map_err(|error| error.to_string())?;
    if text.len() > MAX_SETTINGS_FILE_SIZE as usize {
        return Err("设置文件大小超过限制".to_string());
    }
    let temporary_path = state.settings_path.with_extension("json.tmp");
    fs::write(&temporary_path, text).map_err(|error| error.to_string())?;
    fs::rename(temporary_path, &state.settings_path).map_err(|error| error.to_string())
}

#[cfg(debug_assertions)]
fn debug_data_dir_override() -> Option<PathBuf> {
    std::env::var_os("IPTV_TEST_DATA_DIR").map(PathBuf::from)
}

#[cfg(not(debug_assertions))]
fn debug_data_dir_override() -> Option<PathBuf> {
    None
}

fn inject_alpha_playback_smoke_settings(settings: &mut Map<String, Value>) {
    if std::env::var("IPTV_ALPHA_PLAYBACK_SMOKE").ok().as_deref() != Some("1") {
        return;
    }

    let media_url = std::env::var("IPTV_ALPHA_PLAYBACK_SMOKE_MEDIA_URL")
        .unwrap_or_else(|_| DEFAULT_ALPHA_PLAYBACK_SMOKE_MEDIA_URL.to_string());
    let timeout_ms = std::env::var("IPTV_ALPHA_PLAYBACK_SMOKE_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(20_000);

    settings.insert(
        ALPHA_PLAYBACK_SMOKE_KEY.to_string(),
        json!({
            "enabled": true,
            "mediaUrl": media_url,
            "timeoutMs": timeout_ms
        }),
    );
    settings.remove("__alphaPlaybackSmokeResult");
}

fn inject_beta_continue_smoke_settings(settings: &mut Map<String, Value>) {
    if std::env::var("IPTV_BETA_CONTINUE_SMOKE").ok().as_deref() != Some("1") {
        return;
    }

    let phase =
        std::env::var("IPTV_BETA_CONTINUE_SMOKE_PHASE").unwrap_or_else(|_| "seed".to_string());
    let position_seconds = std::env::var("IPTV_BETA_CONTINUE_SMOKE_POSITION_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(372);
    let tolerance_seconds = std::env::var("IPTV_BETA_CONTINUE_SMOKE_TOLERANCE_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(20);

    settings.insert(
        BETA_CONTINUE_SMOKE_KEY.to_string(),
        json!({
            "enabled": true,
            "phase": if phase == "validate" { "validate" } else { "seed" },
            "positionSeconds": position_seconds,
            "toleranceSeconds": tolerance_seconds
        }),
    );
    settings.remove("__betaContinueSmokeResult");
}

pub fn build_live_tree(channels: Vec<Value>) -> Value {
    let mut countries: Vec<Value> = Vec::new();
    let mut country_index: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    let mut category_map: Vec<std::collections::HashMap<String, Vec<Value>>> = Vec::new();

    for ch in channels {
        let country = ch["country"].as_str().unwrap_or("").to_string();
        let category = ch["category"].as_str().unwrap_or("").to_string();

        let country_idx = match country_index.get(&country) {
            Some(&idx) => idx,
            None => {
                let idx = countries.len();
                country_index.insert(country.clone(), idx);
                countries.push(json!({ "name": country, "categories": [] }));
                category_map.push(std::collections::HashMap::new());
                idx
            }
        };

        let cat_map = &mut category_map[country_idx];
        let channels_list = cat_map.entry(category.clone()).or_insert_with(Vec::new);
        channels_list.push(json!({
            "name": ch["name"],
            "urls": ch["urls"],
            "bestUrl": ch["best_url"],
            "latency": ch["latency"],
            "country": ch["country"],
            "category": ch["category"],
            "sortOrder": ch["sort_order"],
            "originalGroups": ch["original_groups"]
        }));
    }

    for (country_idx, country_val) in countries.iter_mut().enumerate() {
        let cat_map = &category_map[country_idx];
        let mut categories: Vec<Value> = cat_map
            .iter()
            .map(|(name, channels)| json!({ "name": name, "channels": channels }))
            .collect();
        categories.sort_by(|a, b| {
            a["name"]
                .as_str()
                .unwrap_or("")
                .cmp(b["name"].as_str().unwrap_or(""))
        });
        country_val["categories"] = Value::Array(categories);
    }

    countries.sort_by(|a, b| {
        a["name"]
            .as_str()
            .unwrap_or("")
            .cmp(b["name"].as_str().unwrap_or(""))
    });

    json!({ "countries": countries })
}

// ==================== 兼容性 invoke_ipc 分发 ====================

fn arg<'a>(args: &'a [Value], index: usize, name: &str) -> Result<&'a Value, String> {
    args.get(index)
        .ok_or_else(|| format!("missing argument: {name}"))
}

fn text_arg(args: &[Value], index: usize, name: &str) -> Result<String, String> {
    arg(args, index, name)?
        .as_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("invalid argument: {name}"))
}

fn number_arg(args: &[Value], index: usize, name: &str) -> Result<f64, String> {
    arg(args, index, name)?
        .as_f64()
        .ok_or_else(|| format!("invalid argument: {name}"))
}

/// 将 typed command 的 AppError 转为 invoke_ipc 的 Ok(json)
fn to_json_result(result: Result<Value, AppError>) -> Value {
    match result {
        Ok(value) => value,
        Err(error) => error.to_response(),
    }
}

#[tauri::command]
fn invoke_ipc(
    channel: String,
    args: Vec<Value>,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    let result = match channel.as_str() {
        // Config
        "config:getCurrent" => Ok(to_json_result(commands::handle_config_get_current(&state))),
        "config:getCurrentUrl" => Ok(to_json_result(commands::handle_config_get_current_url(
            &state,
        ))),
        "config:list" => Ok(to_json_result(commands::handle_config_list(&state))),
        "config:inspect" => {
            let url = text_arg(&args, 0, "url").unwrap_or_default();
            Ok(to_json_result(commands::handle_config_inspect(&state, url)))
        }
        "config:load" => {
            let url = text_arg(&args, 0, "url").unwrap_or_default();
            let name = args.get(1).and_then(Value::as_str).map(String::from);
            Ok(to_json_result(commands::handle_config_load(
                &state, url, name,
            )))
        }
        "config:remove" => {
            let url = text_arg(&args, 0, "url").unwrap_or_default();
            Ok(to_json_result(commands::handle_config_remove(&state, url)))
        }
        "config:rename" => {
            let url = text_arg(&args, 0, "url").unwrap_or_default();
            let name = text_arg(&args, 1, "name").unwrap_or_default();
            Ok(to_json_result(commands::handle_config_rename(
                &state, url, name,
            )))
        }
        "config:peekLives" => {
            let url = text_arg(&args, 0, "url").unwrap_or_default();
            Ok(to_json_result(commands::handle_config_peek_lives(
                &state, url,
            )))
        }

        // History
        "history:add" => {
            let item = arg(&args, 0, "item")?;
            Ok(to_json_result(commands::handle_history_add(&state, item)))
        }
        "history:list" => {
            let limit = args.first().and_then(Value::as_i64);
            let offset = args.get(1).and_then(Value::as_i64);
            Ok(to_json_result(commands::handle_history_list(
                &state, limit, offset,
            )))
        }
        "history:delete" => {
            let site_key = text_arg(&args, 0, "siteKey")?;
            let vod_id = text_arg(&args, 1, "vodId")?;
            Ok(to_json_result(commands::handle_history_delete(
                &state, site_key, vod_id,
            )))
        }

        // Keep
        "keep:add" => {
            let item = arg(&args, 0, "item")?;
            Ok(to_json_result(commands::handle_keep_add(&state, item)))
        }
        "keep:list" => Ok(to_json_result(commands::handle_keep_list(
            &state,
            args.first().and_then(Value::as_i64),
            args.get(1).and_then(Value::as_i64),
        ))),
        "keep:delete" => {
            let site_key = text_arg(&args, 0, "siteKey")?;
            let vod_id = text_arg(&args, 1, "vodId")?;
            Ok(to_json_result(commands::handle_keep_delete(
                &state, site_key, vod_id,
            )))
        }

        // Cache
        "cache:get" => {
            let key = text_arg(&args, 0, "key")?;
            Ok(to_json_result(commands::handle_cache_get(&state, key)))
        }
        "cache:set" => {
            let key = text_arg(&args, 0, "key")?;
            let value = text_arg(&args, 1, "value")?;
            Ok(to_json_result(commands::handle_cache_set(
                &state, key, value,
            )))
        }
        "cache:del" => {
            let key = text_arg(&args, 0, "key")?;
            Ok(to_json_result(commands::handle_cache_del(&state, key)))
        }

        // Settings
        "settings:get" => {
            let key = text_arg(&args, 0, "key")?;
            Ok(state
                .settings
                .lock()
                .get(&key)
                .cloned()
                .unwrap_or(Value::Null))
        }
        "settings:set" => {
            let key = text_arg(&args, 0, "key")?;
            if key.is_empty() || key.len() > MAX_SETTINGS_KEY_LENGTH {
                return Ok(json!({ "success": false, "error": "Invalid key" }));
            }
            let value = arg(&args, 1, "value")?.clone();
            let value_str = serde_json::to_string(&value).unwrap_or_default();
            if value_str.len() > MAX_SETTINGS_VALUE_SIZE {
                return Ok(json!({ "success": false, "error": "Value too large" }));
            }
            state.settings.lock().insert(key, value);
            persist_settings(&state)?;
            Ok(json!({ "success": true }))
        }

        // Window
        "window:savePlayerState" => {
            let player_state = arg(&args, 0, "state")?.clone();
            Ok(to_json_result(commands::handle_window_save_player_state(
                &state,
                player_state,
            )))
        }
        "window:getPlayerState" => Ok(state.player_state.lock().clone().unwrap_or(Value::Null)),
        "window:enterMiniMode" => Ok(to_json_result(commands::handle_window_enter_mini_mode(
            &app,
        ))),
        "window:resizeMiniMode" => {
            let width = number_arg(&args, 0, "width")?;
            let height = number_arg(&args, 1, "height")?;
            Ok(to_json_result(commands::handle_window_resize_mini_mode(
                &app, width, height,
            )))
        }
        "window:setFullscreen" => {
            let fullscreen = arg(&args, 0, "fullscreen")?
                .as_bool()
                .ok_or_else(|| "invalid argument: fullscreen".to_string())?;
            Ok(to_json_result(commands::handle_window_set_fullscreen(
                &app, fullscreen,
            )))
        }
        "window:exitMiniMode" => Ok(to_json_result(commands::handle_window_exit_mini_mode(&app))),

        // Live
        "live:load" => {
            let live_name = text_arg(&args, 0, "liveName").unwrap_or_default();
            Ok(to_json_result(commands::handle_live_load(
                &state, live_name,
            )))
        }
        "live:loadByUrl" => {
            let url = text_arg(&args, 0, "url").unwrap_or_default();
            let name = args.get(1).and_then(Value::as_str).map(String::from);
            Ok(to_json_result(commands::handle_live_load_by_url(
                &state, url, name,
            )))
        }
        "live:epg" => {
            let epg_url = text_arg(&args, 0, "epgUrl").unwrap_or_default();
            let channel_map = args.get(1).cloned();
            Ok(to_json_result(commands::handle_live_epg(
                epg_url,
                channel_map,
            )))
        }
        "live:refresh" => Ok(to_json_result(commands::handle_live_refresh(
            &state,
            Some(&app),
        ))),
        "live:getChannelTree" => Ok(to_json_result(commands::handle_live_get_channel_tree(
            &state,
        ))),
        "live:getRefreshStatus" => Ok(to_json_result(commands::handle_live_get_refresh_status(
            &state,
        ))),
        "live:setRefreshInterval" => {
            let minutes = arg(&args, 0, "minutes")?
                .as_i64()
                .filter(|&m| (1..=1440).contains(&m))
                .ok_or_else(|| "无效的刷新间隔，必须为 1-1440 分钟".to_string())?;
            Ok(to_json_result(commands::handle_live_set_refresh_interval(
                &state, minutes,
            )))
        }

        // Site (Spider)
        "site:homeContent" => {
            let site_key = text_arg(&args, 0, "siteKey").unwrap_or_default();
            let filter = args.get(1).and_then(Value::as_bool).unwrap_or(false);
            Ok(to_json_result(commands::handle_site_home_content(
                &state, site_key, filter,
            )))
        }
        "site:categoryContent" => {
            let site_key = text_arg(&args, 0, "siteKey").unwrap_or_default();
            let tid = text_arg(&args, 1, "tid").unwrap_or_default();
            let pg = text_arg(&args, 2, "pg").unwrap_or_default();
            let filter = args.get(3).and_then(Value::as_bool).unwrap_or(false);
            let extend = args.get(4).cloned().unwrap_or(Value::Object(Map::new()));
            Ok(to_json_result(commands::handle_site_category_content(
                &state, site_key, tid, pg, filter, extend,
            )))
        }
        "site:detailContent" => {
            let site_key = text_arg(&args, 0, "siteKey").unwrap_or_default();
            let ids: Vec<String> = args
                .get(1)
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            Ok(to_json_result(commands::handle_site_detail_content(
                &state, site_key, ids,
            )))
        }
        "site:searchContent" => {
            let site_key = text_arg(&args, 0, "siteKey").unwrap_or_default();
            let keyword = text_arg(&args, 1, "key").unwrap_or_default();
            let quick = args.get(2).and_then(Value::as_bool).unwrap_or(false);
            let pg = args.get(3).and_then(Value::as_str).map(String::from);
            Ok(to_json_result(commands::handle_site_search_content(
                &state, site_key, keyword, quick, pg,
            )))
        }
        "site:playerContent" => {
            let site_key = text_arg(&args, 0, "siteKey").unwrap_or_default();
            let flag = text_arg(&args, 1, "flag").unwrap_or_default();
            let id = text_arg(&args, 2, "id").unwrap_or_default();
            let vip_flags: Vec<String> = args
                .get(3)
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            Ok(to_json_result(commands::handle_site_player_content(
                &state, site_key, flag, id, vip_flags,
            )))
        }
        "site:probe" => {
            let site_keys: Vec<String> = args
                .get(0)
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            Ok(to_json_result(commands::handle_site_probe(
                &state, site_keys,
            )))
        }
        "site:superParse" => {
            let params = args.get(0).cloned().unwrap_or(Value::Null);
            Ok(to_json_result(commands::handle_site_super_parse(
                &state, params,
            )))
        }
        "site:findAcrossSites" => {
            let keyword = text_arg(&args, 0, "keyword").unwrap_or_default();
            let options = args.get(1).cloned();
            Ok(to_json_result(commands::handle_site_find_across_sites(
                &state, keyword, options,
            )))
        }

        // Local server
        "local:getServerInfo" => Ok(json!(state.local_proxy.clone())),
        // DLNA (stubs)
        "dlna:search" => Ok(json!({ "success": true, "data": [] })),
        "dlna:cast" | "dlna:control" => {
            Ok(json!({ "success": false, "error": "DLNA 暂未迁移到 Rust" }))
        }

        _ => Ok(json!({
            "success": false,
            "error": format!("Rust 后端尚未迁移 IPC channel: {channel}")
        })),
    };

    result
}

// ==================== 强类型 Tauri command（供前端直接调用） ====================

#[tauri::command]
fn cmd_history_add(state: State<'_, AppState>, item: Value) -> Result<Value, String> {
    commands::handle_history_add(&state, &item).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_history_list(
    state: State<'_, AppState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Value, String> {
    commands::handle_history_list(&state, limit, offset).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_history_delete(
    state: State<'_, AppState>,
    site_key: String,
    vod_id: String,
) -> Result<Value, String> {
    commands::handle_history_delete(&state, site_key, vod_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_keep_add(state: State<'_, AppState>, item: Value) -> Result<Value, String> {
    commands::handle_keep_add(&state, &item).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_keep_list(
    state: State<'_, AppState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Value, String> {
    commands::handle_keep_list(&state, limit, offset).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_keep_delete(
    state: State<'_, AppState>,
    site_key: String,
    vod_id: String,
) -> Result<Value, String> {
    commands::handle_keep_delete(&state, site_key, vod_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_cache_get(state: State<'_, AppState>, key: String) -> Result<Value, String> {
    commands::handle_cache_get(&state, key).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_cache_set(state: State<'_, AppState>, key: String, value: String) -> Result<Value, String> {
    commands::handle_cache_set(&state, key, value).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_cache_del(state: State<'_, AppState>, key: String) -> Result<Value, String> {
    commands::handle_cache_del(&state, key).map_err(|e| e.to_string())
}

#[tauri::command]
async fn cmd_live_load(state: State<'_, AppState>, live_name: String) -> Result<Value, String> {
    commands::handle_live_load_async(&state, live_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cmd_live_load_by_url(
    state: State<'_, AppState>,
    url: String,
    name: Option<String>,
) -> Result<Value, String> {
    commands::handle_live_load_by_url_async(&state, url, name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cmd_live_epg(epg_url: String, channel_map: Option<Value>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || commands::handle_live_epg(epg_url, channel_map))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_live_get_channel_tree(state: State<'_, AppState>) -> Result<Value, String> {
    commands::handle_live_get_channel_tree(&state).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_live_get_refresh_status(state: State<'_, AppState>) -> Result<Value, String> {
    commands::handle_live_get_refresh_status(&state).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_live_set_refresh_interval(
    state: State<'_, AppState>,
    minutes: i64,
) -> Result<Value, String> {
    commands::handle_live_set_refresh_interval(&state, minutes).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_live_refresh(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<Value, String> {
    commands::handle_live_refresh(&state, Some(&app)).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_site_player_content(
    state: State<'_, AppState>,
    site_key: String,
    flag: String,
    id: String,
    vip_flags: Vec<String>,
) -> Result<Value, String> {
    commands::handle_site_player_content(&state, site_key, flag, id, vip_flags)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_site_super_parse(state: State<'_, AppState>, params: Value) -> Result<Value, String> {
    commands::handle_site_super_parse(&state, params).map_err(|e| e.to_string())
}

#[tauri::command]
async fn cmd_site_find_across_sites(
    state: State<'_, AppState>,
    keyword: String,
    options: Option<Value>,
) -> Result<Value, String> {
    commands::handle_site_find_across_sites_async(&state, keyword, options)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_local_get_server_info(state: State<'_, AppState>) -> Value {
    json!(state.local_proxy.clone())
}

#[tauri::command]
fn cmd_window_save_player_state(
    state: State<'_, AppState>,
    player_state: Value,
) -> Result<Value, String> {
    commands::handle_window_save_player_state(&state, player_state).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_window_get_player_state(state: State<'_, AppState>) -> Result<Value, String> {
    commands::handle_window_get_player_state(&state).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_window_enter_mini_mode(app: tauri::AppHandle) -> Result<Value, String> {
    commands::handle_window_enter_mini_mode(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_window_exit_mini_mode(app: tauri::AppHandle) -> Result<Value, String> {
    commands::handle_window_exit_mini_mode(&app).map_err(|e| e.to_string())
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn load_settings_empty_when_file_missing() {
        let path = PathBuf::from("/nonexistent/settings.json");
        let settings = load_settings(&path);
        assert!(settings.is_empty());
    }

    #[test]
    fn load_settings_parses_valid_json() {
        let dir = std::env::temp_dir().join("iptv-settings-test");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("settings.json");
        std::fs::write(&path, r#"{"theme": "dark", "language": "zh-CN"}"#).unwrap();
        let settings = load_settings(&path);
        assert_eq!(settings.get("theme").and_then(Value::as_str), Some("dark"));
        assert_eq!(
            settings.get("language").and_then(Value::as_str),
            Some("zh-CN")
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn load_settings_backup_on_corrupt_json() {
        let dir = std::env::temp_dir().join("iptv-settings-corrupt-test");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("settings.json");
        std::fs::write(&path, r#"{corrupt json"#).unwrap();
        let settings = load_settings(&path);
        assert!(settings.is_empty());
        let has_backup = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().contains("json.backup-"));
        assert!(has_backup, "corrupted settings should create backup");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_settings_backup_on_oversized_file() {
        let dir = std::env::temp_dir().join("iptv-settings-oversize-test");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("settings.json");
        let oversized = " ".repeat(MAX_SETTINGS_FILE_SIZE as usize + 1);
        std::fs::write(&path, &oversized).unwrap();
        let settings = load_settings(&path);
        assert!(settings.is_empty());
        assert!(!path.exists(), "oversized settings file should be removed");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn persist_settings_atomic_write() {
        let dir = std::env::temp_dir().join("iptv-settings-atomic-test");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("settings.json");

        let mut settings_map = Map::new();
        settings_map.insert("theme".to_string(), Value::String("dark".to_string()));

        let state = AppState {
            database: Mutex::new(Database::open(":memory:".into()).unwrap()),
            config_manager: Mutex::new(config::ConfigManager::new(dir.clone())),
            current_config: Mutex::new(None),
            settings_path: path.clone(),
            settings: Mutex::new(settings_map),
            player_state: Mutex::new(None),
            local_proxy: local_proxy::LocalProxyInfo {
                url: "http://127.0.0.1:0".to_string(),
                token: "test".to_string(),
            },
            data_dir: dir.clone(),
        };

        persist_settings(&state).unwrap();
        assert!(path.exists());
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains(r#""theme""#));
        assert!(content.contains(r#""dark""#));
        assert!(!path.with_extension("json.tmp").exists());

        let loaded = load_settings(&path);
        assert_eq!(loaded.get("theme").and_then(Value::as_str), Some("dark"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

// ==================== Tauri 入口 ====================

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = debug_data_dir_override().unwrap_or(app.path().app_data_dir()?);
            fs::create_dir_all(&data_dir)?;
            let settings_path = data_dir.join("settings.json");
            let database =
                Database::open(data_dir.join("iptv.db")).map_err(std::io::Error::other)?;
            let local_proxy = local_proxy::start_local_proxy().map_err(std::io::Error::other)?;
            let mut settings = load_settings(&settings_path);
            inject_alpha_playback_smoke_settings(&mut settings);
            inject_beta_continue_smoke_settings(&mut settings);

            app.manage(AppState {
                database: Mutex::new(database),
                config_manager: Mutex::new(config::ConfigManager::new(data_dir.clone())),
                current_config: Mutex::new(None),
                settings: Mutex::new(settings),
                settings_path,
                player_state: Mutex::new(None),
                local_proxy,
                data_dir,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            invoke_ipc,
            cmd_history_add,
            cmd_history_list,
            cmd_history_delete,
            cmd_keep_add,
            cmd_keep_list,
            cmd_keep_delete,
            cmd_cache_get,
            cmd_cache_set,
            cmd_cache_del,
            cmd_live_load,
            cmd_live_load_by_url,
            cmd_live_epg,
            cmd_live_get_channel_tree,
            cmd_live_get_refresh_status,
            cmd_live_set_refresh_interval,
            cmd_live_refresh,
            cmd_site_player_content,
            cmd_site_super_parse,
            cmd_site_find_across_sites,
            cmd_local_get_server_info,
            cmd_window_save_player_state,
            cmd_window_get_player_state,
            cmd_window_enter_mini_mode,
            cmd_window_exit_mini_mode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running IPTV Mac");
}
