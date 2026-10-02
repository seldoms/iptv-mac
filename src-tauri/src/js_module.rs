//! drpy / ESM 形式 JS 蜘蛛的模块运行时。
//!
//! TVBox 生态里的 "现代" JS 蜘蛛（drpy2、Cat 等）不是单文件脚本，而是 ES Module：
//!
//! ```js
//! import cheerio from "assets://js/lib/cheerio.min.js";
//! import "assets://js/lib/crypto-js.js";
//! import 模板 from "./模板.js";
//! export default { init, home, search, detail, play, ... };
//! ```
//!
//! 而 `ctx.eval` 只能跑脚本语法，遇到 `import` 直接报 `unsupported keyword: import`。
//! 这里按 FongMi 的做法补上模块链路：
//!
//! 1. `Resolver` 负责把模块名规范化：`assets://` 原样、`lib/x` → `js/lib/x`、相对路径按引用方 URL 解析；
//! 2. `Loader` 负责取源码：内嵌资源 / 进程内缓存 / 阻塞式 HTTP / 本地文件；
//! 3. 入口用与 FongMi `spider.js` 等价的一段引导模块加载：
//!    `import * as spider from "<入口>"; globalThis.__JS_SPIDER__ = spider.__jsEvalReturn?.() ?? spider.default`
//! 4. 宿主只提供低层原语（`_http`/`local`/`joinUrl`），`req`/`http` 等由 JS 侧 prelude 定义
//!    （与 FongMi 的 `assets://js/lib/http.js` 一致）。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use rquickjs::loader::{ImportAttributes, Loader, Resolver};
use rquickjs::{Ctx, Module, Object, Runtime};

use crate::error::AppError;

/* ------------------------------ 内嵌运行库 ------------------------------ */

/// FongMi `cat.js`：Cat 系站点的运行库（GPL-3.0，来源见 assets/js/README.md）
const ASSET_CAT: &str = include_str!("../assets/js/lib/cat.js");
const ASSET_CHEERIO: &str = include_str!("../assets/js/lib/cheerio.min.js");
const ASSET_CRYPTO_JS: &str = include_str!("../assets/js/lib/crypto-js.js");
const ASSET_GBK: &str = include_str!("../assets/js/lib/gbk.js");

/// 把 `assets://js/lib/x.js` / `lib/x.js` / `js/lib/x.js` 映射到内嵌源码
pub fn asset_source(name: &str) -> Option<&'static str> {
    let mut path = name;
    if let Some(rest) = path.strip_prefix("assets://") {
        path = rest;
    } else if let Some(rest) = path.strip_prefix("assets:/") {
        path = rest;
    }
    if let Some(rest) = path.strip_prefix('/') {
        path = rest;
    }
    if let Some(rest) = path.strip_prefix("js/") {
        path = rest;
    }
    match path {
        "lib/cheerio.min.js" | "cheerio.min.js" => Some(ASSET_CHEERIO),
        "lib/crypto-js.js" | "crypto-js.js" => Some(ASSET_CRYPTO_JS),
        "lib/gbk.js" | "gbk.js" => Some(ASSET_GBK),
        "lib/cat.js" | "cat.js" => Some(ASSET_CAT),
        _ => None,
    }
}

/* -------------------------------- 模块名解析 -------------------------------- */

/// 基于引用方 URL 解析相对模块名（不依赖 url crate，`assets://` / `http(s)://` / `file://` 一视同仁）
pub fn resolve_relative(base: &str, relative: &str) -> String {
    let resolved = crate::url_util::resolve(base, relative);
    // 模块说明符保留 base 的版本查询串（如 `a.js?v=3` → 同目录模块同样带 `?v=3`），
    // 这是 ESM 加载特有的行为，故不放进通用的 url_util。
    if relative.contains('?') || relative.contains('#') {
        return resolved;
    }
    let query = crate::url_util::query_of(base);
    if query.is_empty() {
        return resolved;
    }
    if let Some(hash) = resolved.find('#') {
        format!("{}{}{}", &resolved[..hash], query, &resolved[hash..])
    } else {
        format!("{resolved}{query}")
    }
}

fn split_segments(path: &str) -> (&'static str, Vec<String>) {
    (
        "",
        path.split('/').filter(|part| !part.is_empty()).map(str::to_string).collect(),
    )
}

/// drpy2 运行库的兜底镜像。
///
/// 生态里不少订阅把自己的 `lib/drpy2.min.js` 与一堆远程模块绑死，那些远程模块一旦下线/被墙
/// （实测 `https://down.nigx.cn/qu.ax/*.js` 全部 403，浏览器 UA + Referer 也无效），
/// 整份 drpy2 就加载不了；但**站点规则文件（ext）本身仍然可用**——换一个可用的 drpy2 就能跑通。
///
/// 只在站点自带的 drpy2 加载失败时才启用，命中时会打日志。
pub const DRPY_FALLBACKS: &[&str] = &[
    "https://raw.liucn.cc/box/libs/js/drpy2.min.js",
    "https://ghproxy.net/https://raw.githubusercontent.com/hjdhnx/dr_py/main/libs/drpy2.min.js",
];

