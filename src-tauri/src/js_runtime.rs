//! JS 执行引擎（由 `js_spider` 与 `js_session` 共用）。

use rquickjs::{Context, Function, Object, Runtime};
use serde_json::Value as JsonValue;

use crate::error::AppError;
use crate::network;

/// JS 执行引擎：创建 Runtime/Context、安装宿主环境、加载脚本或 ES Module、调用蜘蛛方法。
///
/// 与 `js_spider`（对外 API）、`js_session`（会话生命周期/缓存）、`js_module`（模块解析与加载）
/// 分层：依赖方向是 js_spider → js_session → js_runtime → js_module，不存在环。


    pub(crate) fn prepare_spider(
        api_url: &str,
        ext: Option<&str>,
        deadline: std::sync::Arc<std::sync::atomic::AtomicU64>,
    ) -> Result<(Runtime, Context, u64), AppError> {
        let rt = tokio::runtime::Runtime::new()
            .map_err(|e| AppError::internal("创建临时运行时失败").with_internal(e.to_string()))?;
        // 入口本身可能就是坏掉的 drpy 运行库（实测 俊佬在线 的 drpy.min.js 直接 401），
        // 这种情况也要能换镜像，否则连"是不是模块"都判断不了。
        let (entry_url, js_code) = fetch_entry_with_fallback(&rt, api_url)?;
        let is_module = is_module_source(&js_code);

        let runtime = Runtime::new()
            .map_err(|e| AppError::internal("创建 JS 运行时失败").with_internal(e.to_string()))?;
        // drpy 要额外装载 cheerio/crypto-js，给足内存与执行时间
        runtime.set_memory_limit(if is_module {
            256 * 1024 * 1024
        } else {
            64 * 1024 * 1024
        });
        if is_module {
            crate::js_module::configure_runtime(&runtime);
        }
        let budget = if is_module { 20 } else { 8 };
        // 装载期间先放一个宽松截止时间，真正执行前由会话线程按 budget 重设
        deadline.store(
            crate::js_session::now_ms() + 120_000,
            std::sync::atomic::Ordering::Relaxed,
        );
        let handler_deadline = deadline.clone();
        runtime.set_interrupt_handler(Some(Box::new(move || {
            crate::js_session::now_ms()
                >= handler_deadline.load(std::sync::atomic::Ordering::Relaxed)
        })));
        let ctx = Context::full(&runtime)
            .map_err(|e| AppError::internal("创建 JS 上下文失败").with_internal(e.to_string()))?;

        if is_module {
            // ES Module 分三步，且必须跨 ctx 借用边界：
            // 1) 借用内装环境；2) 借用外驱动微任务（is_job_pending 会再借 runtime，
            // 放 ctx.with 里会 panic）；3) 借用内取蜘蛛对象并调用方法。
            ctx.with(|ctx| {
                setup_js_env(&ctx)?;
                crate::js_module::install_host_primitives(&ctx)
            })?;
            load_module_spider(&ctx, &runtime, &entry_url, ext)?;
        } else {
            ctx.with(|ctx| {
                setup_js_env(&ctx)?;
                load_js_module(&ctx, &js_code, ext)
            })?;
        }

        Ok((runtime, ctx, budget))
    }

    /// 调用蜘蛛方法并把结果解析成 JSON
    pub(crate) fn invoke_method(
        context: &Context,
        method: &str,
        args: &[JsonValue],
    ) -> Result<JsonValue, AppError> {
        context.with(|ctx| {
            let spider: Object = ctx
                .globals()
                .get("__JS_SPIDER__")
                .map_err(|e| AppError::parse_error(format!("JS 蜘蛛未导出有效对象: {}", e)))?;

            call_method(&ctx, &spider, method, args).and_then(|result_str| {
                serde_json::from_str(&result_str)
                    .map_err(|e| AppError::parse_error(format!("JS 结果解析失败: {}", e)))
            })
        })
    }

    fn setup_js_env(ctx: &rquickjs::Ctx) -> Result<(), AppError> {
        let log_fn = Function::new(ctx.clone(), |msg: String| {
            eprintln!("[JS Spider] {}", msg);
        })
        .or(Err(AppError::internal("创建 log 失败")))?;

        let console_obj =
            Object::new(ctx.clone()).or(Err(AppError::internal("创建 console 失败")))?;
        console_obj
            .set("log", log_fn.clone())
            .or(Err(AppError::internal("设置 log 失败")))?;
        console_obj
            .set("error", log_fn)
            .or(Err(AppError::internal("设置 error 失败")))?;
        ctx.globals()
            .set("console", console_obj)
            .or(Err(AppError::internal("设置 console 失败")))?;

        let req_fn = Function::new(ctx.clone(), |url: String| {
            if let Ok(rt) = tokio::runtime::Runtime::new() {
                if let Ok(client) = network::create_client() {
                    let result = rt
                        .block_on(async { client.get(&url).send().await })
                        .and_then(|resp| rt.block_on(resp.text()));
                    if let Ok(text) = result {
                        return text;
                    }
                }
            }
            String::new()
        })
        .or(Err(AppError::internal("创建 req 失败")))?;

        ctx.globals()
            .set("req", req_fn.clone())
            .or(Err(AppError::internal("设置 req 失败")))?;
        ctx.globals()
            .set("_http", req_fn)
            .or(Err(AppError::internal("设置 _http 失败")))?;

        // 脚本路径同样需要计时器垫片（模块路径由 js_module::install_host_primitives 安装）
        ctx.eval::<(), _>(crate::js_module::TIMER_SHIM)
            .map_err(|e| AppError::internal(format!("安装计时器垫片失败: {e}")))?;

        let globals = ctx.globals();
        for &alias in &["global", "window", "self"] {
            ctx.globals()
                .set(alias, globals.clone())
                .or(Err(AppError::internal(format!("设置 {alias} 失败"))))?;
        }

        Ok(())
    }

    /// 源码是否含 ES Module 语法：这类蜘蛛走模块运行时（drpy/Cat）
    ///
    /// 不能只看行首——生态里大量脚本被**压缩成一行**（例：363KB 的 `lf_search3_min.js`，
    /// `import _0x108086 from'\\x61\\x73...'` 与 `export default{...}` 都在行中），
    /// 只看行首会把它当脚本跑，直接语法错误。
    fn is_module_source(code: &str) -> bool {
        static MODULE_HINT: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
            regex::Regex::new(
                r#"(?m)(^\s*(?:import|export)\b)|(?:\bexport\s+(?:default|const|let|var|function|class|\{|\*))|(?:\bimport\s*["'{*])|(?:\bimport\s+[A-Za-z_$][\w$]*\s+from\b)"#,
            )
            .expect("模块特征正则必须合法")
        });
        MODULE_HINT.is_match(code)
    }

    /// 装载 ES Module 蜘蛛。
    ///
    /// 站点自带的 drpy2 常常和一批远程模块绑死；那些模块下线/被墙时整份 drpy2 都加载不了，
    /// 但站点规则（ext）本身是好的——所以加载失败时按 `js_module::DRPY_FALLBACKS` 换镜像重试。
    fn load_module_spider(
        context: &rquickjs::Context,
        runtime: &Runtime,
        api_url: &str,
        ext: Option<&str>,
    ) -> Result<(), AppError> {
        let mut candidates: Vec<String> = vec![api_url.to_string()];
        candidates.extend(
            crate::js_module::fallback_entries(api_url)
                .into_iter()
                .map(str::to_string),
        );

        let mut last_error: Option<AppError> = None;
        for (index, entry) in candidates.iter().enumerate() {
            if index > 0 {
                eprintln!("[spider] 自带 drpy 运行库不可用，改用兜底镜像: {entry}");
            }
            if let Err(error) = context.with(|ctx| crate::js_module::declare_entry(&ctx, entry)) {
                last_error = Some(error);
                continue;
            }
            if let Err(error) = crate::js_module::drive_pending_jobs(runtime) {
                last_error = Some(error);
                continue;
            }
            match context.with(|ctx| finish_module_spider(&ctx, ext)) {
                Ok(()) => return Ok(()),
                Err(error) => last_error = Some(error),
            }
        }
        Err(last_error.unwrap_or_else(|| AppError::parse_error("JS 蜘蛛模块加载失败")))
    }

    /// 模块求值完成、微任务驱动完之后：取蜘蛛对象并 `init(ext)`
    fn finish_module_spider(ctx: &rquickjs::Ctx, ext: Option<&str>) -> Result<(), AppError> {
        let spider = crate::js_module::spider_object(ctx)?;

        // drpy2 依赖 init(ext) 装载具体站点的规则文件（ext 已由应用侧解析为绝对地址）
        if let Ok(init_fn) = spider.get::<&str, Function>("init") {
            let ext_val = ext.unwrap_or("");
            if let Err(error) = init_fn.call::<(&str,), ()>((ext_val,)) {
                eprintln!("[spider] init(ext) 失败: {error}");
            }
        }

        Ok(())
    }

    fn load_js_module(
        ctx: &rquickjs::Ctx,
        js_code: &str,
        ext: Option<&str>,
    ) -> Result<(), AppError> {
        let (code, exported_names) = transform_module_syntax(js_code);

        // 脚本模式下无法解析 import：这类蜘蛛通常是 drpy 运行库，依赖 assets:// 组件，
        // 直接评估只会报 "unsupported keyword: import"，这里给出可执行的明确原因。
        if let Some(import_line) = js_code
            .lines()
            .map(str::trim_start)
            .find(|line| line.starts_with("import ") || line.starts_with("import{"))
        {
            return Err(AppError::parse_error(format!(
                "该 JS 蜘蛛依赖 ES Module import（多为 drpy 运行库 + assets:// 组件），当前版本不支持：{}",
                import_line.chars().take(80).collect::<String>()
            )));
        }

        // 具名导出（export function home / export { home }）在裸 eval 里没有模块对象可挂，
        // 这里显式收集成对象作为 __JS_SPIDER__ 兜底。
        let named_exports = exported_names
            .iter()
            .map(|name| format!("    if (typeof {name} !== 'undefined') __named['{name}'] = {name};"))
            .collect::<Vec<_>>()
            .join("\n");

        let wrapped = format!(
            r#"
(function() {{
    var module = {{ exports: {{}} }};
    var exports = module.exports;
    // 先声明成全局属性：jsjiami 等混淆器生成的蜘蛛会在末尾裸赋值 `__JS_SPIDER__ = {{...}}`，
    // 而 rquickjs 的 ctx.eval 默认严格模式，未声明的裸赋值会直接 ReferenceError。
    globalThis.__JS_SPIDER__ = undefined;
    {code}
    if (!globalThis.__JS_SPIDER__) {{
        if (module.exports) {{
            if (typeof module.exports === 'function') {{
                globalThis.__JS_SPIDER__ = module.exports();
            }} else if (module.exports.__jsEvalReturn) {{
                globalThis.__JS_SPIDER__ = module.exports.__jsEvalReturn();
            }} else if (Object.keys(module.exports).length > 0) {{
                globalThis.__JS_SPIDER__ = module.exports;
            }}
        }}
    }}
    if (!globalThis.__JS_SPIDER__ && {has_named}) {{
        var __named = {{}};
{named_exports}
        if (Object.keys(__named).length > 0) {{
            globalThis.__JS_SPIDER__ = __named;
        }}
    }}
    if (!globalThis.__JS_SPIDER__ && typeof home === 'function') {{
        globalThis.__JS_SPIDER__ = {{ home: home, homeVod: homeVod || function() {{ return ''; }}, category: category, detail: detail, search: search, play: play, init: init || function() {{ }} }};
    }}
}})();
"#,
            code = code,
            has_named = if exported_names.is_empty() { "false" } else { "true" },
            named_exports = named_exports
        );

        // 用非严格模式求值：rquickjs 的 EvalOptions 默认 strict=true，
        // 而 TVBox/FongMi 宿主都是按普通脚本跑蜘蛛的，混淆器生成的代码也依赖这一点。
        let mut options = rquickjs::context::EvalOptions::default();
        options.global = true;
        options.strict = false;
        if let Err(error) = ctx.eval_with_options::<(), _>(wrapped.as_str(), options) {
            // rquickjs 只给出 "Exception generated by QuickJS"，真实原因在 ctx.catch() 里，
            // 这里把它取出来（JS 的 message / stack），否则用户与日志都无从判断。
            let caught: rquickjs::Value = ctx.catch();
            let mut detail = String::new();
            if let Some(object) = caught.as_object() {
                if let Ok(message) = object.get::<&str, String>("message") {
                    detail = message;
                }
                if let Ok(stack) = object.get::<&str, String>("stack") {
                    if !stack.is_empty() {
                        detail = format!("{detail} | {stack}");
                    }
                }
            }
            if detail.trim().is_empty() {
                detail = match caught.as_string().and_then(|text| text.to_string().ok()) {
                    Some(text) => text,
                    None => format!("{caught:?}"),
                };
            }
            return Err(
                AppError::parse_error(format!("JS 加载失败: {}", detail.trim()))
                    .with_internal(error.to_string()),
            );
        }

        let spider: Object = ctx
            .globals()
            .get("__JS_SPIDER__")
            .map_err(|e| AppError::parse_error(format!("JS 蜘蛛未导出有效对象: {}", e)))?;

        if let Ok(init_fn) = spider.get::<&str, Function>("init") {
            let ext_val = ext.unwrap_or("");
            let _ = init_fn.call::<(&str,), ()>((ext_val,));
        }

        Ok(())
    }

    fn call_method<'js>(
        ctx: &rquickjs::Ctx<'js>,
        spider: &Object<'js>,
        method: &str,
        args: &[JsonValue],
    ) -> Result<String, AppError> {
        let result: rquickjs::Value = match method {
            "home" => {
                let fn_call: Function = spider
                    .get("home")
                    .map_err(|_| AppError::not_found("JS 未实现 home()"))?;
                let filter = args.first().and_then(|v| v.as_bool()).unwrap_or(false);
                fn_call
                    .call::<(bool,), rquickjs::Value>((filter,))
                    .map_err(|e| method_error(ctx, "home()", e))?
            }
            "homeVod" => match spider.get::<&str, Function>("homeVod") {
                Ok(function) => function
                    .call::<(), rquickjs::Value>(())
                    .map_err(|e| method_error(ctx, "homeVod()", e))?,
                Err(_) => return Ok("null".to_string()),
            },
            "category" => {
                let fn_call: Function = spider
                    .get("category")
                    .map_err(|_| AppError::not_found("JS 未实现 category()"))?;
                let tid = args.get(0).and_then(|v| v.as_str()).unwrap_or("");
                let pg = args.get(1).and_then(|v| v.as_str()).unwrap_or("1");
                let filter = args.get(2).and_then(|v| v.as_bool()).unwrap_or(false);
                let extend_str = args
                    .get(3)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "{}".to_string());
                // TVBox/FongMi 契约：第 4 个参数是「筛选对象」本身。drpy2 会直接往上写属性
                // （`var MY_FL=cateObj.extend; MY_FL.type=...`），传字符串会在严格模式下抛
                // TypeError: not an object —— 站点分类因此整片挂掉。
                let extend_value: rquickjs::Value =
                    ctx.json_parse(extend_str.as_str()).map_err(|e| {
                        AppError::parse_error(format!("category 筛选项不是合法 JSON: {e}"))
                    })?;
                let extend_obj = match extend_value.into_object() {
                    Some(object) => object,
                    None => Object::new(ctx.clone()).map_err(|e| {
                        AppError::internal(format!("创建 category 筛选项对象失败: {e}"))
                    })?,
                };
                fn_call
                    .call::<(&str, &str, bool, Object), rquickjs::Value>((
                        tid,
                        pg,
                        filter,
                        extend_obj,
                    ))
                    .map_err(|e| method_error(ctx, "category()", e))?
            }
            "detail" => {
                let fn_call: Function = spider
                    .get("detail")
                    .map_err(|_| AppError::not_found("JS 未实现 detail()"))?;
                let id = args.get(0).and_then(|v| v.as_str()).unwrap_or("");
                fn_call
                    .call::<(&str,), rquickjs::Value>((id,))
                    .map_err(|e| method_error(ctx, "detail()", e))?
            }
            "search" => {
                let fn_call: Function = spider
                    .get("search")
                    .map_err(|_| AppError::not_found("JS 未实现 search()"))?;
                let keyword = args.get(0).and_then(|v| v.as_str()).unwrap_or("");
                let quick = args.get(1).and_then(|v| v.as_bool()).unwrap_or(false);
                let pg = args.get(2).and_then(|v| v.as_str());
                match pg {
                    Some(p) => fn_call.call::<(&str, bool, &str), rquickjs::Value>((keyword, quick, p)),
                    None => fn_call.call::<(&str, bool), rquickjs::Value>((keyword, quick)),
                }
                .map_err(|e| method_error(ctx, "search()", e))?
            }
            "play" => {
                let fn_call: Function = spider
                    .get("play")
                    .map_err(|_| AppError::not_found("JS 未实现 play()"))?;
                let flag = args.get(0).and_then(|v| v.as_str()).unwrap_or("");
                let id = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
                fn_call
                    .call::<(&str, &str), rquickjs::Value>((flag, id))
                    .map_err(|e| method_error(ctx, "play()", e))?
            }
            _ => return Err(AppError::not_found(format!("未知 JS 方法: {}", method))),
        };
        resolve_js_result(ctx, result)
    }

    /// JS 蜘蛛的方法普遍是 async（返回 Promise），而本运行时是同步的。
    /// 这里手动泵微任务直到 Promise 落定：环境内的 req 是阻塞实现，await 之后微任务即可完成。
    fn resolve_js_result<'js>(ctx: &rquickjs::Ctx<'js>, value: rquickjs::Value<'js>) -> Result<String, AppError> {
        if value.is_promise() {
            ctx.globals()
                .set("__js_pending", value)
                .map_err(|e| AppError::parse_error(format!("JS Promise 处理失败: {}", e)))?;
            ctx.eval::<(), _>(
                "globalThis.__js_settled = false; globalThis.__js_value = undefined; globalThis.__js_error = undefined;\
                 globalThis.__js_pending.then(\
                   function (v) { globalThis.__js_settled = true; globalThis.__js_value = v; },\
                   function (e) { globalThis.__js_settled = true; globalThis.__js_error = String((e && e.message) || e); }\
                 );",
            )
            .map_err(|e| AppError::parse_error(format!("JS Promise 处理失败: {}", e)))?;

            // 运行时中断处理器是 8s，这里留出余量
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(7);
            loop {
                if ctx
                    .globals()
                    .get::<&str, bool>("__js_settled")
                    .unwrap_or(false)
                {
                    break;
                }
                if std::time::Instant::now() >= deadline {
                    return Err(AppError::timeout("JS 站点响应超时"));
                }
                if !ctx.execute_pending_job() {
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
            }

            if let Ok(error) = ctx.globals().get::<&str, String>("__js_error") {
                if !error.is_empty() && error != "undefined" {
                    return Err(AppError::parse_error(format!("JS 执行异常: {}", error)));
                }
            }
            let settled: rquickjs::Value<'js> = ctx
                .globals()
                .get("__js_value")
                .map_err(|e| AppError::parse_error(format!("JS 结果读取失败: {}", e)))?;
            return value_to_json_string(ctx, settled);
        }
        value_to_json_string(ctx, value)
    }

    /// JS 返回值可能是 JSON 字符串（FongMi 约定），也可能是对象，统一成字符串。
    fn value_to_json_string<'js>(ctx: &rquickjs::Ctx<'js>, value: rquickjs::Value<'js>) -> Result<String, AppError> {
        if let Some(text) = value.as_string().and_then(|text| text.to_string().ok()) {
            return Ok(text);
        }
        // 站点没有该功能时常返回 null/undefined；返回空串会让 serde 报 "EOF while parsing"，
        // 这里统一成合法 JSON null，交给上层当"无数据"处理。
        if value.is_undefined() || value.is_null() {
            return Ok("null".to_string());
        }
        ctx.globals()
            .set("__js_tmp", value)
            .map_err(|e| AppError::parse_error(format!("JS 结果序列化失败: {}", e)))?;
        ctx.eval::<String, _>(
            "(function(){ var s = JSON.stringify(globalThis.__js_tmp); return s === undefined ? 'null' : s; })()",
        )
        .map_err(|e| AppError::parse_error(format!("JS 结果序列化失败: {}", e)))
    }

    // ---- 公开 async 方法 ----


