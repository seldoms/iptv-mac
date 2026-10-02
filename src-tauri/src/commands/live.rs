use futures_util::stream::{self, FuturesUnordered};
use futures_util::StreamExt;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;

use serde_json::Value;
use tauri::Manager;
use tauri::{Emitter, State};

use crate::config::ConfigItem;
use crate::database::Database;
use crate::error::AppError;
use crate::live;
use crate::logging::redact_text;
use crate::AppState;

static LIVE_REFRESH_RUNNING: AtomicBool = AtomicBool::new(false);
static LIVE_REFRESH_REQUESTED: AtomicBool = AtomicBool::new(true);
const LIVE_LIBRARY_CACHE_KEY: &str = "live:library:v1";
const MAX_REFRESH_CHANNELS_PER_LIVE: usize = 20_000;
const CONFIG_REFRESH_TIMEOUT: Duration = Duration::from_secs(12);
/// 单条线路的探测超时。原来写死 3s，慢速直播源会被误判「不可用」——实测同一批频道
/// 用 3s 大面积判死、用 8s 全部可播，而 UI 会把判死显示成「无信号」。
const LIVE_PROBE_TIMEOUT_MS: u64 = 8000;
/// 探测结果有效期：这段时间内不重复测（增量刷新）。全量重测 2 万条既慢又必然被中断。
const LIVE_PROBE_TTL_SECS: i64 = 30 * 60;
/// 「探测不通」的结论只保留 5 分钟：直播源时好时坏，判死缓存半小时会让
/// 明明能播的频道长时间显示「无信号」（用户反馈：显示无信号、双击却能打开）。
const LIVE_PROBE_DEAD_TTL_SECS: i64 = 5 * 60;
/// 单次刷新的探测时间预算：到点就停、剩下的下次再测，保证刷新一定能收尾（不再卡 refreshing）。
const LIVE_PROBE_BUDGET_SECS: u64 = 180;
/// 每台主机最多同时探测几条：同一源站几十上百个频道一起打，会把对方打到超时，反而误判成不可用。
const PER_HOST_CONCURRENCY: usize = 2;
/// 自适应并发（AIMD）：成功逐步加，连续超时/失败就减半
const PROBE_CONCURRENCY_START: usize = 8;
const PROBE_CONCURRENCY_MIN: usize = 4;
const PROBE_CONCURRENCY_MAX: usize = 20;
/// 未探测哨兵：-2 表示「还没测过」，-1 才是「测过但不通」。
/// 两者必须区分，否则刷新未跑完时整列表都会显示成不可用。
const LATENCY_UNPROBED: i64 = -2;
const LATENCY_DEAD: i64 = -1;
const LIVE_REFRESH_TIMEOUT: Duration = Duration::from_secs(20);
const SKIP_REFRESH_URL_PATTERNS: &[&str] = &["lystv/short/main", "MTV.txt"];

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct LiveLine {
    url: String,
    header: HashMap<String, String>,
    latency: i64,
    alive: bool,
    /// 上次探测时间（epoch 秒）；0 = 从未探测。用于增量刷新与「何时测的」展示
    #[serde(default)]
    tested_at: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct RefreshChannel {
    name: String,
    urls: Vec<String>,
    origins: Vec<String>,
    headers: HashMap<String, HashMap<String, String>>,
    #[serde(default)]
    lines: Vec<LiveLine>,
}

#[derive(Default)]
struct LoadedChannels {
    channels: Vec<RefreshChannel>,
    partial_failure: bool,
}

#[derive(Debug, Clone)]
struct TestedChannel {
    name: String,
    urls: Vec<String>,
    best_url: String,
    latency: i64,
    origins: Vec<String>,
    headers: HashMap<String, HashMap<String, String>>,
    lines: Vec<LiveLine>,
}

/// 把一次真实播放结果应用到快照行上（纯函数，便于单测）。返回被更新的线路数。
fn apply_playback_result(
    rows: &mut [Value],
    urls: &[String],
    alive: bool,
    latency_ms: Option<i64>,
    now: i64,
) -> usize {
    let latency = if alive { latency_ms.unwrap_or(0).max(0) } else { LATENCY_DEAD };
    let mut updated = 0usize;
    for row in rows.iter_mut() {
        let mut touched = false;
        if let Some(lines) = row.get_mut("lines").and_then(Value::as_array_mut) {
            for line in lines.iter_mut() {
                let matches = line
                    .get("url")
                    .and_then(Value::as_str)
                    .map(|line_url| urls.iter().any(|candidate| candidate == line_url))
                    .unwrap_or(false);
                if !matches {
                    continue;
                }
                line["alive"] = serde_json::json!(alive);
                line["latency"] = serde_json::json!(latency);
                line["tested_at"] = serde_json::json!(now);
                touched = true;
                updated += 1;
            }
        }
        if !touched {
            continue;
        }
        let lines = row
            .get("lines")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let best = lines
            .iter()
            .filter(|line| line.get("alive").and_then(Value::as_bool).unwrap_or(false))
            .filter_map(|line| line.get("latency").and_then(Value::as_i64))
            .min();
        let any_tested = lines
            .iter()
            .any(|line| line.get("tested_at").and_then(Value::as_i64).unwrap_or(0) > 0);
        row["latency"] = serde_json::json!(best.unwrap_or(if any_tested {
            LATENCY_DEAD
        } else {
            LATENCY_UNPROBED
        }));
        if let Some(best_latency) = best {
            let best_url = lines
                .iter()
                .find(|line| {
                    line.get("alive").and_then(Value::as_bool).unwrap_or(false)
                        && line.get("latency").and_then(Value::as_i64) == Some(best_latency)
                })
                .and_then(|line| line.get("url").and_then(Value::as_str))
                .map(str::to_string);
            if let Some(best_url) = best_url {
                row["bestUrl"] = serde_json::json!(best_url);
            }
        }
    }
    updated
}

/// 播放结果回写：真实播放是最高优先级的证据。
///
/// 探测会因超时、嗅探条件、被 UA/防盗链挡住而把**其实能播**的线路判死；用户看到的就是
/// 「显示无信号，双击一下却能打开」。这里用真实播放结果覆盖快照里的状态并刷新 `tested_at`，
/// 顺带重算频道级状态（有可达线路取最快，否则 -1；完全没测过才算 -2）。
pub fn handle_live_report_line_result(
    state: &State<'_, AppState>,
    urls: Vec<String>,
    alive: bool,
    latency_ms: Option<i64>,
) -> Result<Value, AppError> {
    if urls.is_empty() {
        return Ok(serde_json::json!({ "success": true, "updated": 0 }));
    }
    let mut database = state.database.lock();
    let now = now_secs();

    let Ok(Value::String(snapshot)) = database.get_cache(LIVE_LIBRARY_CACHE_KEY) else {
        return Ok(serde_json::json!({ "success": true, "updated": 0 }));
    };
    let Ok(mut rows) = serde_json::from_str::<Vec<Value>>(&snapshot) else {
        return Ok(serde_json::json!({ "success": true, "updated": 0 }));
    };

    let updated = apply_playback_result(&mut rows, &urls, alive, latency_ms, now);

    if updated > 0 {
        database
            .set_cache(LIVE_LIBRARY_CACHE_KEY, &serde_json::to_string(&rows)?)
            .map_err(|error| AppError::database_error(error))?;
    }
    Ok(serde_json::json!({ "success": true, "updated": updated, "alive": alive }))
}

/// 获取直播频道树
pub fn handle_live_get_channel_tree(state: &State<'_, AppState>) -> Result<Value, AppError> {
    if let Ok(Value::String(snapshot)) = state.database.lock().get_cache(LIVE_LIBRARY_CACHE_KEY) {
        if let Ok(tree) = serde_json::from_str::<Value>(&snapshot) {
            return Ok(tree);
        }
    }
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
        "isRefreshing": LIVE_REFRESH_RUNNING.load(Ordering::SeqCst),
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
    crate::block_on(handle_live_load_async(state, live_name))
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
    crate::block_on(handle_live_load_by_url_async(state, url, name))
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
    let data_dir = state.data_dir.clone();
    let config_items = state.config_manager.lock().list().to_vec();
    let current_url = state
        .config_manager
        .lock()
        .get_current_url()
        .map(|s| s.to_string());

    // 后台线程执行刷新，不阻塞 UI。
    // 持有 AppHandle 的 clone（引用计数），应用关闭时 AppHandle 仍然有效。
    // 由于 Tauri 生命周期管理，此线程会在进程退出时被 OS 回收。
    std::thread::spawn(move || {
        if let Err(e) = run_live_refresh_background(
            config_items,
            current_url,
            data_dir.clone(),
            app_handle.clone(),
        ) {
            if let Ok(mut db) = Database::open(data_dir.join("iptv.db")) {
                let _ = db.update_refresh_status(
                    &serde_json::json!({"status":"idle", "nextRefreshTime": epoch_seconds() + 60}),
                );
            }
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
    data_dir: PathBuf,
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
        urls.push((item.name.clone(), item.url.clone()));
    }

    if urls.is_empty() {
        return Err(AppError::not_found("无当前配置，请先加载配置"));
    }

    // 打开独立数据库连接
    let mut database =
        Database::open(data_dir.join("iptv.db")).map_err(|e| AppError::database_error(e))?;

    // 更新状态为 refreshing
    database
        .update_refresh_status(&serde_json::json!({ "status": "refreshing" }))
        .map_err(|e| AppError::database_error(e))?;

    let has_cached_channels = database
        .get_cache(LIVE_LIBRARY_CACHE_KEY)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .is_some();
    let mut channels = crate::block_on(load_all_live_channels_from_urls(
        &urls,
        app_ref,
        &mut database,
        !has_cached_channels,
    ))?;
    // 回填上一轮探测结果 → 只有「没测过 / 结果过期」的线路才会进本轮探测队列
    seed_probe_results(&mut database, &mut channels);
    let total_urls: usize = merge_channels(channels.clone()).iter().map(|channel| channel.lines.len()).sum();
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
    let tested_channels = crate::block_on(test_and_merge_channels(channels, app_ref))?;

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
            "urlHeaders": ch.headers,
            "lines": ch.lines,
            "isAlive": if ch.latency >= 0 { 1 } else { 0 },
        }));
    }

    emit_progress(
        app_ref,
        "saving",
        0,
        db_channels.len(),
        Some("正在保存到数据库..."),
    );

    let alive = tested_channels.iter().filter(|channel| channel.latency >= 0).count();
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
    save_library_snapshot(&mut database, &db_channels)?;
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
            "完成: {} 个频道线路可达，{} 条线路已检查",
            alive, total_urls
        )),
    );
    Ok(serde_json::json!({ "success": true }))
}

