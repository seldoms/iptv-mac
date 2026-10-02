//! URL 相对解析：订阅配置（`config`）与 ES Module 加载（`js_module`）共用一套规则。
//!
//! 审计发现两处各写了一份（见 `docs/CODE_AUDIT.md` P1），其中 `js_module` 的手工按段拼接
//! 会把代理型 base 里的双斜杠压成单斜杠：
//! `https://gh-proxy.com/https://raw.githubusercontent.com/a/b/c.json` + `./x.js`
//! → 旧实现得到 `https://gh-proxy.com/https:/raw.githubusercontent.com/a/b/x.js`（错）。
//! 现在统一走 RFC 3986 解析（`url::Url::join`），它能正确保留路径内嵌的完整 URL。

/// 引用是否自带 scheme（视为绝对地址，直接返回）
fn has_scheme(reference: &str) -> bool {
    match reference.find(':') {
        Some(index) if index > 0 => {
            let scheme = &reference[..index];
            scheme.chars().next().is_some_and(|first| first.is_ascii_alphabetic())
                && scheme
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '-' | '.'))
        }
        _ => false,
    }
}

/// 把 `reference` 解析成绝对地址；`base` 不是 URL 时回退到本地路径拼接。
pub fn resolve(base: &str, reference: &str) -> String {
    let reference = reference.trim();
    if reference.is_empty() || has_scheme(reference) {
        return reference.to_string();
    }

    if let Ok(base_url) = url::Url::parse(base) {
        if let Ok(joined) = base_url.join(reference) {
            return joined.to_string();
        }
    }

    // 本地路径：以 base 所在目录为起点
    let base_path = std::path::PathBuf::from(base);
    let parent = if base_path.is_dir() {
        base_path
    } else {
        base_path
            .parent()
            .map(std::path::PathBuf::from)
            .unwrap_or_default()
    };
    parent.join(reference).to_string_lossy().to_string()
}

/// 取 URL 的查询串（含 `?`），没有则返回空串
pub fn query_of(url: &str) -> &str {
    match url.find('?') {
        Some(index) => match url[index..].find('#') {
            Some(hash) => &url[index..index + hash],
            None => &url[index..],
        },
        None => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_absolute_references() {
        assert_eq!(resolve("https://a/b.json", "https://c/d.js"), "https://c/d.js");
        assert_eq!(resolve("https://a/b.json", "assets://js/lib/x.js"), "assets://js/lib/x.js");
        assert_eq!(resolve("https://a/b.json", "  file:///tmp/x.js "), "file:///tmp/x.js");
        assert_eq!(resolve("https://a/b.json", ""), "");
    }

    #[test]
    fn resolves_against_plain_url() {
        assert_eq!(
            resolve("https://example.com/path/config.json", "lib/live.txt"),
            "https://example.com/path/lib/live.txt"
        );
        assert_eq!(
            resolve("https://example.com/path/config.json", "../live.txt"),
            "https://example.com/live.txt"
        );
        assert_eq!(
            resolve("https://example.com/path/config.json", "./sub/x.js"),
            "https://example.com/path/sub/x.js"
        );
    }

    #[test]
    fn preserves_embedded_url_in_proxy_base() {
        // 代理型 base：路径里内嵌完整 URL，双斜杠必须保留
        let base = "https://gh-proxy.com/https://raw.githubusercontent.com/a/b/c.json";
        assert_eq!(
            resolve(base, "./x.js"),
            "https://gh-proxy.com/https://raw.githubusercontent.com/a/b/x.js"
        );
        assert_eq!(
            resolve(base, "../y.js"),
            "https://gh-proxy.com/https://raw.githubusercontent.com/a/y.js"
        );
    }

    #[test]
    fn resolves_custom_scheme_base() {
        assert_eq!(resolve("assets://js/lib/a.js", "../x.js"), "assets://js/x.js");
        assert_eq!(resolve("assets://js/lib/a.js", "./b.js"), "assets://js/lib/b.js");
    }

    #[test]
    fn resolves_local_path_base() {
        assert_eq!(resolve("/tmp/dir/config.json", "x.js"), "/tmp/dir/x.js");
    }

    #[test]
    fn extracts_query_string() {
        assert_eq!(query_of("http://h/a.js?v=1"), "?v=1");
        assert_eq!(query_of("http://h/a.js?v=1#frag"), "?v=1");
        assert_eq!(query_of("http://h/a.js"), "");
    }
}
