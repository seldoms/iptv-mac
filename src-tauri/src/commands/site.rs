use std::collections::HashMap;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::State;

use crate::error::AppError;
use crate::js_spider::JsSpider;
use crate::site_filter::{is_hidden_site, is_http_api_site, is_searchable_site, site_key, site_name_or, site_type};
use crate::spider::{HttpSpider, SiteConfig};
use crate::AppState;

/// 蜘蛛枚举 — 统一 HttpSpider（type 0/1/4）和 JsSpider（type 3）
enum Spider {
    Http(HttpSpider),
    Js(JsSpider),
}

const MAX_ACROSS_SITE_SEARCH_SITES: usize = 24;
const DEFAULT_ACROSS_SITE_TIMEOUT_MS: u64 = 8_000;

fn load_current_config(state: &State<'_, AppState>) -> Result<(String, Value), AppError> {
    let config_url = state
        .config_manager
        .lock()
        .get_current_url()
        .map(|url| url.to_string())
        .ok_or_else(|| AppError::not_found("无当前配置"))?;

    if let Some((cached_url, cached_config)) = state.current_config.lock().as_ref() {
        if cached_url == &config_url {
            return Ok((config_url, cached_config.clone()));
        }
    }

    let mgr = state.config_manager.lock();
    let config = crate::block_on(mgr.load_from_url(&config_url))
        .map_err(|_| AppError::not_found("配置加载失败"))?;
    *state.current_config.lock() = Some((config_url.clone(), config.clone()));
    Ok((config_url, config))
}

async fn load_current_config_async(
    state: &State<'_, AppState>,
) -> Result<(String, Value), AppError> {
    let config_url = state
        .config_manager
        .lock()
        .get_current_url()
        .map(|url| url.to_string())
        .ok_or_else(|| AppError::not_found("无当前配置"))?;

    if let Some((cached_url, cached_config)) = state.current_config.lock().as_ref() {
        if cached_url == &config_url {
            return Ok((config_url, cached_config.clone()));
        }
    }

    let config = crate::config::load_config_from_url(&config_url, Some(&state.data_dir))
        .await
        .map_err(|_| AppError::not_found("配置加载失败"))?;
    *state.current_config.lock() = Some((config_url.clone(), config.clone()));
    Ok((config_url, config))
}


fn spider_from_site(config_url: &str, site: &Value) -> Result<HttpSpider, AppError> {
    let key = site_key(site).ok_or_else(|| AppError::invalid_input("站点缺少 key"))?;
    let api = site
        .get("api")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|api| !api.is_empty())
        .ok_or_else(|| AppError::invalid_input(format!("站点 {} 无 API 地址", key)))?;

    Ok(HttpSpider::new(SiteConfig {
        key: key.to_string(),
        name: site_name_or(site, key).to_string(),
        site_type: site_type(site),
        api: crate::config::resolve_relative_url(config_url, api),
        ext: site.get("ext").cloned(),
        play_url: site
            .get("playUrl")
            .or_else(|| site.get("play_url"))
            .and_then(Value::as_str)
            .map(String::from),
        click: site.get("click").and_then(Value::as_str).map(String::from),
        header: site.get("header").cloned(),
        timeout: site.get("timeout").and_then(Value::as_i64),
    }))
}

/// 创建 HttpSpider 实例
fn create_spider(state: &State<'_, AppState>, site_key: &str) -> Result<HttpSpider, AppError> {
    let (config_url, config) = load_current_config(state)?;

    let sites = match config.get("sites").and_then(Value::as_array) {
        Some(s) => s,
        None => return Err(AppError::not_found("配置中无站点")),
    };

    let site_entry = match sites
        .iter()
        .find(|s| s.get("key").and_then(Value::as_str) == Some(site_key))
    {
        Some(s) => s,
        None => return Err(AppError::not_found(format!("站点不存在: {}", site_key))),
    };

    spider_from_site(&config_url, site_entry)
}