/// 入口是否像 drpy 运行库（而不是站点自己的规则脚本）
pub fn is_drpy_entry(entry: &str) -> bool {
    let lower = entry.to_ascii_lowercase();
    lower.contains("drpy") && lower.contains(".js")
}

/// 某个入口加载失败时，可以改用的兜底入口
pub fn fallback_entries(entry: &str) -> Vec<&'static str> {
    if is_drpy_entry(entry) {
        DRPY_FALLBACKS
            .iter()
            .copied()
            .filter(|candidate| *candidate != entry)
            .collect()
    } else {
        Vec::new()
    }
}

/// 模块名规范化：`assets://`、绝对 URL 原样；`lib/x` 视为 `assets://js/lib/x`；相对名按 base 解析
pub fn resolve_name(base: &str, name: &str) -> String {
    if name.starts_with("assets://") || name.starts_with("assets:/") {
        return name.to_string();
    }
    if name.starts_with("http://") || name.starts_with("https://") || name.starts_with("file://") {
        return name.to_string();
    }
    if let Some(rest) = name.strip_prefix("lib/").or_else(|| name.strip_prefix("js/lib/")) {
        // FongMi 的 Module.fetch：`lib/...` 落到 APK 的 `js/lib/...`
        let candidate = format!("assets://js/lib/{rest}");
        if asset_source(&candidate).is_some() {
            return candidate;
        }
        return if base.is_empty() {
            candidate
        } else {
            resolve_relative(base, &format!("./lib/{rest}"))
        };
    }
    if name.starts_with("./") || name.starts_with("../") {
        if base.is_empty() {
            return name.to_string();
        }
        return resolve_relative(base, name);
    }
    // 裸名当相对路径处理
    if base.is_empty() {
        name.to_string()
    } else {
        resolve_relative(base, &format!("./{name}"))
    }
}

/* -------------------------------- 源码缓存 -------------------------------- */

static MODULE_CACHE: OnceLock<Mutex<HashMap<String, (String, Instant)>>> = OnceLock::new();
const CACHE_TTL: Duration = Duration::from_secs(600);

fn cache() -> &'static Mutex<HashMap<String, (String, Instant)>> {
    MODULE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// JS 侧 HTTP 用的共享运行时。
///
/// 调用都发生在 `spawn_blocking` 线程（js_spider 的执行线程），不是运行时 worker，
/// 因此可以安全地在里面 block_on；这样避免每次请求都新建一个 tokio runtime。
static HTTP_RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();

fn http_runtime() -> Result<&'static tokio::runtime::Runtime, AppError> {
    if let Some(runtime) = HTTP_RUNTIME.get() {
        return Ok(runtime);
    }
    let runtime = tokio::runtime::Runtime::new()
        .map_err(|e| AppError::internal("创建 JS HTTP 运行时失败").with_internal(e.to_string()))?;
    let _ = HTTP_RUNTIME.set(runtime);
    HTTP_RUNTIME
        .get()
        .ok_or_else(|| AppError::internal("初始化 JS HTTP 运行时失败"))
}

/// JS 模块统一用 TVBox 客户端 UA：饭太硬/王二小这类站点按 UA 分流
const TVBOX_UA: &str = "okhttp/3.12.13";

fn fetch_remote(url: &str) -> Result<String, AppError> {
    let client = crate::network::create_client()?;
    let runtime = http_runtime()?;
    let text = runtime.block_on(async {
        let response = client
            .get(url)
            .header("User-Agent", TVBOX_UA)
            .send()
            .await
            .map_err(|e| AppError::network_error(format!("JS 模块请求失败: {url}")).with_internal(e.to_string()))?;
        let status = response.status();
        if !status.is_success() {
            return Err(AppError::network_error(format!("JS 模块 HTTP {}: {url}", status.as_u16())));
        }
        response
            .text()
            .await
            .map_err(|e| AppError::network_error(format!("JS 模块读取失败: {url}")).with_internal(e.to_string()))
    })?;
    Ok(text)
}

/// 取模块源码：内嵌资源 → 文件 → HTTP（带进程内缓存）
pub fn load_source(name: &str) -> Result<String, AppError> {
    if let Some(source) = asset_source(name) {
        return Ok(source.to_string());
    }
    if let Some((source, at)) = cache().lock().unwrap().get(name).cloned() {
        if at.elapsed() < CACHE_TTL {
            return Ok(source);
        }
    }
    let source = if let Some(path) = name.strip_prefix("file://") {
        std::fs::read_to_string(PathBuf::from(path))
            .map_err(|e| AppError::not_found(format!("JS 模块不存在: {name}")).with_internal(e.to_string()))?
    } else if name.starts_with("http://") || name.starts_with("https://") {
        fetch_remote(name)?
    } else {
        return Err(AppError::parse_error(format!("不支持的 JS 模块地址: {name}")));
    };
    cache()
        .lock()
        .unwrap()
        .insert(name.to_string(), (source.clone(), Instant::now()));
    Ok(source)
}

