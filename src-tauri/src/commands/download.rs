//! 内置下载管理：调用本机命令行工具（N_m3u8DL-RE / ffmpeg / yt-dlp）下载 m3u8 / HLS 媒体。
//!
//! 设计约束：
//! - 只允许白名单工具，参数以数组传给 Command，不经过 shell，避免注入；
//! - 工具解析顺序：应用包内 `Contents/Resources/bin/<tool>` → PATH 与常见安装目录；
//!   把 ffmpeg 放进包内即可离线可用，否则回退到系统安装的版本；
//! - 任务表保存在 Rust 侧，前端只做展示，窗口刷新不丢进度；
//! - 输出目录固定为 ~/Downloads/IPTV，文件名做安全清洗。

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::AppError;

/// 优先顺序：N_m3u8DL-RE 对带鉴权的 m3u8 支持最好，其次 ffmpeg，最后 yt-dlp。
const TOOL_ORDER: [&str; 3] = ["N_m3u8DL-RE", "ffmpeg", "yt-dlp"];

const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

#[derive(Debug, Clone, Serialize)]
pub struct DownloadTask {
    pub id: String,
    pub name: String,
    pub url: String,
    pub tool: String,
    pub dir: String,
    pub path: String,
    /// running | done | failed | cancelled
    pub status: String,
    /// 是否为直播录像（输出 TS，可随时停止）
    pub live: bool,
    /// 0..1；未知为 -1
    pub progress: f64,
    pub out_time_ms: u64,
    pub total_size: u64,
    pub speed: String,
    pub message: String,
    pub started_at: u64,
    pub log: Vec<String>,
}

static TASKS: OnceLock<Mutex<HashMap<String, DownloadTask>>> = OnceLock::new();
static CHILDREN: OnceLock<Mutex<HashMap<String, Child>>> = OnceLock::new();
static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn tasks() -> &'static Mutex<HashMap<String, DownloadTask>> {
    TASKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn children() -> &'static Mutex<HashMap<String, Child>> {
    CHILDREN.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 打包后的资源可能丢失执行位，这里补上，避免"权限不足"这类难以排查的失败。
#[cfg(unix)]
fn ensure_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(metadata) = std::fs::metadata(path) {
        let mut permissions = metadata.permissions();
        if permissions.mode() & 0o111 == 0 {
            permissions.set_mode(permissions.mode() | 0o755);
            let _ = std::fs::set_permissions(path, permissions);
        }
    }
}

#[cfg(not(unix))]
fn ensure_executable(_path: &Path) {}

/// 解析工具路径：包内 bin/ 优先，其次 PATH 与常见目录。
fn resolve_tool(app: Option<&AppHandle>, tool: &str) -> Option<PathBuf> {
    if let Some(handle) = app {
        if let Ok(resource_dir) = handle.path().resource_dir() {
            for candidate in [resource_dir.join("bin").join(tool), resource_dir.join(tool)] {
                if candidate.is_file() {
                    ensure_executable(&candidate);
                    return Some(candidate);
                }
            }
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(macos_dir) = exe.parent() {
                let resources = macos_dir.parent().map(|p| p.join("Resources")).unwrap_or_default();
                let candidate = resources.join("bin").join(tool);
                if candidate.is_file() {
                    ensure_executable(&candidate);
                    return Some(candidate);
                }
            }
        }
    }

    let mut dirs: Vec<PathBuf> = std::env::var("PATH")
        .unwrap_or_default()
        .split(':')
        .filter(|segment| !segment.is_empty())
        .map(PathBuf::from)
        .collect();
    for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        dirs.push(PathBuf::from(extra));
    }
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(&home).join(".local/bin"));
        dirs.push(PathBuf::from(&home).join("bin"));
    }
    for dir in dirs {
        let candidate = dir.join(tool);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn tool_list(app: Option<&AppHandle>) -> Vec<Value> {
    TOOL_ORDER
        .iter()
        .map(|tool| match resolve_tool(app, tool) {
            Some(path) => {
                let bundled = path.to_string_lossy().contains("/Resources/");
                json!({ "name": tool, "path": path.to_string_lossy(), "available": true, "bundled": bundled })
            }
            None => json!({ "name": tool, "available": false, "bundled": false }),
        })
        .collect()
}

fn pick_tool(app: Option<&AppHandle>, preferred: Option<&str>) -> Result<(String, PathBuf), AppError> {
    if let Some(name) = preferred {
        if TOOL_ORDER.contains(&name) {
            if let Some(path) = resolve_tool(app, name) {
                return Ok((name.to_string(), path));
            }
        }
    }
    for tool in TOOL_ORDER {
        if let Some(path) = resolve_tool(app, tool) {
            return Ok((tool.to_string(), path));
        }
    }
    Err(AppError::not_found(
        "未找到可用的下载工具：请把 ffmpeg 放入应用包内 bin/，或安装 ffmpeg / N_m3u8DL-RE / yt-dlp",
    ))
}

fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if (c as u32) < 0x20 => ' ',
            c => c,
        })
        .collect();
    let limited: String = cleaned.trim().chars().take(80).collect();
    let final_name = limited.trim().trim_matches('_').trim();
    if final_name.is_empty() {
        "iptv-download".to_string()
    } else {
        final_name.to_string()
    }
}