fn method_error(ctx: &rquickjs::Ctx, label: &str, error: rquickjs::Error) -> AppError {
    AppError::parse_error(format!(
        "JS {label} 失败: {}",
        crate::js_module::describe_exception(ctx, error)
    ))
}

/// 拉取入口脚本；入口本身不可用（401/404/返回网页）且看着像 drpy 运行库时换镜像重试
fn fetch_entry_with_fallback(
    rt: &tokio::runtime::Runtime,
    api_url: &str,
) -> Result<(String, String), AppError> {
    match rt.block_on(fetch_js_module(api_url)) {
        Ok(code) => Ok((api_url.to_string(), code)),
        Err(first) => {
            for candidate in crate::js_module::fallback_entries(api_url) {
                if let Ok(code) = rt.block_on(fetch_js_module(candidate)) {
                    eprintln!(
                        "[spider] 入口不可用（{}），改用兜底 drpy 运行库: {candidate}",
                        first.message
                    );
                    return Ok((candidate.to_string(), code));
                }
            }
            Err(first)
        }
    }
}

async fn fetch_js_module(api: &str) -> Result<String, AppError> {
    if api.starts_with("http://") || api.starts_with("https://") {
        let client = network::create_client()?;
        let body = network::http_get(&client, api).await?;
        // 不少 JS 蜘蛛的脚本地址已经失效，返回的是跳转页/维护页而不是脚本，
        // 直接交给 JS 引擎只会得到 "unexpected token '<'"，这里提前给出可执行的结论。
        let head = body.trim_start();
        if head.starts_with('<') {
            let preview: String = head.chars().take(60).collect();
            return Err(AppError::parse_error(format!(
                "JS 脚本地址已失效：返回的是网页而不是脚本（{}）",
                preview.replace(['\n', '\r'], " ")
            )));
        }
        Ok(body)
    } else {
        Err(AppError::invalid_input(format!(
            "不支持的 JS 地址: {}",
            api
        )))
    }
}

