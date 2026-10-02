//! TVBox 配置解码：`com.fongmi.android.tv.api.Decoder` 的 Rust 移植。
//!
//! TVBox 生态里大量"接口"并不是明文 JSON，主流壳（FongMi/影视仓）在解析前会先做一层解码。
//! 本模块按 FongMi `Decoder.verify` 的顺序等价实现：
//!
//! 1. 已是 JSON 对象/数组 → 原样返回（仅做相对路径修正）
//! 2. 含 `[A-Za-z0-9]{8}**` 标记 → 取标记后的 base64 解码（饭太硬 `in.bmp` / `.jpg` 隐写）
//! 3. 以 `2423` 开头（即 `$#` 的 hex）→ hex + AES-128-CBC 解密（南风 `XC.json`）
//!
//! AES 的 key 藏在 `$#..#$` 之间、iv 取密文尾部 13 字节，两者右侧补 `0` 到 16 字节。
//! 为不引入新依赖（沙箱内无法访问 crates.io），AES / base64 / hex 均为标准库自实现，
//! 正确性由 FIPS-197 官方向量、Node `aes-128-cbc` 交叉向量和真实线上配置三重验证。
//!
//! 用法：`let text = decoder::decode(url, &raw);`

use std::sync::LazyLock;

/// 按 FongMi `Decoder.verify` 等价流程解码配置文本。
///
/// `url` 用于修正配置里的相对 JS 路径（`"./xxx.js"` / `"../xxx.js"`）。
/// 无法识别或解码失败时原样返回，交由后续 JSON 解析给出明确报错。
pub fn decode(url: &str, data: &str) -> String {
    if data.is_empty() {
        return String::new();
    }
    if is_structured_json(data) {
        return fix_relative_paths(url, data);
    }
    if data.contains("**") {
        if let Some(text) = decode_stego_base64(data) {
            return fix_relative_paths(url, &text);
        }
    }
    if data.starts_with("2423") {
        if let Ok(text) = decode_hex_cbc(data) {
            return fix_relative_paths(url, &text);
        }
    }
    data.to_string()
}

/// 判断文本是否已经是结构化 JSON（FongMi `Json.isObj` 的宽松版）
fn is_structured_json(data: &str) -> bool {
    let trimmed = data.trim_start_matches('\u{feff}').trim_start();
    trimmed.starts_with('{') || trimmed.starts_with('[')
}

/// 解码 `XXXXXXXX**<base64>` 隐写负载。
///
/// 图片头部可能混入 0x2a2a 字节，因此逐个候选验证，优先返回看起来像配置的结果。
fn decode_stego_base64(data: &str) -> Option<String> {
    let mut first_decoded: Option<String> = None;
    let mut search_from = 0usize;
    while let Some(offset) = data[search_from..].find("**") {
        let marker_end = search_from + offset + 2;
        search_from = marker_end;
        // 标记前必须是 8 位字母数字（FongMi 的 `[A-Za-z0-9]{8}\*\*`）；
        // 图片二进制转成字符串后可能含多字节字符，这里按字节判断避免切片 panic
        if marker_end < 10 {
            continue;
        }
        let prefix = &data.as_bytes()[marker_end - 10..marker_end - 2];
        if !prefix.iter().all(|b| b.is_ascii_alphanumeric()) {
            continue;
        }
        let tail = data[marker_end..].trim();
        let Some(decoded) = base64_decode_lenient(tail) else {
            continue;
        };
        if looks_like_config(&decoded) {
            return Some(decoded);
        }
        if first_decoded.is_none() {
            first_decoded = Some(decoded);
        }
    }
    first_decoded
}