async fn load_all_live_channels_from_urls(
    urls: &[(String, String)],
    app: Option<&tauri::AppHandle>,
    database: &mut Database,
    publish_initial: bool,
) -> Result<Vec<RefreshChannel>, AppError> {
    let mut pending = stream::iter(
        urls.iter()
            .cloned()
            .map(|source| async move {
                let url = source.1.clone();
                (url, load_live_channels_from_sources(&[source], app).await)
            }),
    )
    .buffer_unordered(6);
    let mut channels = Vec::new();
    while let Some((url, result)) = pending.next().await {
        let loaded = result?;
        let key = format!("live:subscription:{url}");
        let found = retain_subscription_cache(database, &key, loaded)?;
        channels.extend(found);
        if publish_initial && !channels.is_empty() {
            let rows = merge_channels(channels.clone()).into_iter().map(|channel| {
                let (country, category, sort_order) = live::classify_channel(&channel.name);
                serde_json::json!({"name":channel.name,"urls":channel.urls,"bestUrl":channel.urls.first(),"latency":-2,"country":format!("{:?}",country),"category":category,"sortOrder":sort_order,"originalGroups":channel.origins,"urlHeaders":channel.headers,"lines":channel.lines})
            }).collect::<Vec<_>>();
            save_library_snapshot(database, &rows)?;
            emit_progress(
                app,
                "cached",
                rows.len(),
                0,
                Some("频道已加载，正在后台检查线路"),
            );
        }
    }
    Ok(channels)
}

