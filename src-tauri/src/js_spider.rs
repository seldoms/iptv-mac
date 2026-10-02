use std::collections::HashMap;

use serde_json::Value as JsonValue;

use crate::error::AppError;

/// JS Spider — 使用 rquickjs 执行 TVBox JS 爬虫
///
/// 只负责对外 API：把方法调用交给 `js_session`（站点会话复用），
/// 引擎细节在 `js_runtime`，ES Module 解析/加载在 `js_module`。
pub struct JsSpider {
    api_url: String,
    ext: Option<String>,
}


impl JsSpider {
    pub async fn new(api_url: &str, ext: Option<&str>) -> Result<Self, AppError> {
        Ok(JsSpider {
            api_url: api_url.to_string(),
            ext: ext.map(|s| s.to_string()),
        })
    }

    async fn call_js(
        method: &str,
        api_url: &str,
        ext: Option<&str>,
        args: Vec<JsonValue>,
    ) -> Result<JsonValue, AppError> {
        let api_url = api_url.to_string();
        let ext = ext.map(|s| s.to_string());
        let method = method.to_string();

        // Runtime/Context 常驻在站点专属线程里复用（见 js_session），
        // 装载 cheerio+drpy2 与 init(ext) 只做一次。
        let task = tokio::task::spawn_blocking(move || {
            crate::js_session::call(&api_url, ext.as_deref(), &method, &args)
        });
        tokio::time::timeout(std::time::Duration::from_secs(40), task)
            .await
            .map_err(|_| AppError::timeout("JS 站点响应超时"))?
            .map_err(|e| AppError::internal(format!("JS 线程执行失败: {}", e)))?
    }

    /// 新建并装载一份运行时：拉入口 → 建 Runtime/Context → 装宿主环境 → 加载模块/脚本 → `init(ext)`。
    ///
    /// 返回 `(Runtime, Context, 单次执行预算秒数)`，由会话线程持有并复用于后续方法调用。
    pub async fn home_content(&self, filter: bool) -> Result<JsonValue, AppError> {
        Self::call_js(
            "home",
            &self.api_url,
            self.ext.as_deref(),
            vec![JsonValue::Bool(filter)],
        )
        .await
    }

    pub async fn category_content(
        &self,
        tid: &str,
        pg: &str,
        filter: bool,
        extend: &HashMap<String, String>,
    ) -> Result<JsonValue, AppError> {
        let extend_json =
            serde_json::to_value(extend).unwrap_or(JsonValue::Object(Default::default()));
        Self::call_js(
            "category",
            &self.api_url,
            self.ext.as_deref(),
            vec![
                JsonValue::String(tid.to_string()),
                JsonValue::String(pg.to_string()),
                JsonValue::Bool(filter),
                extend_json,
            ],
        )
        .await
    }

    pub async fn detail_content(&self, ids: &[String]) -> Result<JsonValue, AppError> {
        let id = ids.first().map(|s| s.as_str()).unwrap_or("");
        Self::call_js(
            "detail",
            &self.api_url,
            self.ext.as_deref(),
            vec![JsonValue::String(id.to_string())],
        )
        .await
    }

    pub async fn search_content(
        &self,
        keyword: &str,
        quick: bool,
        pg: Option<&str>,
    ) -> Result<JsonValue, AppError> {
        let mut args = vec![
            JsonValue::String(keyword.to_string()),
            JsonValue::Bool(quick),
        ];
        if let Some(p) = pg {
            args.push(JsonValue::String(p.to_string()));
        }
        Self::call_js("search", &self.api_url, self.ext.as_deref(), args).await
    }

    pub async fn player_content(
        &self,
        flag: &str,
        id: &str,
        _vip_flags: &[String],
    ) -> Result<JsonValue, AppError> {
        Self::call_js(
            "play",
            &self.api_url,
            self.ext.as_deref(),
            vec![
                JsonValue::String(flag.to_string()),
                JsonValue::String(id.to_string()),
            ],
        )
        .await
    }
}