/// 宽松 base64：先按标准字母表解码，失败则剔除非法字符后重试
fn base64_decode_lenient(input: &str) -> Option<String> {
    let compact: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    let bytes = base64_decode(compact.as_bytes()).or_else(|| {
        let filtered: String = compact
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '+' || *c == '/' || *c == '=')
            .collect();
        base64_decode(filtered.as_bytes())
    })?;
    if bytes.is_empty() {
        return None;
    }
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// 解码后的文本是否像 TVBox 配置
fn looks_like_config(text: &str) -> bool {
    let trimmed = text.trim_start_matches('\u{feff}').trim_start();
    trimmed.starts_with('{') || trimmed.starts_with("//") || trimmed.starts_with("/*")
}

/// hex + AES-128-CBC 解密（FongMi `Decoder.cbc` 逐行等价）
fn decode_hex_cbc(data: &str) -> Result<String, String> {
    let compact: String = data.chars().filter(|c| !c.is_whitespace()).collect();
    let raw = hex_decode(&compact).ok_or("配置不是合法 hex")?;
    let marker = String::from_utf8_lossy(&raw).to_lowercase();
    let marker_bytes = marker.as_bytes();

    let key_start = find_bytes(marker_bytes, b"$#").ok_or("缺少 $# key 标记")? + 2;
    let key_end = find_bytes(marker_bytes, b"#$").ok_or("缺少 #$ key 标记")?;
    if key_end <= key_start {
        return Err("AES key 标记区间非法".into());
    }
    let key = pad_key(&String::from_utf8_lossy(&marker_bytes[key_start..key_end]));
    let iv_start = marker_bytes.len().checked_sub(13).ok_or("密文过短，缺少 iv")?;
    let iv = pad_key(&String::from_utf8_lossy(&marker_bytes[iv_start..]));

    let ct_start = compact.find("2324").ok_or("缺少 2324 密文起点")? + 4;
    let ct_end = compact.len().checked_sub(26).ok_or("密文过短，缺少尾部 iv")?;
    if ct_end <= ct_start {
        return Err("密文区间非法".into());
    }
    let cipher_text = hex_decode(&compact[ct_start..ct_end]).ok_or("密文不是合法 hex")?;

    let plain = aes_128_cbc_decrypt(&cipher_text, key.as_bytes(), iv.as_bytes())?;
    Ok(String::from_utf8_lossy(&plain).into_owned())
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// key/iv 右侧补 `0` 到 16 字节（超长时截断，避免越界）
fn pad_key(value: &str) -> String {
    let bytes = value.as_bytes();
    if bytes.len() >= 16 {
        return String::from_utf8_lossy(&bytes[..16]).into_owned();
    }
    let mut out = value.to_string();
    out.push_str(&"0".repeat(16 - bytes.len()));
    out
}

/// 把配置里的相对 JS 路径补成绝对 URL（FongMi `Decoder.fix` 的常用子集）
fn fix_relative_paths(url: &str, data: &str) -> String {
    if !data.contains("\"./") && !data.contains("\"../") && !data.contains("__JS1__") && !data.contains("__JS2__") {
        return data.to_string();
    }
    let Some((dir, parent)) = base_dir_and_parent(url) else {
        return data.to_string();
    };
    data.replace("\"../", &format!("\"{parent}"))
        .replace("\"./", &format!("\"{dir}"))
        .replace("__JS1__", &dir)
        .replace("__JS2__", &parent)
}

/// 由配置 URL 推出所在目录与上级目录（不依赖 url crate）
fn base_dir_and_parent(url: &str) -> Option<(String, String)> {
    let scheme_end = url.find("://")? + 3;
    let without_query = url.split(['?', '#']).next().unwrap_or(url);
    let last_slash = without_query.rfind('/')?;
    if last_slash < scheme_end {
        return None;
    }
    let dir = format!("{}/", &without_query[..last_slash]);
    let parent = match dir.trim_end_matches('/').rfind('/') {
        Some(index) if index >= scheme_end => format!("{}/", &dir[..index]),
        _ => dir.clone(),
    };
    Some((dir, parent))
}

/* ----------------------------- base64 / hex ----------------------------- */

const BASE64_ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// 标准 base64 解码（允许缺少/多余 padding，拒绝非法字符）
fn base64_decode(input: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(input.len() / 4 * 3);
    let mut buffer: u32 = 0;
    let mut bits = 0u32;
    let mut padding = 0usize;
    for &byte in input {
        if byte == b'=' {
            padding += 1;
            continue;
        }
        if padding > 0 {
            return None;
        }
        let value = BASE64_ALPHABET.iter().position(|&c| c == byte)? as u32;
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
        }
    }
    Some(out)
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn hex_decode(input: &str) -> Option<Vec<u8>> {
    let bytes = input.as_bytes();
    if bytes.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 2);
    for pair in bytes.chunks(2) {
        out.push((hex_value(pair[0])? << 4) | hex_value(pair[1])?);
    }
    Some(out)
}