fn retain_subscription_cache(database: &mut Database, key: &str, loaded: LoadedChannels) -> Result<Vec<RefreshChannel>, AppError> {
    let mut channels = loaded.channels;
    if loaded.partial_failure || channels.is_empty() {
        if let Ok(Value::String(saved)) = database.get_cache(key) {
            channels.extend(serde_json::from_str::<Vec<RefreshChannel>>(&saved).unwrap_or_default());
        }
    } else {
        database.set_cache(key, &serde_json::to_string(&channels)?).map_err(AppError::database_error)?;
    }
    Ok(merge_channels(channels))
}

async fn load_live_channels_from_sources(
    urls: &[(String, String)],
    app: Option<&tauri::AppHandle>,
) -> Result<LoadedChannels, AppError> {
    let client = crate::network::create_client()?;
    let mut all_channels = Vec::new();
    let mut partial_failure = false;
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
                    partial_failure = true;
                    eprintln!(
                        "[live:refresh] 配置加载失败 [{}]: {}",
                        redact_text(&config_url),
                        redact_text(&error.to_string())
                    );
                    continue;
                }
                Err(_) => {
                    partial_failure = true;
                    eprintln!("[live:refresh] 配置加载超时 [{}]", redact_text(&config_url));
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
                partial_failure = true;
                continue;
            };
            let live_url = crate::config::resolve_relative_url(config_url, live_url);
            if should_skip_live_in_refresh(&live_url) {
                partial_failure = true;
                eprintln!(
                    "[live:refresh] 跳过超大直播源 [{} / {}]: {}",
                    config_name,
                    live_name,
                    redact_text(&live_url)
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
                    partial_failure = true;
                    eprintln!(
                        "[live:refresh] 直播源下载失败 [{}]: {}",
                        redact_text(&live_url),
                        error
                    );
                    continue;
                }
                Err(_) => {
                    partial_failure = true;
                    eprintln!("[live:refresh] 直播源下载超时 [{}]", redact_text(&live_url));
                    continue;
                }
            };
            let groups = live::parse_live_content(&content);
            let channel_count: usize = groups.iter().map(|group| group.channel.len()).sum();
            if channel_count == 0 {
                partial_failure = true;
            }
            if channel_count > MAX_REFRESH_CHANNELS_PER_LIVE {
                partial_failure = true;
                eprintln!(
                    "[live:refresh] 跳过频道数过大的直播源 [{} / {}]: {} channels url={}",
                    config_name,
                    live_name,
                    channel_count,
                    redact_text(&live_url)
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
                        headers: channel
                            .urls
                            .iter()
                            .map(|url| {
                                let mut headers: HashMap<String, String> = live_entry
                                    .get("header")
                                    .and_then(Value::as_object)
                                    .map(|items| {
                                        items
                                            .iter()
                                            .filter_map(|(key, value)| {
                                                value
                                                    .as_str()
                                                    .map(|value| (key.clone(), value.to_string()))
                                            })
                                            .collect()
                                    })
                                    .unwrap_or_default();
                                if let Some(ua) = live_entry.get("ua").and_then(Value::as_str) {
                                    headers.insert("User-Agent".into(), ua.into());
                                }
                                headers.extend(channel.header.clone().unwrap_or_default());
                                if let Some(ua) = &channel.ua {
                                    headers.insert("User-Agent".into(), ua.clone());
                                }
                                if let Some(referer) = &channel.referer {
                                    headers.insert("Referer".into(), referer.clone());
                                }
                                if let Some(origin) = &channel.origin {
                                    headers.insert("Origin".into(), origin.clone());
                                }
                                (url.clone(), headers)
                            })
                            .collect(),
                        name: channel.name,
                        urls: channel.urls,
                        origins: vec![origin.clone()],
                        lines: Vec::new(),
                    });
                }
            }
        }
    }

    Ok(LoadedChannels { channels: merge_channels(all_channels), partial_failure })
}

