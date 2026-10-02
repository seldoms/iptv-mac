//! 站点分类与配置预检（领域逻辑）。
//!
//! 审计（`docs/CODE_AUDIT.md` P1/P2）发现这套规则原先在 `commands/config.rs` 与
//! `commands/site.rs` 各写了一份，且预检统计/兼容性判定挤在一个 202 行的命令函数里。
//! 这里集中成纯函数：命令层只负责取数与拼装返回值。

use serde_json::Value;

/// HTTP API 站点的抽样探测结果
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SiteProbeStats {
    pub inspected: i64,
    pub passed: i64,
    pub failed: i64,
    pub skipped: i64,
}

/* ------------------------------ 站点字段读取 ------------------------------ */

pub fn site_type(site: &Value) -> i64 {
    site.get("type").and_then(Value::as_i64).unwrap_or(1)
}

pub fn site_api(site: &Value) -> Option<&str> {
    site.get("api")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|api| !api.is_empty())
}

pub fn site_name(site: &Value) -> Option<&str> {
    site.get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
}

pub fn site_name_or<'a>(site: &'a Value, fallback: &'a str) -> &'a str {
    site_name(site).unwrap_or(fallback)
}

pub fn site_key(site: &Value) -> Option<&str> {
    site.get("key")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|key| !key.is_empty())
}

/* -------------------------------- 分类判定 -------------------------------- */

pub fn is_hidden_site(site: &Value) -> bool {
    site.get("hide").and_then(Value::as_i64) == Some(1)
}

pub fn is_http_api_site(site: &Value) -> bool {
    matches!(site_type(site), 0 | 1 | 4)
}

/// 桌面端可直接使用的 HTTP API 站点（type 0/1/4、非隐藏、有 api）
pub fn is_directly_supported_site(site: &Value) -> bool {
    is_http_api_site(site) && !is_hidden_site(site) && site_api(site).is_some()
}

pub fn is_searchable_site(site: &Value) -> bool {
    is_directly_supported_site(site) && site.get("searchable").and_then(Value::as_i64) != Some(0)
}

pub fn live_channel_count(live: &Value) -> i64 {
    if let Some(count) = live.get("channelCount").and_then(Value::as_i64) {
        return count;
    }
    live.get("groups")
        .and_then(Value::as_array)
        .map(|groups| {
            groups
                .iter()
                .map(|group| {
                    group
                        .get("channel")
                        .or_else(|| group.get("channels"))
                        .and_then(Value::as_array)
                        .map(|channels| channels.len() as i64)
                        .unwrap_or(0)
                })
                .sum()
        })
        .unwrap_or(0)
}

/* ------------------------------ 配置预检统计 ------------------------------ */

/// 只依赖配置本身就能算出的统计
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ConfigSummary {
    pub sites: i64,
    pub lives: i64,
    pub parses: i64,
    pub has_spider: bool,
    pub source_type: String,
    pub visible_sites: i64,
    pub searchable_sites: i64,
    pub hidden_sites: i64,
    pub csp_sites: i64,
    pub missing_api_sites: i64,
    pub unsupported_sites: i64,
    pub live_channels: i64,
}

pub fn summarize_config(config: &Value) -> ConfigSummary {
    let array_len = |key: &str| {
        config
            .get(key)
            .and_then(Value::as_array)
            .map(|items| items.len() as i64)
            .unwrap_or(0)
    };
    let sites: Vec<&Value> = config
        .get("sites")
        .and_then(Value::as_array)
        .map(|items| items.iter().collect())
        .unwrap_or_default();

    ConfigSummary {
        sites: sites.len() as i64,
        lives: array_len("lives"),
        parses: array_len("parses"),
        has_spider: config
            .get("spider")
            .and_then(Value::as_str)
            .is_some_and(|spider| !spider.is_empty()),
        source_type: config
            .get("sourceType")
            .and_then(Value::as_str)
            .unwrap_or("tvbox")
            .to_string(),
        visible_sites: sites.iter().filter(|site| is_directly_supported_site(site)).count() as i64,
        searchable_sites: sites.iter().filter(|site| is_searchable_site(site)).count() as i64,
        hidden_sites: sites.iter().filter(|site| is_hidden_site(site)).count() as i64,
        csp_sites: sites.iter().filter(|site| site_type(site) == 3).count() as i64,
        missing_api_sites: sites
            .iter()
            .filter(|site| is_http_api_site(site) && !is_hidden_site(site) && site_api(site).is_none())
            .count() as i64,
        unsupported_sites: sites
            .iter()
            .filter(|site| !is_hidden_site(site) && !is_directly_supported_site(site))
            .count() as i64,
        live_channels: config
            .get("lives")
            .and_then(Value::as_array)
            .map(|items| items.iter().map(live_channel_count).sum())
            .unwrap_or(0),
    }
}