/* -------------------------------- AES-128 -------------------------------- */

/// GF(2^8) 乘法，模 AES 的 0x11b
fn gf_mul(mut a: u8, mut b: u8) -> u8 {
    let mut result = 0u8;
    for _ in 0..8 {
        if b & 1 != 0 {
            result ^= a;
        }
        let high = a & 0x80 != 0;
        a <<= 1;
        if high {
            a ^= 0x1b;
        }
        b >>= 1;
    }
    result
}

/// 在 GF(2^8) 中求乘法逆元（0 的逆元按 AES 规范取 0）
fn gf_inv(a: u8) -> u8 {
    if a == 0 {
        return 0;
    }
    for candidate in 1u16..=255 {
        let candidate = candidate as u8;
        if gf_mul(a, candidate) == 1 {
            return candidate;
        }
    }
    0
}

fn rotl8(value: u8, shift: u32) -> u8 {
    value.rotate_left(shift)
}

/// AES 加密 S-box（用有限域运算现算，避免手抄 256 字节表出错）
fn build_sbox() -> [u8; 256] {
    let mut sbox = [0u8; 256];
    for (index, slot) in sbox.iter_mut().enumerate() {
        let inv = gf_inv(index as u8);
        *slot = inv
            ^ rotl8(inv, 1)
            ^ rotl8(inv, 2)
            ^ rotl8(inv, 3)
            ^ rotl8(inv, 4)
            ^ 0x63;
    }
    sbox
}

static SBOX: LazyLock<[u8; 256]> = LazyLock::new(build_sbox);
static SBOX_INV: LazyLock<[u8; 256]> = LazyLock::new(|| {
    let sbox = *SBOX;
    let mut inverse = [0u8; 256];
    for (index, &value) in sbox.iter().enumerate() {
        inverse[value as usize] = index as u8;
    }
    inverse
});

const RCON: [u8; 11] = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

/// AES-128 密钥扩展 → 11 组轮密钥
fn expand_key(key: &[u8]) -> Result<[[u8; 16]; 11], String> {
    if key.len() != 16 {
        return Err(format!("AES-128 需要 16 字节 key，实际 {}", key.len()));
    }
    let sbox = *SBOX;
    let mut words = [0u8; 176];
    words[..16].copy_from_slice(key);
    for word in 4..44 {
        let base = word * 4;
        let previous = base - 4;
        let mut temp = [words[previous], words[previous + 1], words[previous + 2], words[previous + 3]];
        if word % 4 == 0 {
            // RotWord + SubWord + Rcon
            temp = [
                sbox[temp[1] as usize] ^ RCON[word / 4],
                sbox[temp[2] as usize],
                sbox[temp[3] as usize],
                sbox[temp[0] as usize],
            ];
        }
        for offset in 0..4 {
            words[base + offset] = words[base - 16 + offset] ^ temp[offset];
        }
    }
    let mut round_keys = [[0u8; 16]; 11];
    for round in 0..11 {
        round_keys[round].copy_from_slice(&words[round * 16..round * 16 + 16]);
    }
    Ok(round_keys)
}