fn should_skip_live_in_refresh(url: &str) -> bool {
    SKIP_REFRESH_URL_PATTERNS
        .iter()
        .any(|pattern| url.contains(pattern))
}

async fn load_config_for_refresh(url: &str) -> Result<Value, AppError> {
    crate::config::load_config_from_url(url, None).await
}

fn merge_channels(channels: Vec<RefreshChannel>) -> Vec<RefreshChannel> {
    let mut merged_by_name: HashMap<String, RefreshChannel> = HashMap::new();

    for mut channel in channels {
        if channel.lines.is_empty() {
            channel.lines = channel.urls.iter().map(|url| LiveLine {
                url: url.clone(),
                header: channel.headers.get(url).cloned().unwrap_or_default(),
                latency: LATENCY_UNPROBED,
                alive: false,
                tested_at: 0,
            }).collect();
        }
        let key = live::normalize_name(&channel.name);
        let entry = merged_by_name.entry(key).or_insert_with(|| RefreshChannel {
            name: channel.name.clone(),
            urls: Vec::new(),
            origins: Vec::new(),
            headers: HashMap::new(),
            lines: Vec::new(),
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
        for (url, headers) in channel.headers {
            entry.headers.entry(url).or_insert(headers);
        }
        for mut line in channel.lines {
            line.header = line.header.into_iter().map(|(key, value)| (key.to_ascii_lowercase(), value)).collect();
            if !entry.lines.iter().any(|existing| existing.url == line.url && existing.header == line.header) {
                entry.lines.push(line);
            }
        }
    }
    let mut merged: Vec<_> = merged_by_name.into_values().collect();
    merged.sort_by(|a, b| a.name.cmp(&b.name));
    merged
}

/// 用上一次快照里的探测结果回填本次从直播源重新解析出来的频道。
///
/// 每次刷新都会重新解析 m3u/txt，解析结果里所有线路都是「未探测」；不回填的话
/// `needs_probe` 会把两万条线路全部重测一遍（这正是旧策略又慢又容易被中断的原因）。
fn seed_probe_results(database: &mut Database, channels: &mut [RefreshChannel]) {
    let Ok(Value::String(snapshot)) = database.get_cache(LIVE_LIBRARY_CACHE_KEY) else {
        return;
    };
    let Ok(rows) = serde_json::from_str::<Vec<Value>>(&snapshot) else {
        return;
    };

    // 只用 URL 做键：header 大小写/顺序在不同来源里可能不一致，用它当键会大量漏匹配
    let mut known: HashMap<String, (i64, bool, i64)> = HashMap::new();
    for row in &rows {
        let Some(lines) = row.get("lines").and_then(Value::as_array) else {
            continue;
        };
        for line in lines {
            let Some(url) = line.get("url").and_then(Value::as_str) else {
                continue;
            };
            let latency = line
                .get("latency")
                .and_then(Value::as_i64)
                .unwrap_or(LATENCY_UNPROBED);
            let alive = line.get("alive").and_then(Value::as_bool).unwrap_or(false);
            let tested_at = line.get("tested_at").and_then(Value::as_i64).unwrap_or(0);
            if tested_at > 0 {
                known.insert(url.to_string(), (latency, alive, tested_at));
            }
        }
    }

    if known.is_empty() {
        return;
    }
    for channel in channels.iter_mut() {
        for line in channel.lines.iter_mut() {
            if let Some((latency, alive, tested_at)) = known.get(&line.url) {
                line.latency = *latency;
                line.alive = *alive;
                line.tested_at = *tested_at;
            }
        }
    }
}

/// 线路是否需要重新探测
fn needs_probe(line: &LiveLine, now: i64) -> bool {
    if line.tested_at == 0 {
        return true;
    }
    let ttl = if line.alive { LIVE_PROBE_TTL_SECS } else { LIVE_PROBE_DEAD_TTL_SECS };
    now - line.tested_at >= ttl
}

/// 取 URL 的主机名，用于按主机限流
fn host_of(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(str::to_string))
        .unwrap_or_else(|| url.to_string())
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0)
}