/* ------------------------------ Resolver / Loader ------------------------------ */

pub struct SpiderResolver;

impl Resolver for SpiderResolver {
    fn resolve<'js>(
        &mut self,
        _ctx: &Ctx<'js>,
        base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        Ok(resolve_name(base, name))
    }
}

pub struct SpiderLoader;

impl Loader for SpiderLoader {
    fn load<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<Module<'js, rquickjs::module::Declared>> {
        let source = load_source(name).map_err(|error| {
            ctx.throw(
                rquickjs::String::from_str(ctx.clone(), &format!("JS 模块加载失败: {}", error.message))
                    .map(|value| value.into_value())
                    .unwrap_or_else(|_| rquickjs::Value::new_undefined(ctx.clone())),
            )
        })?;
        Module::declare(ctx.clone(), name, source)
    }
}

/// 给运行时挂上 drpy 的模块解析/加载器
pub fn configure_runtime(runtime: &Runtime) {
    runtime.set_loader(SpiderResolver, SpiderLoader);
}

/* --------------------------------- 入口加载 --------------------------------- */

/// 与 FongMi `assets://js/lib/spider.js` 等价的引导代码。
///
/// 用动态 `import()` 而不是静态 import：静态 import 的失败无法在模块内 try/catch，
/// 出错时只会留下一个"没有导出蜘蛛对象"的空结果；动态 import 能把真实原因记到
/// `globalThis.__SPIDER_ERROR__`，便于定位（远程依赖 403、库不兼容等）。
pub fn bootstrap_source(entry: &str) -> String {
    let name = serde_json::to_string(entry).unwrap_or_else(|_| format!("\"{entry}\""));
    format!(
        "globalThis.__JS_SPIDER__ = undefined;\n\
         globalThis.__SPIDER_ERROR__ = '';\n\
         globalThis.__SPIDER_READY__ = (async function () {{\n\
         \x20 try {{\n\
         \x20   const spider = await import({name});\n\
         \x20   const picked = spider.__jsEvalReturn\n\
         \x20     ? spider.__jsEvalReturn()\n\
         \x20     : (typeof spider.default === 'function' ? spider.default() : spider.default) || spider;\n\
         \x20   if (picked) globalThis.__JS_SPIDER__ = picked;\n\
         \x20 }} catch (error) {{\n\
         \x20   try {{\n\
         \x20     if (error === undefined) globalThis.__SPIDER_ERROR__ = 'thrown undefined';\n\
         \x20     else if (error === null) globalThis.__SPIDER_ERROR__ = 'thrown null';\n\
         \x20     else if (typeof error === 'string') globalThis.__SPIDER_ERROR__ = error;\n\
         \x20     else {{\n\
         \x20       var parts = [];\n\
         \x20       if (error.name) parts.push(String(error.name));\n\
         \x20       if (error.message) parts.push(String(error.message));\n\
         \x20       if (error.stack) parts.push(String(error.stack));\n\
         \x20       if (!parts.length) parts.push('non-error ' + Object.prototype.toString.call(error) + ' ' + String(error));\n\
         \x20       globalThis.__SPIDER_ERROR__ = parts.join(' | ');\n\
         \x20     }}\n\
         \x20   }} catch (inner) {{ globalThis.__SPIDER_ERROR__ = 'describe failed: ' + String(inner); }}\n\
         \x20 }}\n\
         \x20 return globalThis.__JS_SPIDER__;\n\
         }})();"
    )
}

/// 声明并求值入口引导代码（模块内的 import 由 Resolver/Loader 处理）
pub fn declare_entry(ctx: &Ctx<'_>, entry: &str) -> Result<(), AppError> {
    let source = bootstrap_source(entry);
    // 用模块方式求值：保证内部 `import()` 动态导入可用（脚本上下文里不保证支持）
    let module = Module::declare(ctx.clone(), "<spider-bootstrap>", source)
        .map_err(|e| module_error(ctx, "声明引导模块失败", e))?;
    module.eval().map_err(|e| module_error(ctx, "求值入口引导失败", e))?;
    Ok(())
}

/// 在 `ctx.with` 借用之外驱动微任务（top-level await / promise 回调）。
///
/// 必须在借用外调用：`Runtime::is_job_pending` 会再次借用 runtime，
/// 与 `ctx.with` 持有的借用冲突（RefCell already borrowed）。
pub fn drive_pending_jobs(runtime: &Runtime) -> Result<(), AppError> {
    let mut guard = 0;
    while runtime.is_job_pending() {
        runtime
            .execute_pending_job()
            .map_err(|e| AppError::parse_error(format!("JS 微任务执行失败: {e}")))?;
        guard += 1;
        if guard > 10_000 {
            return Err(AppError::parse_error("JS 微任务过多，疑似死循环"));
        }
    }
    Ok(())
}

