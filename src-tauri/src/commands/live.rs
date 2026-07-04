use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::Value;
use tauri::Manager;
use tauri::{Emitter, State};

use crate::config::ConfigItem;
use crate::database::Database;
use crate::error::AppError;
use crate::live;
use crate::AppState;

static LIVE_REFRESH_RUNNING: AtomicBool = AtomicBool::new(false);
const MAX_REFRESH_CHANNELS_PER_LIVE: usize = 20_000;
const MAX_SPEED_TEST_URLS: usize = 200;
const CONFIG_REFRESH_TIMEOUT: Duration = Duration::from_secs(12);
const LIVE_REFRESH_TIMEOUT: Duration = Duration::from_secs(20);
const REFRESH_SOURCE_ALLOWLIST: &[&str] = &[
    "700sjro44343.vicp.fun",
    "develop202.github.io/migu_video/interface.txt",
    "raw.githubusercontent.com/develop202/migu_video",
    "Kimentanm/aptv",
    "nos.netease.com/ysf",
    "82.156.243.185:33389/fwc.m3u",
];
const SKIP_REFRESH_URL_PATTERNS: &[&str] = &["lystv/short/main", "MTV.txt"];

#[derive(Debug, Clone)]
struct RefreshChannel {
    name: String,
    urls: Vec<String>,
    origins: Vec<String>,
}

#[derive(Debug, Clone)]
struct TestedChannel {
    name: String,
    urls: Vec<String>,
    best_url: String,
    latency: i64,
    origins: Vec<String>,
}

/// 获取直播频道树
pub fn handle_live_get_channel_tree(state: &State<'_, AppState>) -> Result<Value, AppError> {
    let channels = state
        .database
        .lock()
        .get_live_tree()
        .map_err(|e| AppError::database_error(e))?;
    let list = channels.as_array().cloned().unwrap_or_default();
    Ok(crate::build_live_tree(list))
}

/// 获取刷新状态
pub fn handle_live_get_refresh_status(state: &State<'_, AppState>) -> Result<Value, AppError> {
    let db_status = state
        .database
        .lock()
        .get_refresh_status()
        .map_err(|e| AppError::database_error(e))?;
    if db_status.is_null() {
        return Ok(serde_json::json!({
            "isRefreshing": false, "lastRefreshTime": 0,
            "nextRefreshTime": 0, "progress": null, "interval": 30
        }));
    }
    Ok(serde_json::json!({
        "isRefreshing": db_status["status"] == "refreshing",
        "lastRefreshTime": db_status["last_refresh_time"],
        "nextRefreshTime": db_status["next_refresh_time"],
        "progress": null,
        "interval": db_status["refresh_interval_minutes"]
    }))
}

/// 设置刷新间隔
pub fn handle_live_set_refresh_interval(
    state: &State<'_, AppState>,
    minutes: i64,
) -> Result<Value, AppError> {
    if !(1..=1440).contains(&minutes) {
        return Err(AppError::invalid_input("刷新间隔必须为 1-1440 分钟"));
    }
    state
        .database
        .lock()
        .update_refresh_status(&serde_json::json!({ "refreshIntervalMinutes": minutes }))
        .map_err(|e| AppError::database_error(e))?;
    Ok(serde_json::json!({ "success": true }))
}