async fn test_and_merge_channels(
    channels: Vec<RefreshChannel>,
    app: Option<&tauri::AppHandle>,
) -> Result<Vec<TestedChannel>, AppError> {
    let channels = merge_channels(channels);
    let total: usize = channels.iter().map(|channel| channel.lines.len()).sum();

    // 只测「没测过」或「结果已过期」的线路：上一轮结果保留、不重复测（增量刷新）。
    let now = now_secs();
    let jobs: Vec<(usize, LiveLine)> = channels
        .iter()
        .enumerate()
        .flat_map(|(index, channel)| {
            channel
                .lines
                .iter()
                .filter(|line| needs_probe(line, now))
                .cloned()
                .map(move |line| (index, line))
        })
        .collect();
    let skipped = total.saturating_sub(jobs.len());

    // 优先级：中文/CCTV → 国际知名台 → 其它（见 live::probe_priority）。
    // 时间预算有限，必须先把预算花在用户最可能看的频道上；同一优先级保持来源顺序。
    let mut jobs = jobs;
    jobs.sort_by_key(|(index, _)| {
        (
            live::probe_priority(channels[*index].name.as_str()),
            *index,
        )
    });
    let mut tier_counts = [0usize; 3];
    for (index, _) in &jobs {
        tier_counts[live::probe_priority(channels[*index].name.as_str()).min(2) as usize] += 1;
    }
    emit_progress(
        app,
        "testing",
        0,
        jobs.len(),
        Some(&format!(
            "待检查 {} 条（中文 {} / 国际 {} / 其它 {}）",
            jobs.len(),
            tier_counts[0],
            tier_counts[1],
            tier_counts[2]
        )),
    );

    let mut results: Vec<Vec<LiveLine>> = channels
        .iter()
        .map(|channel| {
            channel
                .lines
                .iter()
                .filter(|line| !needs_probe(line, now))
                .cloned()
                .collect::<Vec<_>>()
        })
        .collect();

    let budget = Duration::from_secs(LIVE_PROBE_BUDGET_SECS);
    let deadline = Instant::now() + budget;
    let mut host_limits: HashMap<String, Arc<Semaphore>> = HashMap::new();
    let job_total = jobs.len();
    let mut queue: std::collections::VecDeque<(usize, LiveLine)> = jobs.into_iter().collect();
    let mut in_flight = FuturesUnordered::new();
    let mut limit = PROBE_CONCURRENCY_START;
    let mut consecutive_failures = 0usize;
    let mut completed = 0usize;
    let mut budget_hit = false;

    while !in_flight.is_empty() || !queue.is_empty() {
        while in_flight.len() < limit {
            if Instant::now() >= deadline {
                budget_hit = true;
                break;
            }
            let Some((index, mut line)) = queue.pop_front() else {
                break;
            };
            let host = host_of(&line.url);
            let semaphore = host_limits
                .entry(host)
                .or_insert_with(|| Arc::new(Semaphore::new(PER_HOST_CONCURRENCY)))
                .clone();
            in_flight.push(async move {
                // 同一主机最多 PER_HOST_CONCURRENCY 条在飞，避免自己把自己打到超时
                let _permit = semaphore.acquire_owned().await.ok();
                let result =
                    live::test_url_with_headers(&line.url, LIVE_PROBE_TIMEOUT_MS, &line.header).await;
                line.alive = result.alive;
                line.latency = if result.alive { result.latency } else { LATENCY_DEAD };
                line.tested_at = now_secs();
                (index, line)
            });
        }

        if in_flight.is_empty() {
            break;
        }

        let Some((index, line)) = in_flight.next().await else {
            break;
        };
        // AIMD：成功慢加速，连续失败快速退避——并发太高时误判率会飙升
        if line.alive {
            consecutive_failures = 0;
            limit = (limit + 1).min(PROBE_CONCURRENCY_MAX);
        } else {
            consecutive_failures += 1;
            if consecutive_failures >= 3 {
                limit = (limit / 2).max(PROBE_CONCURRENCY_MIN);
                consecutive_failures = 0;
            }
        }
        results[index].push(line);
        completed += 1;
        if completed == 1 || completed % 25 == 0 || completed == job_total {
            let note = if skipped > 0 {
                format!("正在检查线路 ({completed}/{job_total}，{skipped} 条沿用上次结果)")
            } else {
                format!("正在检查线路 ({completed}/{job_total})")
            };
            emit_progress(app, "testing", completed, job_total, Some(&note));
        }
    }

    if budget_hit {
        let remaining = queue.len() + in_flight.len();
        emit_progress(
            app,
            "testing",
            completed,
            job_total,
            Some(&format!("本轮预算用尽，{remaining} 条留待下次检查")),
        );
    }
    Ok(channels
        .into_iter()
        .zip(results)
        .map(|(channel, mut lines)| {
            lines.sort_by_key(|line| (!line.alive, if line.latency >= 0 { line.latency } else { i64::MAX }));
            let mut urls = Vec::new();
            let mut headers = HashMap::new();
            for line in &lines {
                if !urls.contains(&line.url) {
                    urls.push(line.url.clone());
                    headers.insert(line.url.clone(), line.header.clone());
                }
            }
            TestedChannel {
                best_url: urls.first().cloned().unwrap_or_default(),
                // 频道级状态：有可达线路就取最快那条的延迟；
                // 一条都没测过 → 未探测(-2)（不能显示成「不可用」）；测过但都不通 → -1
                latency: lines
                    .iter()
                    .find(|line| line.alive)
                    .map(|line| line.latency)
                    .unwrap_or_else(|| {
                        if lines.iter().all(|line| line.tested_at == 0) {
                            LATENCY_UNPROBED
                        } else {
                            LATENCY_DEAD
                        }
                    }),
                name: channel.name,
                urls,
                origins: channel.origins,
                headers,
                lines,
            }
        })
        .collect())
}