/// 把 ES Module 语法转换成可在裸 `eval` 中执行的脚本形式。
///
/// 现代 FongMi / drpy 系 JS 蜘蛛普遍使用 `export default { ... }`，而 `ctx.eval` 只接受
/// 脚本语法，直接执行会报 `unsupported keyword: export`（实测 clun.top 的荐片/金牌/apple）。
/// 这里处理 `export default`、`export function/const/let/var/class`、`export { ... }` 三种形态，
/// 并返回具名导出列表交给包装层兜底；`import` 无法在脚本模式下解析，交由调用方给出明确错误。
fn transform_module_syntax(code: &str) -> (String, Vec<String>) {
    let mut out = String::with_capacity(code.len());
    let mut names: Vec<String> = Vec::new();
    let mut in_block_comment = false;
    let mut in_template = false;

    for line in code.lines() {
        let trimmed = line.trim_start();
        let indent = &line[..line.len() - trimmed.len()];
        let mut transformed = line.to_string();

        if !in_block_comment && !in_template {
            if let Some(rest) = trimmed.strip_prefix("export ") {
                let rest = rest.trim_start();
                if let Some(after_default) = rest.strip_prefix("default") {
                    transformed = format!(
                        "{indent}module.exports = {}",
                        after_default.trim_start()
                    );
                } else if let Some(name) = declaration_name(rest) {
                    names.push(name);
                    transformed = format!("{indent}{rest}");
                } else if let Some(body) = rest.strip_prefix('{') {
                    if let Some(end) = body.find('}') {
                        for item in body[..end].split(',') {
                            if let Some(exported) = item.split_whitespace().last() {
                                let exported = exported.trim();
                                if !exported.is_empty() && exported != "as" {
                                    names.push(exported.to_string());
                                }
                            }
                        }
                    }
                    transformed = format!("{indent}// 具名导出已由包装层收集");
                }
            }
        }

        update_scan_state(line, &mut in_block_comment, &mut in_template);
        out.push_str(&transformed);
        out.push('\n');
    }

    (out, names)
}