/// 兼容性判定：`(compatibility, 展示文案, 是否可导入)`
pub fn compatibility_of(
    summary: &ConfigSummary,
    probe: &SiteProbeStats,
) -> (&'static str, &'static str, bool) {
    let has_probe_data = probe.inspected > 0;
    let direct_sites_ready = summary.visible_sites > 0 && (!has_probe_data || probe.passed > 0);
    if direct_sites_ready {
        ("ready", "点播可用", true)
    } else if summary.lives > 0 {
        ("live", "仅直播可用", true)
    } else if summary.sites > 0 || summary.parses > 0 {
        ("unsupported", "暂不兼容", false)
    } else {
        ("invalid", "不可用", false)
    }
}

/// 预检提示，顺序固定：直播直链 → CSP → 隐藏站点 → 缺 api → 抽样结果 → 不可导入
pub fn config_warnings(
    summary: &ConfigSummary,
    probe: &SiteProbeStats,
    can_import: bool,
) -> Vec<String> {
    let mut warnings: Vec<String> = Vec::new();
    if summary.source_type == "live" {
        warnings.push("已识别为直播源直链，将作为单个直播源加载".to_string());
    }
    if summary.csp_sites > 0 {
        warnings.push(format!(
            "包含 {} 个 type=3 CSP/Jar/JS/Python 站点，当前桌面端暂不执行此类爬虫",
            summary.csp_sites
        ));
    }
    if summary.hidden_sites > 0 {
        warnings.push(format!("已忽略 {} 个 hide=1 的隐藏站点", summary.hidden_sites));
    }
    if summary.missing_api_sites > 0 {
        warnings.push(format!(
            "有 {} 个 HTTP API 站点缺少 api 地址，已排除",
            summary.missing_api_sites
        ));
    }
    if probe.inspected > 0 && probe.passed == 0 {
        warnings.push(format!(
            "已抽样测试 {} 个 HTTP API 站点，暂未拿到首页分类或列表",
            probe.inspected
        ));
    } else if probe.failed > 0 {
        warnings.push(format!(
            "抽样测试中 {} 个 HTTP API 站点未返回可用首页内容",
            probe.failed
        ));
    }
    if probe.skipped > 0 {
        warnings.push(format!(
            "为避免预检过慢，另有 {} 个 HTTP API 站点留待导入后探测",
            probe.skipped
        ));
    }
    if !can_import {
        warnings.push("当前项目没有可消费的 type=0/1/4 HTTP API 站点或直播源".to_string());
    }
    warnings
}

/// 预检展示名：优先可直接使用的站点 → 第一个站点 → 第一个直播源 → 地址本身
pub fn config_display_name(config: &Value, fallback_url: &str) -> String {
    let sites = config.get("sites").and_then(Value::as_array);
    sites
        .and_then(|items| items.iter().find(|site| is_directly_supported_site(site)))
        .and_then(site_name)
        .or_else(|| sites.and_then(|items| items.first()).and_then(site_name))
        .or_else(|| {
            config
                .get("lives")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|live| live.get("name").and_then(Value::as_str))
        })
        .unwrap_or(fallback_url)
        .to_string()
}