fn save_library_snapshot(database: &mut Database, rows: &[Value]) -> Result<(), AppError> {
    let rows: Vec<_> = rows.iter().map(|row| serde_json::json!({
        "name":row["name"], "urls":row["urls"], "best_url":row["bestUrl"], "latency":row["latency"],
        "country":row["country"], "category":row["category"], "sort_order":row["sortOrder"],
        "original_groups":row["originalGroups"], "urlHeaders":row["urlHeaders"], "lines":row["lines"]
    })).collect();
    database
        .set_cache(
            LIVE_LIBRARY_CACHE_KEY,
            &crate::build_live_tree(rows).to_string(),
        )
        .map_err(AppError::database_error)
}

fn epoch_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0)
}

pub fn request_live_refresh() {
    LIVE_REFRESH_REQUESTED.store(true, Ordering::SeqCst);
}

pub fn start_live_refresh_scheduler(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(5));
        loop {
            timer.tick().await;
            if LIVE_REFRESH_RUNNING.load(Ordering::SeqCst) {
                continue;
            }
            let state = app.state::<AppState>();
            let next = state
                .database
                .lock()
                .get_refresh_status()
                .ok()
                .and_then(|status| status["next_refresh_time"].as_i64())
                .unwrap_or(0);
            if LIVE_REFRESH_REQUESTED.swap(false, Ordering::SeqCst) || next <= epoch_seconds() {
                let _ = handle_live_refresh(&state, Some(&app));
            }
        }
    });
}

#[cfg(test)]
mod refresh_strategy_tests {
    use super::*;

    fn line(url: &str, latency: i64, alive: bool, tested_at: i64) -> LiveLine {
        LiveLine {
            url: url.into(),
            header: HashMap::new(),
            latency,
            alive,
            tested_at,
        }
    }

    #[test]
    fn needs_probe_only_for_never_tested_or_expired() {
        let now = 1_000_000;
        assert!(needs_probe(&line("u", LATENCY_UNPROBED, false, 0), now), "从未探测要测");
        assert!(
            !needs_probe(&line("u", 120, true, now - 60), now),
            "{} 秒内的结果不该重测（增量刷新）",
            LIVE_PROBE_TTL_SECS
        );
        assert!(
            needs_probe(&line("u", 120, true, now - LIVE_PROBE_TTL_SECS - 1), now),
            "过期结果要重测"
        );
        assert!(
            needs_probe(&line("u", LATENCY_DEAD, false, now - LIVE_PROBE_TTL_SECS), now),
            "到期的失败结果同样要重测"
        );
    }


    #[test]
    fn playback_result_overrides_probe_and_marks_line_alive() {
        let mut rows = vec![serde_json::json!({
            "name": "CCTV-1",
            "latency": -1,
            "lines": [
                {"url": "https://a.example/1.m3u8", "header": {}, "latency": -1, "alive": false, "tested_at": 500},
                {"url": "https://b.example/2.m3u8", "header": {}, "latency": -2, "alive": false, "tested_at": 0}
            ]
        })];
        // 播放器真的播起来了 → 覆盖「无信号」
        let updated = apply_playback_result(
            &mut rows,
            &["https://a.example/1.m3u8".to_string()],
            true,
            Some(88),
            1000,
        );
        assert_eq!(updated, 1);
        let lines = rows[0]["lines"].as_array().unwrap();
        assert_eq!(lines[0]["alive"], serde_json::json!(true));
        assert_eq!(lines[0]["latency"], serde_json::json!(88));
        assert_eq!(lines[0]["tested_at"], serde_json::json!(1000));
        assert_eq!(rows[0]["latency"], serde_json::json!(88), "频道级状态取可达线路");
        assert_eq!(rows[0]["bestUrl"], serde_json::json!("https://a.example/1.m3u8"));
        // 未涉及的线路不受影响
        assert_eq!(lines[1]["tested_at"], serde_json::json!(0));
    }