/// 加载直播源（从当前配置获取 URL 并解析）
pub async fn handle_live_load_async(
    state: &State<'_, AppState>,
    live_name: String,
) -> Result<Value, AppError> {
    let config_url = state
        .config_manager
        .lock()
        .get_current_url()
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::not_found("无当前配置"))?;

    let config = if let Some((cached_url, cached_config)) = state.current_config.lock().as_ref() {
        if cached_url == &config_url {
            cached_config.clone()
        } else {
            Value::Null
        }
    } else {
        Value::Null
    };
    let config = if config.is_null() {
        let config = crate::config::load_config_from_url(&config_url, Some(&state.data_dir))
            .await
            .map_err(|_| AppError::not_found("配置加载失败"))?;
        *state.current_config.lock() = Some((config_url.clone(), config.clone()));
        config
    } else {
        config
    };

    // 查找匹配的直播源
    let lives = config
        .get("lives")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::not_found("配置中无直播源"))?;
    let live_entry = lives
        .iter()
        .find(|l| l.get("name").and_then(Value::as_str) == Some(&live_name))
        .ok_or_else(|| AppError::not_found(format!("直播源不存在: {}", live_name)))?;

    let url = live_entry
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid_input(format!("直播源 {} 无 URL", live_name)))?;
    let url = crate::config::resolve_relative_url(&config_url, url);

    // 下载并解析
    let client = crate::network::create_client()?;
    let content = crate::network::http_get(&client, &url)
        .await
        .map_err(|e| AppError::network_error(format!("下载直播源失败: {}", e)))?;

    let groups = live::parse_live_content(&content);
    let count: usize = groups.iter().map(|g| g.channel.len()).sum();
    eprintln!(
        "[live:load] {}: {} groups, {} channels",
        live_name,
        groups.len(),
        count
    );

    Ok(serde_json::json!({ "success": true, "data": groups }))
}

pub fn handle_live_load(state: &State<'_, AppState>, live_name: String) -> Result<Value, AppError> {
    let rt = tokio::runtime::Runtime::new()
        .map_err(|e| AppError::internal("创建运行时失败").with_internal(e.to_string()))?;
    rt.block_on(handle_live_load_async(state, live_name))
}

/// 按 URL 直接加载直播源
pub async fn handle_live_load_by_url_async(
    _state: &State<'_, AppState>,
    url: String,
    _name: Option<String>,
) -> Result<Value, AppError> {
    let client = crate::network::create_client()?;
    let content = crate::network::http_get(&client, &url)
        .await
        .map_err(|e| AppError::network_error(format!("下载直播源失败: {}", e)))?;

    let groups = live::parse_live_content(&content);
    Ok(serde_json::json!({ "success": true, "data": groups }))
}

pub fn handle_live_load_by_url(
    state: &State<'_, AppState>,
    url: String,
    name: Option<String>,
) -> Result<Value, AppError> {
    let rt = tokio::runtime::Runtime::new()
        .map_err(|e| AppError::internal("创建运行时失败").with_internal(e.to_string()))?;
    rt.block_on(handle_live_load_by_url_async(state, url, name))
}

/// Emit a refresh progress event via Tauri
fn emit_progress(
    app: Option<&tauri::AppHandle>,
    phase: &str,
    current: usize,
    total: usize,
    message: Option<&str>,
) {
    let payload = serde_json::json!({
        "phase": phase,
        "current": current,
        "total": total,
        "message": message.unwrap_or(""),
    });
    if let Some(handle) = app {
        let _ = handle.emit("live:refreshProgress", payload);
    }
    let msg = message.unwrap_or("");
    eprintln!("[live:refresh] {} {}/{} {}", phase, current, total, msg);
}

/// 刷新直播源（后台异步执行，调用 tester + dedup + classifier + 保存到 DB）
pub fn handle_live_refresh(
    state: &State<'_, AppState>,
    app: Option<&tauri::AppHandle>,
) -> Result<Value, AppError> {
    if LIVE_REFRESH_RUNNING.swap(true, Ordering::SeqCst) {
        emit_progress(app, "loading", 0, 0, Some("直播刷新正在进行中..."));
        return Ok(serde_json::json!({ "success": true, "skipped": true, "reason": "refreshing" }));
    }

    // 克隆数据供后台线程使用
    let app_handle = app.cloned();
    let config_items = state.config_manager.lock().list().to_vec();
    let current_url = state
        .config_manager
        .lock()
        .get_current_url()
        .map(|s| s.to_string());

    // 后台线程执行刷新，不阻塞 UI
    std::thread::spawn(move || {
        if let Err(e) = run_live_refresh_background(config_items, current_url, app_handle.clone()) {
            eprintln!("[live:refresh] 后台刷新失败: {}", e);
            emit_progress(
                app_handle.as_ref(),
                "error",
                0,
                0,
                Some(&format!("刷新失败: {}", e)),
            );
        }
        LIVE_REFRESH_RUNNING.store(false, Ordering::SeqCst);
    });

    Ok(serde_json::json!({ "success": true }))
}