/// 把加载错误映射成给用户看的话
pub fn friendly_config_error(error: &crate::error::AppError) -> &'static str {
    let message = error.to_string();
    if message.contains("超时") {
        "配置地址连接超时，请稍后重试或检查网络"
    } else if message.contains("无法连接") {
        "配置地址无法连接，请检查域名、网络或代理设置"
    } else if message.contains("JSON") {
        "配置 JSON 格式错误，请检查内容是否完整"
    } else {
        "配置预检失败，请检查地址、网络或 JSON 格式"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_config() -> Value {
        json!({
            "spider": "./spider.jar;md5;abc",
            "sites": [
                {"key": "http_ok", "name": "HTTP 站点", "type": 1, "api": "https://a/api", "searchable": 1},
                {"key": "http_nosearch", "name": "不可搜", "type": 1, "api": "https://b/api", "searchable": 0},
                {"key": "http_noapi", "name": "缺 api", "type": 1},
                {"key": "hidden", "name": "隐藏站", "type": 1, "api": "https://c/api", "hide": 1},
                {"key": "jar_site", "name": "JAR 站", "type": 3, "api": "csp_Guard"},
                {"key": "js_site", "name": "JS 站", "type": 3, "api": "./x.js"}
            ],
            "lives": [{"name": "直播源", "groups": [{"channel": [1, 2, 3]}, {"channel": [1]}]}],
            "parses": [{"name": "解析"}]
        })
    }

    #[test]
    fn summarize_counts_each_category() {
        let summary = summarize_config(&sample_config());
        assert_eq!(summary.sites, 6);
        assert_eq!(summary.lives, 1);
        assert_eq!(summary.parses, 1);
        assert!(summary.has_spider);
        assert_eq!(summary.source_type, "tvbox");
        assert_eq!(summary.visible_sites, 2, "只有两个非隐藏且有 api 的 HTTP 站点");
        assert_eq!(summary.searchable_sites, 1);
        assert_eq!(summary.hidden_sites, 1);
        assert_eq!(summary.csp_sites, 2, "type=3 两个：csp_ 与 .js 各一个（hide 不参与该计数）");
        assert_eq!(summary.missing_api_sites, 1);
        assert_eq!(summary.unsupported_sites, 3, "JAR/JS/缺 api 各一（隐藏站不算）");
        assert_eq!(summary.live_channels, 4);
    }

    #[test]
    fn compatibility_prefers_ready_then_live_then_unsupported() {
        let summary = summarize_config(&sample_config());
        let no_probe = SiteProbeStats::default();
        assert_eq!(compatibility_of(&summary, &no_probe), ("ready", "点播可用", true));

        // 抽样全失败 → 点播不可用，但有直播源
        let all_failed = SiteProbeStats { inspected: 2, passed: 0, failed: 2, skipped: 0 };
        assert_eq!(compatibility_of(&summary, &all_failed), ("live", "仅直播可用", true));

        // 没有直播源、有点播站点 → 暂不兼容
        let mut no_live = summary.clone();
        no_live.lives = 0;
        no_live.visible_sites = 0;
        assert_eq!(compatibility_of(&no_live, &no_probe), ("unsupported", "暂不兼容", false));

        let empty = ConfigSummary::default();
        assert_eq!(compatibility_of(&empty, &no_probe), ("invalid", "不可用", false));
    }

    #[test]
    fn warnings_keep_documented_order() {
        let summary = summarize_config(&sample_config());
        let probe = SiteProbeStats { inspected: 3, passed: 0, failed: 3, skipped: 1 };
        let warnings = config_warnings(&summary, &probe, false);
        assert!(warnings[0].contains("2 个 type=3"));
        assert!(warnings[1].contains("1 个 hide=1"));
        assert!(warnings[2].contains("缺少 api"));
        assert!(warnings[3].contains("暂未拿到首页"));
        assert!(warnings[4].contains("留待导入后探测"));
        assert!(warnings[5].contains("没有可消费"));
    }

    #[test]
    fn live_direct_source_warns_first() {
        let mut summary = ConfigSummary::default();
        summary.source_type = "live".to_string();
        summary.lives = 1;
        let warnings = config_warnings(&summary, &SiteProbeStats::default(), true);
        assert_eq!(warnings, vec!["已识别为直播源直链，将作为单个直播源加载"]);
    }

    #[test]
    fn display_name_falls_back_in_order() {
        let config = sample_config();
        assert_eq!(config_display_name(&config, "url"), "HTTP 站点");

        let only_live = json!({"lives": [{"name": "直播源"}]});
        assert_eq!(config_display_name(&only_live, "url"), "直播源");

        assert_eq!(config_display_name(&json!({}), "fallback-url"), "fallback-url");
    }

    #[test]
    fn friendly_error_maps_known_cases() {
        use crate::error::{AppError, ErrorCode};
        let timeout = AppError::timeout("连接超时");
        assert!(friendly_config_error(&timeout).contains("超时"));
        let network = AppError {
            code: ErrorCode::NetworkError,
            message: "无法连接: http://x".to_string(),
            internal: None,
        };
        assert!(friendly_config_error(&network).contains("无法连接"));
        let parse = AppError::parse_error("JSON 格式错误");
        assert!(friendly_config_error(&parse).contains("JSON"));
        let other = AppError::internal("其它");
        assert!(friendly_config_error(&other).contains("预检失败"));
    }
}
