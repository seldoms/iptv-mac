use std::sync::LazyLock;

use regex::Regex;

/// Match lines starting with a comment that might contain URI="..."
static URI_IN_COMMENT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"\bURI=(["'])"#).unwrap());

/// 判断 URL 是否可代理（data:/blob:/skd: 不代理）
fn is_proxyable_uri(value: &str) -> bool {
    !value.starts_with("data:") && !value.starts_with("blob:") && !value.starts_with("skd:")
}

/// 从引号包围的字符串中提取值，处理嵌套引号
fn extract_quoted_value(line: &str, quote_start: usize) -> Option<(String, usize)> {
    let quote_char = line.as_bytes().get(quote_start)?;
    if *quote_char != b'"' && *quote_char != b'\'' {
        return None;
    }
    let mut end = quote_start + 1;
    while end < line.len() {
        if line.as_bytes()[end] == *quote_char {
            return Some((line[quote_start + 1..end].to_string(), end + 1));
        }
        // Skip escaped chars
        if line.as_bytes()[end] == b'\\' {
            end += 2;
        } else {
            end += 1;
        }
    }
    None
}

/// 重写 HLS 播放列表中的 URI 为代理 URL
/// 重写 HLS 清单中的媒体地址。
pub fn rewrite_hls_playlist<F>(playlist: &str, source_url: &str, make_proxy_url: F) -> String
where
    F: Fn(&str) -> String,
{
    let resolve = |value: &str| -> String {
        if value.is_empty() || !is_proxyable_uri(value) {
            return value.to_string();
        }
        // Resolve relative URL against source URL
        if let Ok(base) = url::Url::parse(source_url) {
            if let Ok(absolute) = base.join(value) {
                return make_proxy_url(absolute.as_str());
            }
        }
        value.to_string()
    };

    playlist
        .lines()
        .map(|line| {
            if line.is_empty() {
                return line.to_string();
            }

            if line.starts_with('#') && URI_IN_COMMENT_RE.is_match(line) {
                // Find all URI="..." or URI='...' patterns
                let mut result = String::with_capacity(line.len());
                let mut last_end = 0;
                for m in URI_IN_COMMENT_RE.find_iter(line) {
                    let uri_start = m.end() - 1; // include the quote char
                    if let Some((value, value_end)) = extract_quoted_value(line, uri_start) {
                        // Append everything before this URI
                        result.push_str(&line[last_end..m.start()]);
                        result.push_str("URI=");
                        let quote = &line[m.end() - 1..m.end()];
                        result.push_str(quote);
                        result.push_str(&resolve(&value));
                        result.push_str(quote);
                        last_end = value_end;
                    }
                }
                result.push_str(&line[last_end..]);
                result
            } else if !line.starts_with('#') {
                resolve(line.trim())
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_relative_variants_and_key_uris() {
        let playlist = [
            "#EXTM3U",
            r##"#EXT-X-KEY:METHOD=AES-128,URI="enc.key""##,
            "#EXT-X-STREAM-INF:BANDWIDTH=4096000",
            "/play/hls/demo/index.m3u8",
            "#EXTINF:10,",
            "segment0.ts",
        ]
        .join("\n");

        let result = rewrite_hls_playlist(
            &playlist,
            "https://media.example/play/demo/index.m3u8",
            |url| format!("proxy:{}", url),
        );

        assert!(
            result.contains(r##"URI="proxy:https://media.example/play/demo/enc.key""##),
            "Should rewrite key URI. Result:\n{}",
            result
        );
        assert!(
            result.contains("proxy:https://media.example/play/hls/demo/index.m3u8"),
            "Should rewrite absolute path. Result:\n{}",
            result
        );
        assert!(
            result.contains("proxy:https://media.example/play/demo/segment0.ts"),
            "Should rewrite relative segment. Result:\n{}",
            result
        );
    }

    #[test]
    fn leaves_data_uris_unchanged() {
        let playlist = r##"#EXT-X-KEY:METHOD=AES-128,URI="data:text/plain;base64,AAAA""##;
        let result = rewrite_hls_playlist(playlist, "https://example.com/a.m3u8", |url| {
            format!("proxy:{}", url)
        });
        assert_eq!(result, playlist);
    }

    #[test]
    fn leaves_blob_uris_unchanged() {
        let playlist = r##"#EXT-X-KEY:METHOD=AES-128,URI="blob:https://example.com/uuid""##;
        let result = rewrite_hls_playlist(playlist, "https://example.com/a.m3u8", |url| {
            format!("proxy:{}", url)
        });
        assert_eq!(result, playlist);
    }

    #[test]
    fn rewrites_absolute_urls() {
        let playlist = "#EXTM3U\nhttps://cdn.example.com/segments/seg1.ts";
        let result = rewrite_hls_playlist(playlist, "https://example.com/play.m3u8", |url| {
            format!("/proxy?url={}", urlencoding::encode(url))
        });
        assert!(result.contains("/proxy?url=https%3A%2F%2Fcdn.example.com%2Fsegments%2Fseg1.ts"));
    }

    #[test]
    fn rewrites_nested_playlists() {
        let playlist = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1280000\nvariant.m3u8";
        let result = rewrite_hls_playlist(playlist, "https://example.com/hls/master.m3u8", |url| {
            format!("/proxy?url={}", url)
        });
        assert!(result.contains("/proxy?url=https://example.com/hls/variant.m3u8"));
    }
}