/// 探测 ffmpeg 的 HLS 相关选项并按版本组合参数。
///
/// 很多采集站把 TS 分片伪装成 `.jpg` 防盗链，ffmpeg 默认的扩展名白名单会直接拒绝：
///   "URL .../seg_00000.jpg is not in allowed_segment_extensions"
/// 6.x 只有 `-allowed_extensions`，8.x 拆成 `-allowed_segment_extensions` 并新增 `-extension_picky`；
/// 传不存在的选项会让 ffmpeg 直接报错退出，所以这里按实际支持情况拼参数（结果缓存）。
fn hls_compat_args(tool_path: &Path) -> Vec<String> {
    use std::sync::OnceLock;
    static CACHE: OnceLock<Mutex<HashMap<String, Vec<String>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let key = tool_path.to_string_lossy().to_string();
    if let Ok(map) = cache.lock() {
        if let Some(found) = map.get(&key) {
            return found.clone();
        }
    }

    let help = Command::new(tool_path)
        .args(["-hide_banner", "-h", "demuxer=hls"])
        .output();
    let text = help
        .map(|output| String::from_utf8_lossy(&output.stdout).to_string() + &String::from_utf8_lossy(&output.stderr))
        .unwrap_or_default();

    let mut args = Vec::new();
    if text.contains("-allowed_segment_extensions") {
        args.push("-allowed_segment_extensions".to_string());
        args.push("ALL".to_string());
    } else if text.contains("-allowed_extensions") {
        args.push("-allowed_extensions".to_string());
        args.push("ALL".to_string());
    }
    if text.contains("-extension_picky") {
        args.push("-extension_picky".to_string());
        args.push("0".to_string());
    }

    if let Ok(mut map) = cache.lock() {
        map.insert(key, args.clone());
    }
    args
}

fn default_download_dir() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/tmp"));
    home.join("Downloads").join("IPTV")
}