    #[test]
    fn playback_failure_marks_dead_and_keeps_all_unprobed_as_unprobed() {
        let mut rows = vec![serde_json::json!({
            "name": "X",
            "latency": -2,
            "lines": [{"url": "https://c.example/3.m3u8", "header": {}, "latency": -2, "alive": false, "tested_at": 0}]
        })];
        apply_playback_result(&mut rows, &["https://c.example/3.m3u8".to_string()], false, None, 2000);
        assert_eq!(rows[0]["latency"], serde_json::json!(LATENCY_DEAD));
        assert_eq!(rows[0]["lines"][0]["latency"], serde_json::json!(LATENCY_DEAD));
    }

    #[test]
    fn dead_results_expire_five_times_faster_than_alive_ones() {
        let now = 1_000_000;
        let fresh_alive = line("u", 100, true, now - 6 * 60);
        let fresh_dead = line("u", LATENCY_DEAD, false, now - 6 * 60);
        assert!(!needs_probe(&fresh_alive, now), "可播结论保留 30 分钟");
        assert!(needs_probe(&fresh_dead, now), "判死结论 5 分钟就该重测，否则能播的频道长时间显示无信号");
    }

    #[test]
    fn host_of_extracts_hostname_for_per_host_limiting() {
        assert_eq!(host_of("https://a.example:8080/live.m3u8?x=1"), "a.example");
        assert_eq!(host_of("not a url"), "not a url");
    }

    #[test]
    fn seed_probe_results_reuses_last_round_and_skips_local_retest() {
        let mut database = Database::open(":memory:".into()).expect("内存库");
        let now = 1_000_000;
        let snapshot = serde_json::json!([{
            "name": "CCTV-1",
            "lines": [
                {"url": "https://a.example/1.m3u8", "header": {}, "latency": 118, "alive": true, "tested_at": now - 60},
                {"url": "https://b.example/2.m3u8", "header": {}, "latency": -1, "alive": false, "tested_at": now - 10},
                // 没有 tested_at 的旧快照数据不该被当成「测过」
                {"url": "https://c.example/3.m3u8", "header": {}, "latency": 50, "alive": true}
            ]
        }]);
        database
            .set_cache(LIVE_LIBRARY_CACHE_KEY, &snapshot.to_string())
            .expect("写快照");

        let mut channels = vec![RefreshChannel {
            name: "CCTV-1".into(),
            urls: vec![],
            origins: vec![],
            headers: HashMap::new(),
            lines: vec![
                line("https://a.example/1.m3u8", LATENCY_UNPROBED, false, 0),
                line("https://b.example/2.m3u8", LATENCY_UNPROBED, false, 0),
                line("https://c.example/3.m3u8", LATENCY_UNPROBED, false, 0),
                line("https://d.example/4.m3u8", LATENCY_UNPROBED, false, 0),
            ],
        }];

        seed_probe_results(&mut database, &mut channels);

        let lines = &channels[0].lines;
        assert_eq!((lines[0].latency, lines[0].alive, lines[0].tested_at), (118, true, now - 60));
        assert_eq!((lines[1].latency, lines[1].alive, lines[1].tested_at), (LATENCY_DEAD, false, now - 10));
        assert_eq!(lines[2].tested_at, 0, "旧快照没有时间戳，不能当成已测过");
        assert_eq!(lines[3].tested_at, 0);

        assert!(!needs_probe(&lines[0], now), "回填过的新鲜结果不再进本轮队列");
        assert!(!needs_probe(&lines[1], now), "新鲜的失败结果同样不重测");
        assert!(needs_probe(&lines[2], now));
        assert!(needs_probe(&lines[3], now));
    }
}

#[cfg(test)]
mod aggregation_tests {
    use super::*;

    #[test]
    fn merges_aliases_without_losing_lines_or_headers() {
        let channels = vec![
            RefreshChannel {
                name: "CCTV-1".into(),
                lines: vec![],
                urls: vec!["https://a.example/live.m3u8".into()],
                origins: vec!["A".into()],
                headers: HashMap::from([(
                    "https://a.example/live.m3u8".into(),
                    HashMap::from([("Referer".into(), "https://a.example".into())]),
                )]),
            },
            RefreshChannel {
                name: "CCTV1高清".into(),
                lines: vec![],
                urls: vec!["https://b.example/live.m3u8".into()],
                origins: vec!["B".into()],
                headers: HashMap::new(),
            },
            RefreshChannel {
                name: "CCTV5+".into(),
                lines: vec![],
                urls: vec!["https://c.example/live.m3u8".into()],
                origins: vec![],
                headers: HashMap::new(),
            },
            RefreshChannel {
                name: "CCTV5".into(),
                lines: vec![],
                urls: vec!["https://d.example/live.m3u8".into()],
                origins: vec![],
                headers: HashMap::new(),
            },
        ];
        let merged = merge_channels(channels);
        assert_eq!(merged.len(), 3);
        let cctv1 = merged
            .iter()
            .find(|channel| live::normalize_name(&channel.name) == "cctv1")
            .unwrap();
        assert_eq!(cctv1.urls.len(), 2);
        assert_eq!(cctv1.origins.len(), 2);
        assert_eq!(
            cctv1.headers["https://a.example/live.m3u8"]["Referer"],
            "https://a.example"
        );
    }