fn run_live_refresh_background(
    config_items: Vec<ConfigItem>,
    current_url: Option<String>,
    app: Option<tauri::AppHandle>,
) -> Result<Value, AppError> {
    let app_ref = app.as_ref();

    emit_progress(app_ref, "loading", 0, 0, Some("正在加载配置..."));

    // 构建 URL 列表
    let mut urls: Vec<(String, String)> = Vec::new();
    if let Some(url) = &current_url {
        urls.push(("当前配置".to_string(), url.clone()));
    }
    for item in &config_items {
        if urls.iter().any(|(_, url)| url == &item.url) {
            continue;
        }
        if should_include_config_in_refresh(&item.url) {
            urls.push((item.name.clone(), item.url.clone()));
        }
    }

    if urls.is_empty() {
        return Err(AppError::not_found("无当前配置，请先加载配置"));
    }

    // 获取数据库路径
    let data_dir = app
        .as_ref()
        .and_then(|h| h.path().app_data_dir().ok())
        .ok_or_else(|| AppError::internal("无法获取数据目录"))?;

    let rt = tokio::runtime::Runtime::new()
        .map_err(|e| AppError::internal("创建运行时失败").with_internal(e.to_string()))?;

    // 打开独立数据库连接
    let mut database =
        Database::open(data_dir.join("iptv.db")).map_err(|e| AppError::database_error(e))?;

    // 更新状态为 refreshing
    database
        .update_refresh_status(&serde_json::json!({ "status": "refreshing" }))
        .map_err(|e| AppError::database_error(e))?;

    let channels = rt.block_on(load_all_live_channels_from_urls(&urls, app_ref))?;
    let total_urls: usize = channels.iter().map(|channel| channel.urls.len()).sum();
    if channels.is_empty() || total_urls == 0 {
        emit_progress(
            app_ref,
            "error",
            0,
            0,
            Some("无可用的直播频道，请检查配置中是否包含直播源"),
        );
        database
            .update_refresh_status(
                &serde_json::json!({ "status": "idle", "totalChannels": 0, "aliveChannels": 0 }),
            )
            .map_err(|e| AppError::database_error(e))?;
        return Err(AppError::not_found(
            "无可用直播源，请先添加包含 lives 的配置或直播源直链",
        ));
    }

    emit_progress(
        app_ref,
        "testing",
        0,
        total_urls,
        Some(&format!("正在测速 {} 条线路...", total_urls)),
    );
    let tested_channels = rt.block_on(test_and_merge_channels(channels, app_ref))?;

    emit_progress(
        app_ref,
        "classifying",
        0,
        tested_channels.len(),
        Some("正在分类..."),
    );

    let mut db_channels: Vec<serde_json::Value> = Vec::new();
    for ch in &tested_channels {
        let (country, category, sort_order) = live::classify_channel(&ch.name);
        let country_str = format!("{:?}", country);
        db_channels.push(serde_json::json!({
            "name": ch.name,
            "urls": ch.urls,
            "bestUrl": ch.best_url,
            "country": country_str,
            "category": category,
            "sortOrder": sort_order,
            "latency": ch.latency,
            "originalGroups": ch.origins,
            "isAlive": 1,
        }));
    }

    emit_progress(
        app_ref,
        "saving",
        0,
        db_channels.len(),
        Some("正在保存到数据库..."),
    );

    let alive = db_channels.len();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let refresh_interval_minutes = database
        .get_refresh_status()
        .ok()
        .and_then(|status| status["refresh_interval_minutes"].as_i64())
        .filter(|minutes| (1..=1440).contains(minutes))
        .unwrap_or(30);

    database
        .save_live_channels(&db_channels)
        .map_err(|e| AppError::database_error(e))?;
    database
        .update_refresh_status(&serde_json::json!({
            "status": "idle",
            "lastRefreshTime": now,
            "nextRefreshTime": now + refresh_interval_minutes * 60,
            "totalChannels": total_urls,
            "aliveChannels": alive,
        }))
        .map_err(|e| AppError::database_error(e))?;

    emit_progress(
        app_ref,
        "done",
        alive,
        total_urls,
        Some(&format!(
            "完成: {} 个频道可用，{} 条线路已测速",
            alive, total_urls
        )),
    );
    Ok(serde_json::json!({ "success": true }))
}