fn is_supported_media_url(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

fn ffmpeg_headers_value(headers: &HashMap<String, String>) -> Option<String> {
    if headers.is_empty() {
        return None;
    }
    Some(
        headers
            .iter()
            .map(|(key, value)| format!("{}: {}\r\n", key, value))
            .collect(),
    )
}

fn header_args(tool: &str, headers: &HashMap<String, String>) -> Vec<String> {
    let mut args = Vec::new();
    if tool == "ffmpeg" {
        return args;
    }
    for (key, value) in headers {
        args.push("-H".to_string());
        args.push(format!("{}: {}", key, value));
    }
    args
}

/// 组装命令行（独立出来便于测试）。
fn build_args(
    tool: &str,
    url: &str,
    headers: &HashMap<String, String>,
    output: &Path,
    base_name: &str,
    output_dir: &Path,
) -> Vec<String> {
    build_args_with_mode(tool, url, headers, output, base_name, output_dir, false, &[])
}

/// `live=true` 为直播录像：输出 MPEG-TS，任何时刻中断（停止录像）都还能播放。
fn build_args_with_mode(
    tool: &str,
    url: &str,
    headers: &HashMap<String, String>,
    output: &Path,
    base_name: &str,
    output_dir: &Path,
    live: bool,
    input_compat: &[String],
) -> Vec<String> {
    match tool {
        "ffmpeg" => {
            let mut args = vec![
                "-y".to_string(),
                "-hide_banner".to_string(),
                "-loglevel".to_string(),
                "warning".to_string(),
                "-nostdin".to_string(),
                "-user_agent".to_string(),
                USER_AGENT.to_string(),
            ];
            if let Some(value) = ffmpeg_headers_value(headers) {
                args.push("-headers".to_string());
                args.push(value);
            }
            // 兼容 .jpg 伪装分片等防盗链写法
            args.extend(input_compat.iter().cloned());
            args.extend([
                "-progress".to_string(),
                "pipe:1".to_string(),
                "-i".to_string(),
                url.to_string(),
                "-c".to_string(),
                "copy".to_string(),
            ]);
            if live {
                // 直播录像：MPEG-TS 容器容忍任意时刻中断
                args.push("-f".to_string());
                args.push("mpegts".to_string());
            } else {
                args.push("-bsf:a".to_string());
                args.push("aac_adtstoasc".to_string());
            }
            args.push(output.to_string_lossy().to_string());
            args
        }
        "yt-dlp" => {
            let mut args = vec![
                "--no-playlist".to_string(),
                "--newline".to_string(),
                "--no-mtime".to_string(),
                "-o".to_string(),
                output_dir.join(format!("{base_name}.%(ext)s")).to_string_lossy().to_string(),
            ];
            args.extend(header_args("yt-dlp", headers));
            args.push(url.to_string());
            args
        }
        _ => {
            let mut args = vec![
                url.to_string(),
                "--save-dir".to_string(),
                output_dir.to_string_lossy().to_string(),
                "--save-name".to_string(),
                base_name.to_string(),
                "--auto-select".to_string(),
                "--no-log".to_string(),
            ];
            args.extend(header_args("N_m3u8DL-RE", headers));
            args
        }
    }
}

/// ffmpeg `-progress` 输出解析：返回 (out_time_ms, total_size, speed, finished)
fn parse_progress_line(line: &str) -> Option<(u64, u64, Option<String>, bool)> {
    let (key, value) = line.split_once('=')?;
    match key.trim() {
        "out_time_ms" | "out_time_us" => value
            .trim()
            .parse::<u64>()
            .ok()
            .map(|v| (v / 1000, 0, None, false)),
        "total_size" => value.trim().parse::<u64>().ok().map(|v| (0, v, None, false)),
        "speed" => Some((0, 0, Some(value.trim().to_string()), false)),
        "progress" => Some((0, 0, None, value.trim() == "end")),
        _ => None,
    }
}

#[tauri::command]
pub fn cmd_download_tools(app: AppHandle) -> Value {
    json!({ "tools": tool_list(Some(&app)), "defaultDir": default_download_dir().to_string_lossy() })
}

#[tauri::command]
pub fn cmd_download_list() -> Vec<DownloadTask> {
    let mut list: Vec<DownloadTask> = tasks()
        .lock()
        .map(|map| map.values().cloned().collect())
        .unwrap_or_default();
    list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    list
}

/// 开始下载。返回任务快照。
#[tauri::command]
pub fn cmd_download_start(
    app: AppHandle,
    url: String,
    headers: Option<HashMap<String, String>>,
    file_name: Option<String>,
    tool: Option<String>,
    live: Option<bool>,
) -> Result<DownloadTask, String> {
    start_download(&app, &url, headers.unwrap_or_default(), file_name, tool, live.unwrap_or(false))
        .map_err(|e| e.to_string())
}

fn start_download(
    app: &AppHandle,
    url: &str,
    headers: HashMap<String, String>,
    file_name: Option<String>,
    tool: Option<String>,
    live: bool,
) -> Result<DownloadTask, AppError> {
    if !is_supported_media_url(url) {
        return Err(AppError::invalid_input("只支持 http/https 的媒体地址"));
    }
    let (tool_name, tool_path) = pick_tool(Some(app), tool.as_deref())?;
    let output_dir = default_download_dir();
    std::fs::create_dir_all(&output_dir).map_err(|e| AppError::internal(format!("创建下载目录失败: {e}")))?;

    let base_name = format!(
        "{}-{}",
        sanitize_file_name(file_name.as_deref().unwrap_or("iptv-download")),
        now_secs()
    );
    let output = output_dir.join(format!("{base_name}.{}", if live { "ts" } else { "mp4" }));
    let input_compat = if tool_name == "ffmpeg" { hls_compat_args(&tool_path) } else { Vec::new() };
    let args = build_args_with_mode(&tool_name, url, &headers, &output, &base_name, &output_dir, live, &input_compat);

    let id = format!("dl-{}", COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
    let task = DownloadTask {
        id: id.clone(),
        name: file_name.unwrap_or_else(|| "IPTV 下载".to_string()),
        url: url.to_string(),
        tool: tool_name.clone(),
        dir: output_dir.to_string_lossy().to_string(),
        path: output.to_string_lossy().to_string(),
        status: "running".to_string(),
        live,
        progress: -1.0,
        out_time_ms: 0,
        total_size: 0,
        speed: String::new(),
        message: "已开始".to_string(),
        started_at: now_secs(),
        log: vec![format!("{} {}", tool_path.to_string_lossy(), args.join(" "))],
    };
    tasks()
        .lock()
        .map_err(|_| AppError::internal("任务表加锁失败"))?
        .insert(id.clone(), task.clone());

    eprintln!("[download] {} {}", tool_path.to_string_lossy(), args.join(" "));

    let mut child = Command::new(&tool_path)
        .args(&args)
        .current_dir(&output_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::internal(format!("启动下载工具失败: {e}")))?;

    if let Some(stdout) = child.stdout.take() {
        read_stream(app.clone(), id.clone(), stdout, true);
    }
    if let Some(stderr) = child.stderr.take() {
        read_stream(app.clone(), id.clone(), stderr, false);
    }
    children()
        .lock()
        .map_err(|_| AppError::internal("进程表加锁失败"))?
        .insert(id.clone(), child);

    let _ = app.emit("download:progress", json!({ "task": task.clone() }));

    let app_handle = app.clone();
    let wait_id = id.clone();
    let wait_path = output.clone();
    std::thread::spawn(move || {
        let child = children().lock().ok().and_then(|mut map| map.remove(&wait_id));
        let Some(mut child) = child else { return };
        let status = child.wait();
        let exists = wait_path.exists();
        if let Ok(mut map) = tasks().lock() {
            if let Some(task) = map.get_mut(&wait_id) {
                if task.status == "running" {
                    match status {
                        Ok(status) if status.success() && exists => {
                            task.status = "done".to_string();
                            task.progress = 1.0;
                            task.message = "下载完成".to_string();
                            task.path = wait_path.to_string_lossy().to_string();
                        }
                        Ok(status) => {
                            task.status = "failed".to_string();
                            let last = task
                                .log
                                .iter()
                                .rev()
                                .find(|line| !line.contains('='))
                                .cloned()
                                .unwrap_or_default();
                            task.message = format!(
                                "退出码 {}{}",
                                status.code().unwrap_or(-1),
                                if last.is_empty() { String::new() } else { format!("：{}", last.chars().take(120).collect::<String>()) }
                            );
                        }
                        Err(error) => {
                            task.status = "failed".to_string();
                            task.message = format!("等待进程失败: {error}");
                        }
                    }
                }
                let snapshot = task.clone();
                let _ = app_handle.emit("download:progress", json!({ "task": snapshot }));
            }
        }
        eprintln!("[download] 结束 id={} exists={}", wait_id, exists);
    });

    Ok(task)
}

fn read_stream<R: std::io::Read + Send + 'static>(app: AppHandle, id: String, stream: R, is_stdout: bool) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().map_while(Result::ok) {
            let trimmed = line.trim().to_string();
            if trimmed.is_empty() {
                continue;
            }
            let mut snapshot: Option<DownloadTask> = None;
            let mut logged = false;
            if let Ok(mut map) = tasks().lock() {
                if let Some(task) = map.get_mut(&id) {
                    let mut handled = false;
                    if is_stdout {
                        if let Some((out_time_ms, total_size, speed, finished)) = parse_progress_line(&trimmed) {
                            if out_time_ms > 0 {
                                task.out_time_ms = out_time_ms;
                            }
                            if total_size > 0 {
                                task.total_size = total_size;
                            }
                            if let Some(speed) = speed {
                                task.speed = speed;
                            }
                            if finished {
                                task.progress = 0.99;
                            }
                            handled = true;
                        }
                    }
                    if !handled {
                        logged = true;
                        task.log.push(trimmed.clone());
                        if task.log.len() > 200 {
                            let overflow = task.log.len() - 200;
                            task.log.drain(0..overflow);
                        }
                    }
                    snapshot = Some(task.clone());
                }
            }
            if let Some(task) = snapshot {
                if logged {
                    eprintln!("[download] {}", trimmed);
                }
                let _ = app.emit("download:progress", json!({ "task": task }));
            }
        }
    });
}