/// 模块求值完成后取蜘蛛对象（调用方重新进入 ctx 后使用）
pub fn spider_object<'js>(ctx: &Ctx<'js>) -> Result<Object<'js>, AppError> {
    // 动态 import 的失败会记在这里，优先报出来，否则只剩"没有导出蜘蛛对象"这种无信息量的话
    if let Ok(error) = ctx.globals().get::<&str, String>("__SPIDER_ERROR__") {
        if !error.trim().is_empty() {
            return Err(AppError::parse_error(format!("JS 蜘蛛模块加载失败: {}", error.trim())));
        }
    }

    let spider: rquickjs::Value = ctx
        .globals()
        .get("__JS_SPIDER__")
        .map_err(|e| AppError::parse_error(format!("JS 蜘蛛未导出对象: {}", describe_exception(ctx, e))))?;
    if spider.is_undefined() || spider.is_null() {
        return Err(AppError::parse_error("JS 蜘蛛模块没有导出可用的蜘蛛对象"));
    }
    spider
        .into_object()
        .ok_or_else(|| AppError::parse_error("JS 蜘蛛模块导出的不是对象"))
}

/// 把 QuickJS 的异常对象转成可读文本（rquickjs 自己只给 "Exception generated by QuickJS"）
pub fn describe_exception(ctx: &Ctx<'_>, error: rquickjs::Error) -> String {
    let caught: rquickjs::Value = ctx.catch();
    if let Some(object) = caught.as_object() {
        let mut parts: Vec<String> = Vec::new();
        if let Ok(message) = object.get::<&str, String>("message") {
            parts.push(message);
        }
        if let Ok(stack) = object.get::<&str, String>("stack") {
            if !stack.is_empty() {
                parts.push(stack);
            }
        }
        if !parts.is_empty() {
            return parts.join(" | ");
        }
    }
    match caught.as_string().and_then(|text| text.to_string().ok()) {
        Some(text) if !text.is_empty() => text,
        _ => error.to_string(),
    }
}

fn module_error(ctx: &Ctx<'_>, prefix: &str, error: rquickjs::Error) -> AppError {
    let internal = error.to_string();
    AppError::parse_error(format!("{prefix}: {}", describe_exception(ctx, error))).with_internal(internal)
}

/* --------------------------------- 宿主原语 --------------------------------- */

/// 安装 `_http`/`local`/`joinUrl` 等低层原语，并用 prelude 定义 `req`/`http`/`pdfh` 等（等价 FongMi `http.js` + TVBox 宿主绑定）
pub fn install_host_primitives(ctx: &Ctx<'_>) -> Result<(), AppError> {
    install_http(ctx)?;
    install_local(ctx)?;
    install_join_url(ctx)?;
    // prelude 需要 import 内置 cheerio（pdfh/pdfa/pd 的基础），因此按模块求值
    let module = Module::declare(ctx.clone(), "<host-prelude>", HTTP_PRELUDE)
        .map_err(|e| module_error(ctx, "声明宿主 prelude 失败", e))?;
    module
        .eval()
        .map_err(|e| module_error(ctx, "求值宿主 prelude 失败", e))?;
    ctx.eval::<(), _>(TIMER_SHIM)
        .map_err(|e| module_error(ctx, "安装计时器垫片失败", e))?;
    Ok(())
}

fn install_http(ctx: &Ctx<'_>) -> Result<(), AppError> {
    let raw = rquickjs::Function::new(
        ctx.clone(),
        |url: String, options_json: String| -> String { http_raw(&url, &options_json) },
    )
    .map_err(|e| AppError::internal(e.to_string()))?;
    ctx.globals()
        .set("__httpRaw", raw)
        .map_err(|e| AppError::internal(format!("设置 __httpRaw 失败: {e}")))?;
    Ok(())
}

#[derive(Default)]
struct HttpOptions {
    method: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    timeout_secs: u64,
    buffer: u8,
}

fn parse_http_options(options: &serde_json::Value) -> HttpOptions {
    let mut parsed = HttpOptions {
        method: "GET".into(),
        timeout_secs: 15,
        ..Default::default()
    };
    if let Some(method) = options.get("method").and_then(|v| v.as_str()) {
        parsed.method = method.to_uppercase();
    }
    if let Some(headers) = options.get("headers").and_then(|v| v.as_object()) {
        for (key, value) in headers {
            if let Some(value) = value.as_str() {
                parsed.headers.push((key.clone(), value.to_string()));
            }
        }
    }
    // FongMi 的 body / data 都表示请求体
    for key in ["body", "data", "postData"] {
        if let Some(value) = options.get(key) {
            if !value.is_null() {
                parsed.body = Some(match value {
                    serde_json::Value::String(text) => text.clone(),
                    other => other.to_string(),
                });
                break;
            }
        }
    }
    if let Some(timeout) = options.get("timeout").and_then(|v| v.as_u64()) {
        parsed.timeout_secs = timeout.max(1);
    }
    if let Some(buffer) = options.get("buffer").and_then(|v| v.as_u64()) {
        parsed.buffer = buffer as u8;
    }
    parsed
}