async fn load_all_live_channels_from_urls(
    urls: &[(String, String)],
    app: Option<&tauri::AppHandle>,
) -> Result<Vec<RefreshChannel>, AppError> {
    let client = crate::network::create_client()?;
    let mut all_channels = Vec::new();
    for (idx, (config_name, config_url)) in urls.iter().enumerate() {
        emit_progress(
            app,
            "loading",
            idx + 1,
            urls.len(),
            Some(&format!("加载配置: {}", config_name)),
        );

        let config =
            match tokio::time::timeout(CONFIG_REFRESH_TIMEOUT, load_config_for_refresh(config_url))
                .await
            {
                Ok(Ok(config)) => config,
                Ok(Err(error)) => {
                    eprintln!("[live:refresh] 配置加载失败 [{}]: {}", config_url, error);
                    continue;
                }
                Err(_) => {
                    eprintln!("[live:refresh] 配置加载超时 [{}]", config_url);
                    continue;
                }
            };

        let Some(lives) = config.get("lives").and_then(Value::as_array) else {
            continue;
        };
        for live_entry in lives {
            let live_name = live_entry
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("未命名直播源");
            let Some(live_url) = live_entry.get("url").and_then(Value::as_str) else {
                continue;
            };
            let live_url = crate::config::resolve_relative_url(config_url, live_url);
            if should_skip_live_in_refresh(&live_url) {
                eprintln!(
                    "[live:refresh] 跳过超大直播源 [{} / {}]: {}",
                    config_name, live_name, live_url
                );
                continue;
            }
            let content = match tokio::time::timeout(
                LIVE_REFRESH_TIMEOUT,
                crate::network::http_get(&client, &live_url),
            )
            .await
            {
                Ok(Ok(content)) => content,
                Ok(Err(error)) => {
                    eprintln!("[live:refresh] 直播源下载失败 [{}]: {}", live_url, error);
                    continue;
                }
                Err(_) => {
                    eprintln!("[live:refresh] 直播源下载超时 [{}]", live_url);
                    continue;
                }
            };
            let groups = live::parse_live_content(&content);
            let channel_count: usize = groups.iter().map(|group| group.channel.len()).sum();
            if channel_count > MAX_REFRESH_CHANNELS_PER_LIVE {
                eprintln!(
                    "[live:refresh] 跳过频道数过大的直播源 [{} / {}]: {} channels url={}",
                    config_name, live_name, channel_count, live_url
                );
                continue;
            }
            for group in groups {
                let origin = format!("{} / {} / {}", config_name, live_name, group.name);
                for channel in group.channel {
                    if channel.urls.is_empty() {
                        continue;
                    }
                    all_channels.push(RefreshChannel {
                        name: channel.name,
                        urls: channel.urls,
                        origins: vec![origin.clone()],
                    });
                }
            }
        }
    }

    Ok(all_channels)
}

fn should_skip_live_in_refresh(url: &str) -> bool {
    SKIP_REFRESH_URL_PATTERNS
        .iter()
        .any(|pattern| url.contains(pattern))
}

fn should_include_config_in_refresh(url: &str) -> bool {
    REFRESH_SOURCE_ALLOWLIST
        .iter()
        .any(|pattern| url.contains(pattern))
}

async fn load_config_for_refresh(url: &str) -> Result<Value, AppError> {
    let client = crate::network::create_client()?;
    let text = crate::network::http_get(&client, url).await?;
    match crate::config::parse_config_or_live_source(url, &text) {
        Ok(config) => Ok(config),
        Err(error) => {
            if let Some(fallback_url) = crate::config::github_raw_fallback_url(url) {
                let fallback_text = crate::network::http_get(&client, &fallback_url).await?;
                crate::config::parse_config_or_live_source(&fallback_url, &fallback_text)
            } else {
                Err(error)
            }
        }
    }
}