/// 从 `function/async function/const/let/var/class NAME` 中取出被声明的名字。
fn declaration_name(text: &str) -> Option<String> {
    let text = text.strip_prefix("async ").unwrap_or(text).trim_start();
    for keyword in ["function", "const", "let", "var", "class"] {
        if let Some(rest) = text.strip_prefix(keyword) {
            if rest.starts_with(|c: char| c.is_whitespace()) {
                let name: String = rest
                    .trim_start()
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '$')
                    .collect();
                if !name.is_empty() {
                    return Some(name);
                }
            }
        }
    }
    None
}

/// 粗略跟踪块注释与模板字符串状态，避免在它们内部误改 `export`。
fn update_scan_state(line: &str, in_block_comment: &mut bool, in_template: &mut bool) {
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;
    let mut quote: Option<char> = None;
    while i < chars.len() {
        let c = chars[i];
        if *in_block_comment {
            if c == '*' && chars.get(i + 1) == Some(&'/') {
                *in_block_comment = false;
                i += 2;
                continue;
            }
            i += 1;
            continue;
        }
        if *in_template {
            if c == '\\' {
                i += 2;
                continue;
            }
            if c == '`' {
                *in_template = false;
            }
            i += 1;
            continue;
        }
        if let Some(q) = quote {
            if c == '\\' {
                i += 2;
                continue;
            }
            if c == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        match c {
            '"' | '\'' => {
                quote = Some(c);
                i += 1;
            }
            '`' => {
                *in_template = true;
                i += 1;
            }
            '/' if chars.get(i + 1) == Some(&'*') => {
                *in_block_comment = true;
                i += 2;
            }
            _ => i += 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transforms_export_default_object() {
        let code = "const home = () => 'a';\nexport default { home };\n";
        let (out, names) = transform_module_syntax(code);
        assert!(out.contains("module.exports = { home };"));
        assert!(!out.contains("export default"));
        assert!(names.is_empty());
    }

    #[test]
    fn transforms_named_exports_and_collects_names() {
        let code = "export function home(filter) { return 'x'; }\nexport const category = () => 'y';\nexport { detail, play as playback };\n";
        let (out, names) = transform_module_syntax(code);
        assert!(out.contains("function home(filter)"));
        assert!(out.contains("const category"));
        assert!(!out.contains("export "));
        assert_eq!(names, vec!["home", "category", "detail", "playback"]);
    }

    #[test]
    fn keeps_export_keyword_inside_strings_and_comments() {
        let code = "const note = 'export default 只是文本';\n/* export default 注释 */\nconst ok = 1;\n";
        let (out, _) = transform_module_syntax(code);
        assert!(out.contains("'export default 只是文本'"));
        assert!(out.contains("/* export default 注释 */"));
    }

    #[test]
    fn leaves_import_lines_untouched() {
        let code = "import cheerio from 'assets://js/lib/cheerio.min.js';\nexport default { home };\n";
        let (out, _) = transform_module_syntax(code);
        assert!(out.contains("import cheerio"));
        assert!(out.contains("module.exports = { home };"));
    }
}