/// 同步 HTTP：返回 FongMi `Connect.success` 形状的 JSON（code / status / headers / url / content）
fn http_raw(url: &str, options_json: &str) -> String {
    let options: serde_json::Value =
        serde_json::from_str(options_json).unwrap_or(serde_json::Value::Null);
    let parsed = parse_http_options(&options);

    let result = http_runtime().and_then(|runtime| runtime.block_on(async {
        let client = crate::network::create_client()?;
        let method = reqwest::Method::from_bytes(parsed.method.as_bytes())
            .unwrap_or(reqwest::Method::GET);
        let mut request = client
            .request(method, url)
            .timeout(Duration::from_secs(parsed.timeout_secs));
        for (key, value) in &parsed.headers {
            request = request.header(key.as_str(), value.as_str());
        }
        if let Some(body) = parsed.body.clone() {
            request = request.body(body);
        }
        let response = request
            .send()
            .await
            .map_err(|e| AppError::network_error(format!("JS 请求失败: {url}")).with_internal(e.to_string()))?;

        let status = response.status().as_u16();
        let final_url = response.url().to_string();
        let mut headers = serde_json::Map::new();
        for (key, value) in response.headers() {
            if let Ok(text) = value.to_str() {
                headers.insert(key.as_str().to_string(), serde_json::Value::String(text.to_string()));
            }
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|e| AppError::network_error(format!("JS 请求读取失败: {url}")).with_internal(e.to_string()))?;

        let content = match parsed.buffer {
            1 => serde_json::Value::Array(bytes.iter().map(|b| serde_json::Value::from(*b)).collect()),
            2 => serde_json::Value::String(base64_encode(&bytes)),
            _ => serde_json::Value::String(String::from_utf8_lossy(&bytes).into_owned()),
        };

        Ok::<serde_json::Value, AppError>(serde_json::json!({
            "code": status,
            "status": status,
            "headers": headers,
            "url": final_url,
            "content": content,
        }))
    }));

    match result {
        Ok(value) => value.to_string(),
        Err(error) => serde_json::json!({
            "code": 500,
            "status": 500,
            "headers": {},
            "url": url,
            "content": "",
            "error": error.message,
        })
        .to_string(),
    }
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { TABLE[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(n & 63) as usize] as char } else { '=' });
    }
    out
}

/// drpy 的 `local`：进程内键值存储（FongMi 用 SharedPreferences 持久化，这里先按会话内存）
static LOCAL_STORE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn local_store() -> &'static Mutex<HashMap<String, String>> {
    LOCAL_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn install_local(ctx: &Ctx<'_>) -> Result<(), AppError> {
    // 契约对齐 FongMi `method/Local.java`：get(rule,key) / set(rule,key,value) / delete(rule,key)，
    // 键名为 `cache_<rule>_<key>`。drpy2 的 getItem/setItem 就是这么调的
    // （`local.set(RKEY,k,v)` / `local.get(RKEY,k)`）；参数不匹配会让持久化静默错乱。
    let get = rquickjs::Function::new(ctx.clone(), |rule: String, key: String| -> String {
        local_store()
            .lock()
            .unwrap()
            .get(&local_key(&rule, &key))
            .cloned()
            .unwrap_or_default()
    })
    .map_err(|e| AppError::internal(e.to_string()))?;
    let set = rquickjs::Function::new(
        ctx.clone(),
        |rule: String, key: String, value: String| {
            local_store()
                .lock()
                .unwrap()
                .insert(local_key(&rule, &key), value);
        },
    )
    .map_err(|e| AppError::internal(e.to_string()))?;
    let remove = rquickjs::Function::new(ctx.clone(), |rule: String, key: String| {
        local_store().lock().unwrap().remove(&local_key(&rule, &key));
    })
    .map_err(|e| AppError::internal(e.to_string()))?;
    let clear = rquickjs::Function::new(ctx.clone(), || {
        local_store().lock().unwrap().clear();
    })
    .map_err(|e| AppError::internal(e.to_string()))?;

    let object = Object::new(ctx.clone()).map_err(|e| AppError::internal(e.to_string()))?;
    object.set("get", get).map_err(|e| AppError::internal(e.to_string()))?;
    object.set("set", set).map_err(|e| AppError::internal(e.to_string()))?;
    object.set("delete", remove).map_err(|e| AppError::internal(e.to_string()))?;
    object.set("clear", clear).map_err(|e| AppError::internal(e.to_string()))?;
    ctx.globals()
        .set("local", object)
        .map_err(|e| AppError::internal(format!("设置 local 失败: {e}")))?;
    Ok(())
}

/// 与 FongMi `Local.getKey` 相同的键名规则
pub fn local_key(rule: &str, key: &str) -> String {
    if rule.is_empty() {
        format!("cache_{key}")
    } else {
        format!("cache_{rule}_{key}")
    }
}