fn add_round_key(state: &mut [u8; 16], round_key: &[u8; 16]) {
    for index in 0..16 {
        state[index] ^= round_key[index];
    }
}

/// InvShiftRows：第 r 行循环右移 r 字节（状态按列优先存放）
fn inv_shift_rows(state: &mut [u8; 16]) {
    for row in 1..4 {
        let original = [state[row], state[row + 4], state[row + 8], state[row + 12]];
        for column in 0..4 {
            state[row + 4 * column] = original[(column + 4 - row) % 4];
        }
    }
}

fn inv_sub_bytes(state: &mut [u8; 16]) {
    let sbox_inv = *SBOX_INV;
    for byte in state.iter_mut() {
        *byte = sbox_inv[*byte as usize];
    }
}

/// InvMixColumns：每列乘 [0e 0b 0d 09; 09 0e 0b 0d; 0d 09 0e 0b; 0b 0d 09 0e]
fn inv_mix_columns(state: &mut [u8; 16]) {
    for column in 0..4 {
        let base = column * 4;
        let a = [state[base], state[base + 1], state[base + 2], state[base + 3]];
        state[base] = gf_mul(a[0], 0x0e) ^ gf_mul(a[1], 0x0b) ^ gf_mul(a[2], 0x0d) ^ gf_mul(a[3], 0x09);
        state[base + 1] = gf_mul(a[0], 0x09) ^ gf_mul(a[1], 0x0e) ^ gf_mul(a[2], 0x0b) ^ gf_mul(a[3], 0x0d);
        state[base + 2] = gf_mul(a[0], 0x0d) ^ gf_mul(a[1], 0x09) ^ gf_mul(a[2], 0x0e) ^ gf_mul(a[3], 0x0b);
        state[base + 3] = gf_mul(a[0], 0x0b) ^ gf_mul(a[1], 0x0d) ^ gf_mul(a[2], 0x09) ^ gf_mul(a[3], 0x0e);
    }
}

/// 单块 AES-128 解密（FIPS-197 §5.3 的等价逆流程）
fn decrypt_block(block: &mut [u8; 16], round_keys: &[[u8; 16]; 11]) {
    add_round_key(block, &round_keys[10]);
    for round in (1..10).rev() {
        inv_shift_rows(block);
        inv_sub_bytes(block);
        add_round_key(block, &round_keys[round]);
        inv_mix_columns(block);
    }
    inv_shift_rows(block);
    inv_sub_bytes(block);
    add_round_key(block, &round_keys[0]);
}