/// 创建蜘蛛实例（async 版本，自动选择 HttpSpider / JsSpider）
async fn create_spider_async(
    state: &State<'_, AppState>,
    site_key: &str,
) -> Result<Spider, AppError> {
    let (config_url, config) = load_current_config_async(state).await?;

    let sites = match config.get("sites").and_then(Value::as_array) {
        Some(s) => s,
        None => return Err(AppError::not_found("配置中无站点")),
    };

    let site_entry = match sites
        .iter()
        .find(|s| s.get("key").and_then(Value::as_str) == Some(site_key))
    {
        Some(s) => s,
        None => return Err(AppError::not_found(format!("站点不存在: {}", site_key))),
    };

    let site_type = site_entry.get("type").and_then(Value::as_i64).unwrap_or(1);
    let api = site_entry.get("api").and_then(Value::as_str).unwrap_or("");

    let name = site_name_or(site_entry, site_key);

    // Type 0/1/4 → HttpSpider
    if site_type == 0 || site_type == 1 || site_type == 4 {
        return Ok(Spider::Http(spider_from_site(&config_url, site_entry)?));
    }

    // Type=3: api 含 .js → JsSpider（QuickJS）
    if api.contains(".js") || api.contains(".mjs") {
        let ext = site_entry.get("ext").and_then(Value::as_str);
        eprintln!("[spider] JS 蜘蛛: key={}, api={}", site_key, api);
        let api = crate::config::resolve_relative_url(&config_url, api);
        let ext = ext.map(|value| {
            if value.starts_with("./") || value.starts_with("../") || value.starts_with('/') {
                crate::config::resolve_relative_url(&config_url, value)
            } else {
                value.to_string()
            }
        });
        let js_spider = JsSpider::new(&api, ext.as_deref()).await?;
        return Ok(Spider::Js(js_spider));
    }

    // Type=3: api 是 csp_（Java JAR）→ 不支持
    if api.starts_with("csp_") {
        return Err(AppError::not_found(format!(
            "站点「{}」使用 Android JAR 爬虫（csp_），macOS 暂不支持 Java 执行环境",
            name
        )));
    }

    // Type=3: api 是 .py（Python）→ 不支持
    if api.ends_with(".py") || api.contains(".py") {
        return Err(AppError::not_found(format!(
            "站点「{}」使用 Python 爬虫（.py），macOS 平台暂不支持 Python 执行环境",
            name
        )));
    }

    if site_type == 3 {
        return Err(AppError::not_found(format!(
            "站点「{}」使用脚本爬虫（type 3），当前平台暂不支持",
            name
        )));
    }

    // 其他 → 尝试 HttpSpider
    eprintln!("[spider] 尝试 HTTP 请求: key={}, api={}", site_key, api);
    Ok(Spider::Http(spider_from_site(&config_url, site_entry)?))
}

impl Spider {
    async fn home_content(&self, filter: bool) -> Result<Value, AppError> {
        match self {
            Spider::Http(h) => h.home_content(filter).await.map(|r| json!(r)),
            Spider::Js(j) => j.home_content(filter).await,
        }
    }

    async fn category_content(
        &self,
        tid: &str,
        pg: &str,
        filter: bool,
        extend: &HashMap<String, String>,
    ) -> Result<Value, AppError> {
        match self {
            Spider::Http(h) => h
                .category_content(tid, pg, filter, extend)
                .await
                .map(|r| json!(r)),
            Spider::Js(j) => j.category_content(tid, pg, filter, extend).await,
        }
    }

    async fn detail_content(&self, ids: &[String]) -> Result<Value, AppError> {
        match self {
            Spider::Http(h) => h.detail_content(ids).await.map(|r| json!(r)),
            Spider::Js(j) => j.detail_content(ids).await,
        }
    }

    async fn search_content(
        &self,
        keyword: &str,
        quick: bool,
        pg: Option<&str>,
    ) -> Result<Value, AppError> {
        match self {
            Spider::Http(h) => h.search_content(keyword, quick, pg).await.map(|r| json!(r)),
            Spider::Js(j) => j.search_content(keyword, quick, pg).await,
        }
    }

    async fn player_content(
        &self,
        flag: &str,
        id: &str,
        vip_flags: &[String],
    ) -> Result<Value, AppError> {
        match self {
            Spider::Http(h) => h
                .player_content(flag, id, vip_flags)
                .await
                .map(|r| json!(r)),
            Spider::Js(j) => j.player_content(flag, id, vip_flags).await,
        }
    }
}

/// site:homeContent（异步版本，不阻塞主线程）
pub async fn handle_site_home_content_async(
    state: &State<'_, AppState>,
    site_key: String,
    filter: bool,
) -> Result<Value, AppError> {
    let spider = create_spider_async(state, &site_key).await?;
    let result = spider.home_content(filter).await?;
    Ok(serde_json::json!({ "success": true, "data": result }))
}

/// site:homeContent（同步版本，阻塞主线程 — 保留向后兼容）
pub fn handle_site_home_content(
    state: &State<'_, AppState>,
    site_key: String,
    filter: bool,
) -> Result<Value, AppError> {
    crate::block_on(handle_site_home_content_async(state, site_key, filter))
}