fn install_join_url(ctx: &Ctx<'_>) -> Result<(), AppError> {
    let join = rquickjs::Function::new(ctx.clone(), |parent: String, child: String| -> String {
        if child.starts_with("http://") || child.starts_with("https://") || child.starts_with("//") {
            return child;
        }
        if parent.is_empty() {
            return child;
        }
        resolve_relative(if parent.ends_with('/') { &parent[..parent.len() - 1] } else { &parent }, &child)
    })
    .map_err(|e| AppError::internal(e.to_string()))?;
    ctx.globals()
        .set("__joinUrl", join)
        .map_err(|e| AppError::internal(format!("设置 __joinUrl 失败: {e}")))?;
    Ok(())
}

/// 计时器垫片。
///
/// 我们的 JS 执行是"跑完就返回"的阻塞模型，没有事件循环，`setTimeout` 只能立即执行回调
/// （大量 drpy/混淆站点用它做小延迟或重试）。`setInterval` 只跑一次，避免把站点卡死。
pub const TIMER_SHIM: &str = r#"
(function () {
  var nextId = 1;
  if (typeof globalThis.setTimeout !== 'function') {
    globalThis.setTimeout = function (fn, _delay) {
      var id = nextId++;
      if (typeof fn === 'function') {
        try { fn(); } catch (e) { console.error('setTimeout callback error: ' + (e && e.message)); }
      }
      return id;
    };
  }
  if (typeof globalThis.clearTimeout !== 'function') { globalThis.clearTimeout = function () {}; }
  if (typeof globalThis.clearInterval !== 'function') { globalThis.clearInterval = function () {}; }
  if (typeof globalThis.setInterval !== 'function') {
    globalThis.setInterval = function (fn, delay) { return globalThis.setTimeout(fn, delay); };
  }
})();
"#;

/// 宿主 JS prelude（按模块求值，可 import 内置 cheerio）
///
/// 组成：
/// - `_http`/`req`/`http`：等价 FongMi `assets://js/lib/http.js`
/// - `pdfh`/`pdfa`/`pd`：TVBox 宿主绑定的选择器迷你语法（`a&&b--text`），drpy 站点规则大量依赖
/// - `joinUrl`/`urljoin`、`global`/`window`/`self` 别名
const HTTP_PRELUDE: &str = r#"
import cheerio from 'assets://js/lib/cheerio.min.js';
import 'assets://js/lib/crypto-js.js';
globalThis.cheerio = cheerio;

function __jsonCall(url, options) {
  return JSON.parse(__httpRaw(url, JSON.stringify(options || {})));
}
globalThis._http = function (url, options) {
  var res = __jsonCall(url, options);
  if (options && typeof options.complete === 'function') {
    try { options.complete(res); } catch (e) { console.error(e && e.message); }
    return null;
  }
  return res;
};
function http(url, options) {
  options = options || {};
  if (options.async === false) return __jsonCall(url, options);
  return Promise.resolve(__jsonCall(url, options));
}
function req(url, options) {
  return http(url, Object.assign({ async: false }, options));
}
globalThis.http = http;
globalThis.req = req;
function joinUrl(parent, child) { return __joinUrl(parent, child); }
globalThis.joinUrl = joinUrl;
globalThis.urljoin = joinUrl;

/* ------------------------- TVBox 选择器迷你语法 ------------------------- */

function __splitStep(step) {
  var index = step.indexOf('--');
  if (index < 0) return { selector: step.trim(), op: 'text' };
  return { selector: step.slice(0, index).trim(), op: step.slice(index + 2).trim() || 'text' };
}

function __splitIndex(selector) {
  var match = selector.match(/^(.*?)\[(\d+)\]$/);
  if (!match) return { selector: selector, index: -1 };
  return { selector: match[1], index: parseInt(match[2], 10) };
}

function __elements($, root, selector) {
  var parts = __splitIndex(selector);
  var matched = parts.selector ? $(root).find(parts.selector) : $(root).children();
  if (parts.index >= 0) matched = matched.eq(parts.index);
  return matched;
}

function __extract($, element, op, baseUrl) {
  var pieces = op.split(':');
  var name = (pieces[0] || 'text').trim();
  var regex = pieces.length > 1 ? pieces.slice(1).join(':') : '';
  var node = $(element);
  var lower = name.toLowerCase();
  var value = '';
  if (lower === 'text') value = node.text();
  else if (lower === 'html') value = node.html() || '';
  else if (lower === 'outerhtml') value = $.html(element) || '';
  else value = node.attr(name) || '';
  if (regex) {
    try {
      var matched = String(value).match(new RegExp(regex));
      if (matched) value = matched[1] !== undefined ? matched[1] : matched[0];
      else value = '';
    } catch (e) { /* 正则不合法就保持原值 */ }
  }
  value = String(value == null ? '' : value).trim();
  if (baseUrl && value && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    try { value = new URL(value, baseUrl).toString(); } catch (e) { /* 相对地址拼接失败就原样返回 */ }
  }
  return value;
}