#[tauri::command]
pub fn cmd_download_cancel(id: String) -> Result<(), String> {
    if let Ok(mut map) = children().lock() {
        if let Some(mut child) = map.remove(&id) {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    if let Ok(mut map) = tasks().lock() {
        if let Some(task) = map.get_mut(&id) {
            task.status = "cancelled".to_string();
            let kept = Path::new(&task.path).exists();
            task.message = if kept {
                format!("已停止，文件已保留（{}）", task.path)
            } else {
                "已取消".to_string()
            };
        }
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_download_remove(id: String) -> Result<(), String> {
    let _ = cmd_download_cancel(id.clone());
    if let Ok(mut map) = tasks().lock() {
        map.remove(&id);
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_download_clear_finished() -> Result<(), String> {
    if let Ok(mut map) = tasks().lock() {
        map.retain(|_, task| task.status == "running");
    }
    Ok(())
}

/// 在 Finder 中定位已下载文件。
#[tauri::command]
pub fn cmd_download_reveal(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err("文件不存在".to_string());
    }
    Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 打开下载目录。
#[tauri::command]
pub fn cmd_download_open_dir() -> Result<(), String> {
    let dir = default_download_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Command::new("open")
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_file_names() {
        assert_eq!(sanitize_file_name("a/b:c*d?e"), "a_b_c_d_e");
        assert_eq!(sanitize_file_name("   "), "iptv-download");
        assert_eq!(sanitize_file_name("../../etc/passwd"), ".._.._etc_passwd");
        assert!(sanitize_file_name(&"长".repeat(200)).chars().count() <= 80);
    }

    #[test]
    fn only_accepts_http_media_urls() {
        assert!(is_supported_media_url("https://example.com/a.m3u8"));
        assert!(!is_supported_media_url("file:///etc/passwd"));
        assert!(!is_supported_media_url("--evil-flag"));
        assert!(!is_supported_media_url(""));
    }

    #[test]
    fn builds_ffmpeg_args_with_headers_and_progress() {
        let mut headers = HashMap::new();
        headers.insert("Referer".to_string(), "https://example.com".to_string());
        let dir = PathBuf::from("/tmp/out");
        let args = build_args("ffmpeg", "https://example.com/a.m3u8", &headers, &dir.join("x.mp4"), "x", &dir);
        assert!(args.iter().any(|a| a == "-headers"));
        assert!(args.iter().any(|a| a.contains("Referer: https://example.com")));
        assert!(args.contains(&"pipe:1".to_string()));
        assert_eq!(args.last().unwrap(), "/tmp/out/x.mp4");
    }

    #[test]
    fn inserts_hls_compat_args_before_input() {
        let dir = PathBuf::from("/tmp/out");
        let compat = vec!["-allowed_extensions".to_string(), "ALL".to_string()];
        let args = build_args_with_mode(
            "ffmpeg",
            "https://e/a.m3u8",
            &HashMap::new(),
            &dir.join("x.mp4"),
            "x",
            &dir,
            false,
            &compat,
        );
        let input_at = args.iter().position(|a| a == "-i").unwrap();
        let compat_at = args.iter().position(|a| a == "-allowed_extensions").unwrap();
        assert!(compat_at < input_at, "兼容参数必须在 -i 之前: {:?}", args);
    }

    #[test]
    fn live_recording_uses_mpegts_and_skips_aac_filter() {
        let dir = PathBuf::from("/tmp/out");
        let args = build_args_with_mode(
            "ffmpeg",
            "https://e/live.m3u8",
            &HashMap::new(),
            &dir.join("r.ts"),
            "r",
            &dir,
            true,
            &[],
        );
        assert!(args.windows(2).any(|w| w == ["-f", "mpegts"]));
        assert!(!args.iter().any(|a| a == "aac_adtstoasc"));
        assert_eq!(args.last().unwrap(), "/tmp/out/r.ts");
    }

    #[test]
    fn parses_ffmpeg_progress_lines() {
        assert_eq!(parse_progress_line("out_time_ms=1500000"), Some((1500, 0, None, false)));
        assert_eq!(parse_progress_line("total_size=2048"), Some((0, 2048, None, false)));
        assert_eq!(parse_progress_line("speed=1.5x"), Some((0, 0, Some("1.5x".to_string()), false)));
        assert_eq!(parse_progress_line("progress=end"), Some((0, 0, None, true)));
        assert_eq!(parse_progress_line("frame=100"), None);
    }
}