/// site:categoryContent（异步版本）
pub async fn handle_site_category_content_async(
    state: &State<'_, AppState>,
    site_key: String,
    tid: String,
    pg: String,
    filter: bool,
    extend: Value,
) -> Result<Value, AppError> {
    let spider = create_spider_async(state, &site_key).await?;
    let extend_map: HashMap<String, String> = extend
        .as_object()
        .map(|obj| {
            obj.iter()
                .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
                .collect()
        })
        .unwrap_or_default();
    let result = spider
        .category_content(&tid, &pg, filter, &extend_map)
        .await?;
    Ok(serde_json::json!({ "success": true, "data": result }))
}

/// site:detailContent（异步版本）
pub async fn handle_site_detail_content_async(
    state: &State<'_, AppState>,
    site_key: String,
    ids: Vec<String>,
) -> Result<Value, AppError> {
    let spider = create_spider_async(state, &site_key).await?;
    let result = spider.detail_content(&ids).await?;
    Ok(serde_json::json!({ "success": true, "data": result }))
}

/// site:searchContent（异步版本）
pub async fn handle_site_search_content_async(
    state: &State<'_, AppState>,
    site_key: String,
    keyword: String,
    quick: bool,
    pg: Option<String>,
) -> Result<Value, AppError> {
    let spider = create_spider_async(state, &site_key).await?;
    let result = spider
        .search_content(&keyword, quick, pg.as_deref())
        .await?;
    Ok(serde_json::json!({ "success": true, "data": result }))
}

/// site:playerContent（异步版本）
pub async fn handle_site_player_content_async(
    state: &State<'_, AppState>,
    site_key: String,
    flag: String,
    id: String,
    vip_flags: Vec<String>,
) -> Result<Value, AppError> {
    let spider = create_spider_async(state, &site_key).await?;
    let result = spider.player_content(&flag, &id, &vip_flags).await?;
    Ok(serde_json::json!({ "success": true, "data": result }))
}

/// site:categoryContent（同步版本）
pub fn handle_site_category_content(
    state: &State<'_, AppState>,
    site_key: String,
    tid: String,
    pg: String,
    filter: bool,
    extend: Value,
) -> Result<Value, AppError> {
    crate::block_on(handle_site_category_content_async(
        state, site_key, tid, pg, filter, extend,
    ))
}

/// site:detailContent（同步版本）
pub fn handle_site_detail_content(
    state: &State<'_, AppState>,
    site_key: String,
    ids: Vec<String>,
) -> Result<Value, AppError> {
    crate::block_on(handle_site_detail_content_async(state, site_key, ids))
}

/// site:searchContent（同步版本）
pub fn handle_site_search_content(
    state: &State<'_, AppState>,
    site_key: String,
    keyword: String,
    quick: bool,
    pg: Option<String>,
) -> Result<Value, AppError> {
    crate::block_on(handle_site_search_content_async(
        state, site_key, keyword, quick, pg,
    ))
}

/// site:playerContent（同步版本）
pub fn handle_site_player_content(
    state: &State<'_, AppState>,
    site_key: String,
    flag: String,
    id: String,
    vip_flags: Vec<String>,
) -> Result<Value, AppError> {
    crate::block_on(handle_site_player_content_async(
        state, site_key, flag, id, vip_flags,
    ))
}