/** 逐级下降：返回每一级的 cheerio 包装元素数组（loaded 为 true 时用独立文档承载） */
function __walk(html, parse) {
  var steps = String(parse || '').trim().split('&&');
  var $ = cheerio.load(html);
  var current = [$('body').length ? $('body') : $.root()];
  var lastSelector = '';
  for (var i = 0; i < steps.length; i++) {
    var step = __splitStep(steps[i]);
    var next = [];
    for (var j = 0; j < current.length; j++) {
      var matched = __elements($, current[j], step.selector);
      matched.each(function (index, element) { next.push(element); });
    }
    current = next;
    lastSelector = steps[i];
    if (current.length === 0) return { $: $, elements: [], last: step };
  }
  return { $: $, elements: current, last: __splitStep(lastSelector) };
}

function pdfh(html, parse, baseUrl) {
  if (!html || !parse) return '';
  try {
    var result = __walk(html, parse);
    if (!result.elements.length) return '';
    return __extract(result.$, result.elements[0], result.last.op, baseUrl);
  } catch (e) {
    console.error('pdfh error: ' + (e && e.message));
    return '';
  }
}

function pdfa(html, parse) {
  if (!html || !parse) return [];
  try {
    var result = __walk(html, parse);
    if (!result.elements.length) return [];
    return result.elements.map(function (element) { return result.$.html(element) || ''; });
  } catch (e) {
    console.error('pdfa error: ' + (e && e.message));
    return [];
  }
}

function pd(html, parse, baseUrl) {
  return pdfh(html, parse, baseUrl);
}

globalThis.pdfh = pdfh;
globalThis.pdfa = pdfa;
globalThis.pd = pd;

/* ------------------- TVBox/catvod 宿主绑定（等价 com.github.catvod.js.Function） ------------------- */

// SpiderDebug：catvod 侧注入的日志器，站点普遍会调用（部分站点只用它打日志）
globalThis.SpiderDebug = (function () {
  function emit() {
    try {
      var parts = Array.prototype.slice.call(arguments).map(function (item) {
        return typeof item === 'string' ? item : JSON.stringify(item);
      });
      console.log.apply(null, ['[SpiderDebug]'].concat(parts));
    } catch (e) { /* 日志失败不影响业务 */ }
  }
  var api = { log: emit, error: emit, warn: emit, info: emit, debug: emit, close: function () {}, destroy: function () {} };
  // 未知方法一律当空操作，避免站点因为日志方法名不同就整站失败
  return new Proxy(api, {
    get: function (target, name) {
      if (name in target) return target[name];
      return function () {};
    }
  });
})();

// aesX：签名与 FongMi Global.java 一致 → (mode, encrypt, input, inBase64, key, iv, outBase64)
globalThis.aesX = function (mode, encrypt, input, inBase64, key, iv, outBase64) {
  try {
    var spec = String(mode || 'AES/CBC/PKCS5Padding');
    var upper = spec.toUpperCase();
    var options = { padding: /NOPADDING/i.test(upper) ? CryptoJS.pad.NoPadding : CryptoJS.pad.Pkcs7 };
    if (upper.indexOf('ECB') >= 0) options.mode = CryptoJS.mode.ECB;
    else if (upper.indexOf('CTR') >= 0) options.mode = CryptoJS.mode.CTR;
    else if (upper.indexOf('CFB') >= 0) options.mode = CryptoJS.mode.CFB;
    else if (upper.indexOf('OFB') >= 0) options.mode = CryptoJS.mode.OFB;
    else {
      options.mode = CryptoJS.mode.CBC;
      options.iv = CryptoJS.enc.Utf8.parse(iv || '');
    }
    var keyWords = CryptoJS.enc.Utf8.parse(key);
    if (encrypt) {
      var plain = inBase64 ? CryptoJS.enc.Base64.parse(String(input)) : String(input);
      var encrypted = CryptoJS.AES.encrypt(plain, keyWords, options);
      return outBase64 ? encrypted.toString() : encrypted.ciphertext.toString(CryptoJS.enc.Utf8);
    }
    var cipher = inBase64 ? String(input) : CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(String(input)));
    var decrypted = CryptoJS.AES.decrypt(cipher, keyWords, options);
    return outBase64 ? CryptoJS.enc.Base64.stringify(decrypted) : decrypted.toString(CryptoJS.enc.Utf8);
  } catch (e) {
    console.error('aesX error: ' + (e && e.message));
    return '';
  }
};

// rsaX / getPort / getProxy：FongMi 由 Java 侧实现（RSA 与本地代理端口）。
// 这里先给出明确语义的占位，避免站点以"某个名字未定义"这种无从判断的方式失败。
globalThis.rsaX = function () {
  console.error('rsaX 暂未实现（需要 RSA 实现，当前运行时未提供）');
  return '';
};
globalThis.getPort = function () { return 0; };
globalThis.getProxy = function (url) { return url; };