    #[test]
    fn library_snapshot_preserves_line_headers() {
        let mut database = Database::open(":memory:".into()).unwrap();
        save_library_snapshot(&mut database, &[serde_json::json!({"name":"CCTV1","urls":["https://example.com/v.m3u8"],"bestUrl":"https://example.com/v.m3u8","latency":20,"country":"China","category":"央视","sortOrder":1,"urlHeaders":{"https://example.com/v.m3u8":{"Referer":"https://example.com"}}})]).unwrap();
        let value = database.get_cache(LIVE_LIBRARY_CACHE_KEY).unwrap();
        let tree: Value = serde_json::from_str(value.as_str().unwrap()).unwrap();
        assert_eq!(
            tree["countries"][0]["categories"][0]["channels"][0]["urlHeaders"]
                ["https://example.com/v.m3u8"]["Referer"],
            "https://example.com"
        );
    }

    fn sample_channel(name: &str, referer: &str) -> RefreshChannel {
        let url = "https://example.com/live.m3u8".to_string();
        RefreshChannel {
            name: name.into(), urls: vec![url.clone()], origins: vec![referer.into()], lines: vec![],
            headers: HashMap::from([(url, HashMap::from([("Referer".into(), referer.into())]))]),
        }
    }

    #[test]
    fn same_url_with_different_headers_survives_cache_and_tree() {
        let merged = merge_channels(vec![sample_channel("CCTV1", "https://a.example"), sample_channel("CCTV-1", "https://b.example"), sample_channel("CCTV1", "https://a.example")]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].urls.len(), 1);
        assert_eq!(merged[0].lines.len(), 2);
        assert_ne!(merged[0].lines[0].header, merged[0].lines[1].header);
        let mut database = Database::open(":memory:".into()).unwrap();
        save_library_snapshot(&mut database, &[serde_json::json!({"name":"CCTV1","country":"China","category":"CCTV","lines":merged[0].lines})]).unwrap();
        let saved = database.get_cache(LIVE_LIBRARY_CACHE_KEY).unwrap();
        let tree: Value = serde_json::from_str(saved.as_str().unwrap()).unwrap();
        assert_eq!(tree["countries"][0]["categories"][0]["channels"][0]["lines"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn probes_each_header_variant_and_prefers_the_working_one() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/live.m3u8", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            for _ in 0..2 {
                let (mut socket, _) = listener.accept().unwrap();
                socket.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
                let mut request = Vec::new();
                let mut buffer = [0u8; 1024];
                while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                    let count = socket.read(&mut buffer).unwrap();
                    assert!(count > 0);
                    request.extend_from_slice(&buffer[..count]);
                }
                let valid = String::from_utf8_lossy(&request).contains("https://good.example");
                let (status, body) = if valid { (200, "#EXTM3U\n#EXTINF:6,\nsegment.ts\n") } else { (403, "Forbidden") };
                write!(socket, "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        let channel = RefreshChannel {
            name: "CCTV1".into(), urls: vec![url.clone()], origins: vec![], headers: HashMap::new(),
            lines: ["https://bad.example", "https://good.example"].into_iter().map(|referer| LiveLine {
                tested_at: 0,
                url: url.clone(), header: HashMap::from([("Referer".into(), referer.into())]), latency: -1, alive: false,
            }).collect(),
        };
        let result = test_and_merge_channels(vec![channel], None).await.unwrap();
        server.join().unwrap();
        assert_eq!(result[0].lines.len(), 2);
        assert!(result[0].lines[0].alive);
        assert!(!result[0].lines[1].alive);
        assert_eq!(result[0].headers[&url]["referer"], "https://good.example");
        assert_eq!(result[0].urls, vec![url]);
    }

    #[test]
    fn partial_failure_keeps_last_complete_subscription_snapshot() {
        let mut database = Database::open(":memory:".into()).unwrap();
        let key = "live:subscription:fixture";
        let original = vec![sample_channel("CCTV1", "https://a.example"), sample_channel("CCTV2", "https://b.example")];
        retain_subscription_cache(&mut database, key, LoadedChannels { channels: original, partial_failure: false }).unwrap();
        let before = database.get_cache(key).unwrap();
        let found = retain_subscription_cache(&mut database, key, LoadedChannels { channels: vec![sample_channel("CCTV1", "https://new.example")], partial_failure: true }).unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!(found.iter().find(|channel| channel.name == "CCTV1").unwrap().lines.len(), 2);
        assert_eq!(database.get_cache(key).unwrap(), before);
        let complete = retain_subscription_cache(&mut database, key, LoadedChannels { channels: vec![sample_channel("CCTV1", "https://new.example")], partial_failure: false }).unwrap();
        assert_eq!(complete.len(), 1);
        assert_ne!(database.get_cache(key).unwrap(), before);
    }
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
    crate::block_on(handle_live_epg_async(epg_url, channel_map))
}