/// AES-128-CBC 解密 + PKCS#7 去填充
fn aes_128_cbc_decrypt(cipher_text: &[u8], key: &[u8], iv: &[u8]) -> Result<Vec<u8>, String> {
    if iv.len() != 16 {
        return Err(format!("AES-CBC 需要 16 字节 iv，实际 {}", iv.len()));
    }
    if cipher_text.is_empty() || cipher_text.len() % 16 != 0 {
        return Err(format!("密文长度必须是 16 的倍数，实际 {}", cipher_text.len()));
    }
    let round_keys = expand_key(key)?;
    let mut previous = [0u8; 16];
    previous.copy_from_slice(iv);
    let mut plain = Vec::with_capacity(cipher_text.len());
    for chunk in cipher_text.chunks(16) {
        let mut block = [0u8; 16];
        block.copy_from_slice(chunk);
        let cipher_block = block;
        decrypt_block(&mut block, &round_keys);
        for index in 0..16 {
            block[index] ^= previous[index];
        }
        previous = cipher_block;
        plain.extend_from_slice(&block);
    }
    let pad = *plain.last().ok_or("解密结果为空")? as usize;
    if pad == 0 || pad > 16 || pad > plain.len() || plain[plain.len() - pad..].iter().any(|&b| b as usize != pad) {
        return Err("PKCS#7 填充非法".into());
    }
    plain.truncate(plain.len() - pad);
    Ok(plain)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Node 生成：key=2460000000000000，iv=abcdefghijklm000（封装同 FongMi cbc）
    const CBC_VECTOR: &str = "24233234362324b41fbd204f67e41b7cd47185686e7eb726c466049f37eafbebecd0302e9fae8001bd69c5c261c88b5b421d2c38a7781629df4d6c24ea8c72acd26531835ca5976fa8749c2bdc21309184b92060056db559cc2d3e430f4c21bebcaa5ebe950cb82cef7b5bfa6431dc49e38d686e4422f9bbc3e598ca7277a9352305d245b20496a1e6d86b96423d35b639a5c30668d8fb14a265232d35160493a407111746d53dc9d4efafdfeb12008a8da8b11bcd9ab26162636465666768696a6b6c6d";
    const CBC_PLAINTEXT: &str = r#"{"sites":[{"key":"demo","name":"测试","type":1,"api":"http://example.com/api.php/provide/vod"}],"lives":[{"name":"live","url":"http://example.com/live.m3u"}]}"#;

    fn encode_stego(json: &str) -> String {
        let b64 = base64_encode(json.as_bytes());
        format!("zfBUZLYa**{b64}")
    }

    /// 测试用编码器：验证解码器需要能自己造输入
    fn base64_encode(input: &[u8]) -> String {
        let mut out = String::new();
        for chunk in input.chunks(3) {
            let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
            let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
            out.push(BASE64_ALPHABET[((n >> 18) & 63) as usize] as char);
            out.push(BASE64_ALPHABET[((n >> 12) & 63) as usize] as char);
            out.push(if chunk.len() > 1 { BASE64_ALPHABET[((n >> 6) & 63) as usize] as char } else { '=' });
            out.push(if chunk.len() > 2 { BASE64_ALPHABET[(n & 63) as usize] as char } else { '=' });
        }
        out
    }

    fn decode_hex(input: &str) -> Vec<u8> {
        hex_decode(input).expect("测试向量必须是合法 hex")
    }

    #[test]
    fn aes_decrypt_matches_fips_197_vector() {
        // FIPS-197 C.1：key 000102...0f，密文 69c4e0d8... → 明文 00112233...
        let key = decode_hex("000102030405060708090a0b0c0d0e0f");
        let round_keys = expand_key(&key).unwrap();
        let mut block = [0u8; 16];
        block.copy_from_slice(&decode_hex("69c4e0d86a7b0430d8cdb78070b4c55a"));
        decrypt_block(&mut block, &round_keys);
        assert_eq!(
            block.to_vec(),
            decode_hex("00112233445566778899aabbccddeeff"),
            "AES-128 解密结果必须与 FIPS-197 官方向量一致"
        );
    }

    #[test]
    fn sbox_inverse_is_consistent() {
        for value in 0..=255u8 {
            let forward = SBOX[value as usize];
            assert_eq!(SBOX_INV[forward as usize], value);
        }
        // S-box 首尾两个公开值，防止 gf 运算整体错位
        assert_eq!(SBOX[0x00], 0x63);
        assert_eq!(SBOX[0x01], 0x7c);
        assert_eq!(SBOX[0xff], 0x16);
    }

    #[test]
    fn plain_json_returned_unchanged() {
        let input = r#"{"sites":[{"key":"a","name":"n","type":1,"api":"http://x/api"}]}"#;
        assert_eq!(decode("http://host/config.json", input), input);
    }

    #[test]
    fn stego_base64_decoded() {
        let json = r#"{"sites":[{"key":"k","name":"n","api":"http://x/api"}]}"#;
        assert_eq!(decode("https://cdn.example.com/in.bmp", &encode_stego(json)), json);
    }

    #[test]
    fn stego_skips_noise_and_finds_real_payload() {
        // 图片二进制里可能先出现能解码但不是配置的候选
        let json = r#"{"lives":[{"name":"live","url":"http://x/live.m3u"}]}"#;
        let payload = format!("AAAAAAAA**AAAA{}", encode_stego(json));
        assert_eq!(decode("https://cdn.example.com/in.bmp", &payload), json);
    }

    #[test]
    fn stego_binary_prefix_is_tolerated() {
        let json = r#"{"sites":[]}"#;
        let raw = format!("\u{fffd}\u{fffd}JFIF\u{0}\u{1}xx{}", encode_stego(json));
        assert_eq!(decode("https://cdn.example.com/in.bmp", &raw), json);
    }

    #[test]
    fn aes_cbc_decoded() {
        assert_eq!(decode("https://raw.githubusercontent.com/a/b/XC.json", CBC_VECTOR), CBC_PLAINTEXT);
    }

    #[test]
    fn aes_cbc_with_whitespace_decoded() {
        let spaced = CBC_VECTOR
            .as_bytes()
            .chunks(64)
            .map(|c| String::from_utf8_lossy(c).into_owned())
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(decode("https://raw.githubusercontent.com/a/b/XC.json", &spaced), CBC_PLAINTEXT);
    }

    #[test]
    fn aes_cbc_rejects_broken_payload() {
        let broken = "24233234362324ffff";
        assert_eq!(decode("https://x/y.json", broken), broken, "解码失败时原样返回，交给 JSON 解析报错");
    }

    #[test]
    fn unknown_text_returned_unchanged() {
        let html = "<html><body>not a config</body></html>";
        assert_eq!(decode("https://x/y", html), html);
    }

    #[test]
    fn empty_input_stays_empty() {
        assert_eq!(decode("https://x/y", ""), "");
    }

    #[test]
    fn relative_js_paths_rewritten() {
        let json = r#"{"sites":[{"key":"k","name":"n","ext":"./js/a.js","api":"../api/b.js"}]}"#;
        let out = decode("https://host/dir/config.json", json);
        assert!(out.contains(r#""https://host/dir/js/a.js""#), "实际: {out}");
        assert!(out.contains(r#""https://host/api/b.js""#), "实际: {out}");
    }

    #[test]
    fn js_markers_rewritten() {
        let json = r#"{"sites":[{"ext":"__JS1__lib/a.js"},{"ext":"__JS2__lib/b.js"}]}"#;
        let out = decode("https://host/dir/config.json", json);
        assert!(out.contains("https://host/dir/lib/a.js"), "实际: {out}");
        assert!(out.contains("https://host/lib/b.js"), "实际: {out}");
    }

    #[test]
    fn base_dir_handles_root_and_query() {
        assert_eq!(base_dir_and_parent("https://host/a/b.json").unwrap(), ("https://host/a/".into(), "https://host/".into()));
        assert_eq!(base_dir_and_parent("https://host/b.json?v=1").unwrap(), ("https://host/".into(), "https://host/".into()));
    }

    #[test]
    fn pad_key_pads_and_truncates() {
        assert_eq!(pad_key("246"), "2460000000000000");
        assert_eq!(pad_key("abcdefghijklm"), "abcdefghijklm000");
        assert_eq!(pad_key("0123456789abcdefEXTRA"), "0123456789abcdef");
    }

    #[test]
    fn base64_roundtrip_and_lenient_whitespace() {
        let json = r#"{"sites":[]}"#;
        let b64 = base64_encode(json.as_bytes());
        assert_eq!(base64_decode(b64.as_bytes()).unwrap(), json.as_bytes());
        let with_newlines = b64.as_bytes().chunks(8).map(|c| String::from_utf8_lossy(c).into_owned()).collect::<Vec<_>>().join("\r\n");
        assert_eq!(decode("https://x/in.bmp", &format!("aaaaaaaa**{with_newlines}")), json);
    }

    #[test]
    fn hex_decode_rejects_odd_length() {
        assert!(hex_decode("abc").is_none());
        assert!(hex_decode("zz").is_none());
        assert_eq!(hex_decode("2423").unwrap(), vec![0x24, 0x23]);
    }
}