function defineGlobalAlias(name) {
  var descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  if (descriptor && !descriptor.configurable) return;
  Object.defineProperty(globalThis, name, {
    enumerable: true,
    configurable: true,
    get: function () { return globalThis; },
    set: function () {}
  });
}
['global', 'window', 'self'].forEach(defineGlobalAlias);
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_assets_and_lib_prefixes() {
        assert_eq!(resolve_name("", "assets://js/lib/cheerio.min.js"), "assets://js/lib/cheerio.min.js");
        assert_eq!(resolve_name("", "lib/gbk.js"), "assets://js/lib/gbk.js");
        assert!(asset_source("assets://js/lib/cheerio.min.js").is_some());
        assert!(asset_source("lib/crypto-js.js").is_some());
        assert!(asset_source("assets://js/lib/unknown.js").is_none());
    }

    #[test]
    fn resolves_relative_against_base_url() {
        let base = "https://raw.githubusercontent.com/gaotianliuyun/gao/master/lib/drpy2.min.js";
        // 统一走 RFC 解析后中文路径会被百分号编码（旧的手工拼接保留原字符）；
        // 实测两种形式服务器都返回同样的内容（200/15217 字节），且 reqwest 发请求时本来也会编码。
        assert_eq!(
            resolve_name(base, "./模板.js"),
            "https://raw.githubusercontent.com/gaotianliuyun/gao/master/lib/%E6%A8%A1%E6%9D%BF.js"
        );
        assert_eq!(
            resolve_name(base, "../js/drpy.js"),
            "https://raw.githubusercontent.com/gaotianliuyun/gao/master/js/drpy.js"
        );
        assert_eq!(
            resolve_name(base, "https://down.nigx.cn/qu.ax/cLFE.js"),
            "https://down.nigx.cn/qu.ax/cLFE.js"
        );
    }

    #[test]
    fn resolve_relative_keeps_query_and_scheme() {
        assert_eq!(
            resolve_relative("http://host/a/b/c.js?v=1", "./d.js"),
            "http://host/a/b/d.js?v=1"
        );
        assert_eq!(resolve_relative("assets://js/lib/a.js", "../x.js"), "assets://js/x.js");
    }

    #[test]
    fn local_binding_follows_fongmi_contract() {
        // 对齐 FongMi method/Local.java：get(rule,key)/set(rule,key,value)/delete(rule,key)
        let runtime = rquickjs::Runtime::new().expect("创建 runtime");
        let context = rquickjs::Context::full(&runtime).expect("创建 context");
        context.with(|ctx| {
            install_local(&ctx).expect("安装 local");
            ctx.eval::<(), _>("local.set('contract_rule','k','v')").expect("set");
            let value: String = ctx.eval("local.get('contract_rule','k')").expect("get");
            assert_eq!(value, "v", "三参 set + 两参 get 必须能取回值");

            let missing: String = ctx.eval("local.get('contract_rule','none')").expect("get 缺省");
            assert_eq!(missing, "", "缺省返回空串（drpy2 依赖 `local.get(..)||默认值`）");

            let isolated: String = ctx.eval("local.get('other_rule','k')").expect("命名空间隔离");
            assert_eq!(isolated, "", "不同 rule 命名空间不能串味");

            ctx.eval::<(), _>("local.delete('contract_rule','k')").expect("delete");
            let deleted: String = ctx.eval("local.get('contract_rule','k')").expect("get after delete");
            assert_eq!(deleted, "");
        });
        assert_eq!(local_key("r", "k"), "cache_r_k");
        assert_eq!(local_key("", "k"), "cache_k");
    }

    #[test]
    fn identifies_drpy_entries_and_fallbacks() {
        assert!(is_drpy_entry("https://host/lib/drpy2.min.js"));
        assert!(is_drpy_entry("https://host/dr/drpy.min.js"));
        assert!(!is_drpy_entry("https://host/js/荐片.js"));

        let fallbacks = fallback_entries("https://host/lib/drpy2.min.js");
        assert!(!fallbacks.is_empty(), "drpy 入口应有兜底镜像");
        assert!(fallbacks.iter().all(|url| url.contains("drpy")));

        // 站点自己的规则脚本不该被换成 drpy 运行库
        assert!(fallback_entries("https://host/js/site.js").is_empty());
        // 兜底列表里不应出现候选自身
        assert!(fallback_entries(DRPY_FALLBACKS[0])
            .iter()
            .all(|url| *url != DRPY_FALLBACKS[0]));
    }

    #[test]
    fn bootstrap_uses_dynamic_import_and_reports_errors() {
        let source = bootstrap_source("https://host/lib/drpy2.min.js");
        assert!(source.contains("import(\"https://host/lib/drpy2.min.js\")"));
        assert!(source.contains("__jsEvalReturn"));
        assert!(source.contains("spider.default"));
        assert!(source.contains("__SPIDER_ERROR__"));
    }

    #[test]
    fn base64_encoder_matches_padding_rules() {
        assert_eq!(base64_encode(b"a"), "YQ==");
        assert_eq!(base64_encode(b"ab"), "YWI=");
        assert_eq!(base64_encode(b"abc"), "YWJj");
    }
}