async fn test_and_merge_channels(
    channels: Vec<RefreshChannel>,
    app: Option<&tauri::AppHandle>,
) -> Result<Vec<TestedChannel>, AppError> {
    let mut merged_by_name: HashMap<String, RefreshChannel> = HashMap::new();

    for channel in channels {
        let key = live::normalize_name(&channel.name);
        let entry = merged_by_name.entry(key).or_insert_with(|| RefreshChannel {
            name: channel.name.clone(),
            urls: Vec::new(),
            origins: Vec::new(),
        });
        for url in channel.urls {
            if !entry.urls.contains(&url) {
                entry.urls.push(url);
            }
        }
        for origin in channel.origins {
            if !entry.origins.contains(&origin) {
                entry.origins.push(origin);
            }
        }
    }

    let mut tested = Vec::new();
    let total_urls: usize = merged_by_name
        .values()
        .filter(|channel| channel.urls.len() > 1)
        .map(|channel| channel.urls.len())
        .sum();
    let mut current = 0usize;

    if total_urls > MAX_SPEED_TEST_URLS {
        emit_progress(
            app,
            "testing",
            0,
            total_urls,
            Some(&format!(
                "线路较多，跳过全量测速，先保存 {} 条候选线路",
                total_urls
            )),
        );
        for channel in merged_by_name.into_values() {
            if channel.urls.is_empty() {
                continue;
            }
            tested.push(TestedChannel {
                name: channel.name,
                best_url: channel.urls[0].clone(),
                urls: channel.urls,
                latency: -1,
                origins: channel.origins,
            });
        }
        tested.sort_by(|a, b| a.name.cmp(&b.name));
        return Ok(tested);
    }

    for channel in merged_by_name.into_values() {
        if channel.urls.len() == 1 {
            tested.push(TestedChannel {
                name: channel.name,
                best_url: channel.urls[0].clone(),
                urls: channel.urls,
                latency: -1,
                origins: channel.origins,
            });
            continue;
        }

        let mut results = Vec::new();
        let mut pending = Vec::new();
        for url in &channel.urls {
            let url = url.clone();
            pending.push(tokio::spawn(
                async move { live::test_url(&url, 5000).await },
            ));
        }

        for task in pending {
            current += 1;
            if let Ok(result) = task.await {
                results.push(result);
            }
            if total_urls > 0 && (current == 1 || current % 25 == 0 || current == total_urls) {
                emit_progress(
                    app,
                    "testing",
                    current,
                    total_urls,
                    Some(&format!("正在测速 ({}/{})", current, total_urls)),
                );
            }
        }

        let alive_by_url = best_alive_results(results);
        if alive_by_url.is_empty() {
            continue;
        }
        let urls: Vec<String> = alive_by_url
            .iter()
            .map(|result| result.url.clone())
            .collect();
        let best = alive_by_url.first().expect("checked non-empty");
        tested.push(TestedChannel {
            name: channel.name,
            urls,
            best_url: best.url.clone(),
            latency: best.latency,
            origins: channel.origins,
        });
    }

    tested.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(tested)
}

fn best_alive_results(mut results: Vec<live::TestResult>) -> Vec<live::TestResult> {
    let mut seen = HashSet::new();
    results.retain(|result| result.alive && seen.insert(result.url.clone()));
    results.sort_by(|a, b| match (a.latency, b.latency) {
        (-1, -1) => std::cmp::Ordering::Equal,
        (-1, _) => std::cmp::Ordering::Greater,
        (_, -1) => std::cmp::Ordering::Less,
        _ => a.latency.cmp(&b.latency),
    });
    results
}

/// 获取 EPG
pub async fn handle_live_epg_async(
    epg_url: String,
    channel_map: Option<Value>,
) -> Result<Value, AppError> {
    if epg_url.is_empty() {
        return Ok(serde_json::json!({ "success": true, "data": [] }));
    }

    let channel_map: Option<HashMap<String, Value>> = channel_map
        .and_then(|v| v.as_object().cloned())
        .map(|obj| obj.into_iter().collect());

    let channels = crate::epg::get_epg_data(&epg_url, channel_map.as_ref()).await?;

    Ok(serde_json::json!({ "success": true, "data": channels }))
}

pub fn handle_live_epg(epg_url: String, channel_map: Option<Value>) -> Result<Value, AppError> {
    let rt = tokio::runtime::Runtime::new()
        .map_err(|e| AppError::internal("创建运行时失败").with_internal(e.to_string()))?;
    rt.block_on(handle_live_epg_async(epg_url, channel_map))
}