/// site:probe
pub fn handle_site_probe(
    state: &State<'_, AppState>,
    site_keys: Vec<String>,
) -> Result<Value, AppError> {
    for site_key in &site_keys {
        let spider = match create_spider(state, site_key) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let result = match crate::block_on(spider.home_content(true)) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let has_content = result
            .class
            .as_ref()
            .map(|c| !c.is_empty())
            .unwrap_or(false)
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
pub fn handle_site_super_parse(
    state: &State<'_, AppState>,
    params: Value,
) -> Result<Value, AppError> {
    crate::block_on(handle_site_super_parse_async(state, params))
}

pub async fn handle_site_super_parse_async(
    state: &State<'_, AppState>,
    params: Value,
) -> Result<Value, AppError> {
    let url = params
        .get("url")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .ok_or_else(|| AppError::invalid_input("缺少播放地址"))?;
    let flag = params
        .get("flag")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let site_key = params
        .get("siteKey")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let player_result = params.get("playerResult");

    let (_, config) = load_current_config_async(state).await?;
    let parses = config
        .get("parses")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let result =
        crate::super_parse::super_parse(url, flag, site_key, player_result, Some(&parses)).await?;

    match result {
        Some(data) => Ok(json!({ "success": true, "data": data })),
        None => Ok(json!({
            "success": false,
            "error": "解析失败，未找到可播放地址"
        })),
    }
}

/// site:findAcrossSites
pub async fn handle_site_find_across_sites_async(
    state: &State<'_, AppState>,
    keyword: String,
    options: Option<Value>,
) -> Result<Value, AppError> {
    let keyword = keyword.trim().to_string();
    if keyword.is_empty() {
        return Ok(json!({ "success": true, "data": [] }));
    }

    let options = options.unwrap_or(Value::Null);
    let exclude_site_key = options
        .get("excludeSiteKey")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let exclude_vod_id = options
        .get("excludeVodId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let limit = options
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(20)
        .clamp(1, 100) as usize;
    let timeout_ms = options
        .get("timeoutMs")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_ACROSS_SITE_TIMEOUT_MS)
        .clamp(1_000, 30_000);

    let (config_url, config) = load_current_config_async(state).await?;
    let sites = config
        .get("sites")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut candidates = Vec::new();
    for site in sites.iter().filter(|site| is_searchable_site(site)) {
        let Some(key) = site_key(site) else { continue };
        if key == exclude_site_key {
            continue;
        }
        let name = site_name_or(site, key).to_string();
        let spider = match spider_from_site(&config_url, site) {
            Ok(spider) => spider,
            Err(_) => continue,
        };
        candidates.push((key.to_string(), name, spider));
        if candidates.len() >= MAX_ACROSS_SITE_SEARCH_SITES {
            break;
        }
    }

    if candidates.is_empty() {
        return Ok(json!({ "success": true, "data": [] }));
    }

    let total_timeout = Duration::from_millis(timeout_ms);
    let per_site_timeout = Duration::from_millis(timeout_ms.min(8_000));
    let keyword_for_tasks = keyword.clone();
    let search_result = tokio::time::timeout(total_timeout, async move {
        let mut handles = Vec::new();
        for (site_key, site_name, spider) in candidates {
            let keyword = keyword_for_tasks.clone();
            let exclude_vod_id = exclude_vod_id.clone();
            handles.push(tokio::spawn(async move {
                let search = tokio::time::timeout(
                    per_site_timeout,
                    spider.search_content(&keyword, true, Some("1")),
                )
                .await;
                let Ok(Ok(result)) = search else {
                    return Vec::new();
                };
                let Some(list) = result.list else {
                    return Vec::new();
                };

                list.into_iter()
                    .filter(|vod| !vod.vod_id.is_empty() && vod.vod_id != exclude_vod_id)
                    .map(|vod| {
                        json!({
                            "siteKey": site_key,
                            "siteName": site_name,
                            "vodId": vod.vod_id,
                            "vodName": vod.vod_name,
                            "vodPic": vod.vod_pic,
                            "vodRemarks": vod.vod_remarks,
                        })
                    })
                    .collect::<Vec<Value>>()
            }));
        }

        let mut found = Vec::new();
        for handle in handles {
            if let Ok(items) = handle.await {
                found.extend(items);
            }
        }
        found
    })
    .await;

    let mut found = match search_result {
        Ok(items) => items,
        Err(_) => Vec::new(),
    };
    let keyword_normalized = normalize_title(&keyword);
    found.sort_by(|a, b| {
        let a_name = a.get("vodName").and_then(Value::as_str).unwrap_or_default();
        let b_name = b.get("vodName").and_then(Value::as_str).unwrap_or_default();
        let a_exact = normalize_title(a_name) == keyword_normalized;
        let b_exact = normalize_title(b_name) == keyword_normalized;
        b_exact
            .cmp(&a_exact)
            .then_with(|| a_name.len().cmp(&b_name.len()))
            .then_with(|| {
                a.get("siteName")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .cmp(
                        b.get("siteName")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                    )
            })
    });

    let mut seen = std::collections::HashSet::new();
    found.retain(|item| {
        let key = format!(
            "{}::{}",
            item.get("siteKey")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            item.get("vodId")
                .and_then(Value::as_str)
                .unwrap_or_default()
        );
        seen.insert(key)
    });
    found.truncate(limit);

    Ok(json!({ "success": true, "data": found }))
}

pub fn handle_site_find_across_sites(
    state: &State<'_, AppState>,
    keyword: String,
    options: Option<Value>,
) -> Result<Value, AppError> {
    crate::block_on(handle_site_find_across_sites_async(state, keyword, options))
}

fn normalize_title(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !ch.is_whitespace() && !matches!(ch, '-' | '_' | ':' | '：' | '·'))
        .flat_map(char::to_lowercase)
        .collect()
}
