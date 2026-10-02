//! JS 蜘蛛会话复用。
//!
//! 此前每次方法调用都要新建 QuickJS Runtime 并重新装载 cheerio + crypto-js + drpy2（约 600KB JS），
//! 单次 home 调用 2-7 秒里有一大截花在这上面。这里把「一个站点（api + ext）」的 Runtime/Context
//! 常驻在专属线程里，装载与 `init(ext)` 只做一次，后续方法调用直接复用。
//!
//! 生命周期：空闲 `IDLE_TIMEOUT` 后线程自行退出；同时最多保留 `MAX_SESSIONS` 个会话（LRU 淘汰）；
//! 调用超时或线程退出时由下一次调用重建。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value as JsonValue;

use crate::error::AppError;

/// 空闲多久回收会话
const IDLE_TIMEOUT: Duration = Duration::from_secs(180);
/// 同时保留的会话数上限（每个会话内含一份 cheerio + drpy2）
const MAX_SESSIONS: usize = 3;
/// 单次调用等待上限；外层 tokio 超时更宽松，超时即重建会话
const CALL_TIMEOUT: Duration = Duration::from_secs(30);

/// 当前时间（epoch 毫秒），用作 JS 中断处理器的截止时间基准
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

struct Job {
    method: String,
    args: Vec<JsonValue>,
    reply: Sender<Result<JsonValue, AppError>>,
}

/// 一个站点的常驻 JS 会话句柄（可跨线程共享，实际执行在专属线程里）
pub struct SpiderSession {
    tx: Sender<Job>,
    deadline: Arc<AtomicU64>,
    last_used: AtomicU64,
}

impl SpiderSession {
    /// 返回 `Ok(结果)`；worker 已退出或超时返回 `Err(())`，由调用方重建会话
    fn invoke(&self, method: &str, args: &[JsonValue]) -> Result<Result<JsonValue, AppError>, ()> {
        let (reply_tx, reply_rx) = channel();
        // worker 每次执行前会读取这个截止时间；此处先设一个宽松值，worker 会按模块/脚本类型重设
        self.deadline
            .store(now_ms() + 30_000, Ordering::Relaxed);
        self.last_used.store(now_ms(), Ordering::Relaxed);
        let job = Job {
            method: method.to_string(),
            args: args.to_vec(),
            reply: reply_tx,
        };
        if self.tx.send(job).is_err() {
            return Err(());
        }
        match reply_rx.recv_timeout(CALL_TIMEOUT) {
            Ok(result) => Ok(result),
            Err(_) => Err(()),
        }
    }
}

static SESSIONS: LazyLock<Mutex<HashMap<String, Arc<SpiderSession>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn session_key(api: &str, ext: Option<&str>) -> String {
    format!("{api}\u{1}{}", ext.unwrap_or(""))
}

/// 取会话；`force_new` 时先淘汰旧会话（用于线程已退出的重建）
fn session_for(api: &str, ext: Option<&str>, force_new: bool) -> Result<Arc<SpiderSession>, AppError> {
    let key = session_key(api, ext);
    let mut sessions = SESSIONS
        .lock()
        .map_err(|_| AppError::internal("JS 会话表被污染"))?;

    if !force_new {
        if let Some(session) = sessions.get(&key) {
            return Ok(session.clone());
        }
    }

    sessions.remove(&key);
    // LRU 淘汰：按最近使用时间踢掉最旧的
    while sessions.len() >= MAX_SESSIONS {
        let victim = sessions
            .iter()
            .min_by_key(|(_, session)| session.last_used.load(Ordering::Relaxed))
            .map(|(key, _)| key.clone());
        match victim {
            Some(key) => {
                sessions.remove(&key);
            }
            None => break,
        }
    }

    let deadline = Arc::new(AtomicU64::new(now_ms() + 30_000));
    let (tx, rx) = channel::<Job>();
    let thread_api = api.to_string();
    let thread_ext = ext.map(str::to_string);
    let thread_deadline = deadline.clone();
    std::thread::Builder::new()
        .name("js-spider-session".to_string())
        .spawn(move || worker_loop(&thread_api, thread_ext.as_deref(), rx, thread_deadline))
        .map_err(|e| AppError::internal("创建 JS 会话线程失败").with_internal(e.to_string()))?;

    let session = Arc::new(SpiderSession {
        tx,
        deadline,
        last_used: AtomicU64::new(now_ms()),
    });
    sessions.insert(key, session.clone());
    Ok(session)
}

/// 在工作线程里跑方法；失败会重建会话重试一次
pub fn call(
    api: &str,
    ext: Option<&str>,
    method: &str,
    args: &[JsonValue],
) -> Result<JsonValue, AppError> {
    let mut last_error = AppError::internal("JS 会话不可用");
    for attempt in 0..2 {
        let session = match session_for(api, ext, attempt > 0) {
            Ok(session) => session,
            Err(error) => return Err(error),
        };
        match session.invoke(method, args) {
            Ok(result) => return result,
            Err(()) => {
                last_error = AppError::internal("JS 会话已退出或超时，已重建").with_internal(
                    format!("api={api} method={method}"),
                );
            }
        }
    }
    Err(last_error)
}

/// 关闭某个站点的会话（测试与显式清理用）
pub fn drop_session(api: &str, ext: Option<&str>) {
    if let Ok(mut sessions) = SESSIONS.lock() {
        sessions.remove(&session_key(api, ext));
    }
}

fn worker_loop(
    api: &str,
    ext: Option<&str>,
    rx: std::sync::mpsc::Receiver<Job>,
    deadline: Arc<AtomicU64>,
) {
    let mut prepared: Option<(rquickjs::Runtime, rquickjs::Context, u64)> = None;
    let mut setup_error: Option<AppError> = None;

    loop {
        let job = match rx.recv_timeout(IDLE_TIMEOUT) {
            Ok(job) => job,
            Err(RecvTimeoutError::Timeout) | Err(RecvTimeoutError::Disconnected) => return,
        };

        if prepared.is_none() {
            if let Some(error) = setup_error.take() {
                let _ = job.reply.send(Err(error));
                return;
            }
            match crate::js_runtime::prepare_spider(api, ext, deadline.clone()) {
                Ok(prepared_runtime) => prepared = Some(prepared_runtime),
                Err(error) => {
                    let _ = job.reply.send(Err(error.clone()));
                    setup_error = Some(error);
                    return;
                }
            }
        }

        let (runtime, context, budget_secs) = prepared.as_ref().expect("会话已装载");
        let _ = runtime; // 保留所有权，实际执行走 context
        deadline.store(now_ms() + budget_secs * 1000, Ordering::Relaxed);
        let result = crate::js_runtime::invoke_method(context, &job.method, &job.args);
        // 执行超时（interrupt）后运行时可能处于不可恢复状态：这一次返回错误后退出，下次重建
        let unrecoverable = matches!(result, Err(ref error) if error.code == crate::error::ErrorCode::Timeout);
        let _ = job.reply.send(result);
        if unrecoverable {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_key_distinguishes_api_and_ext() {
        assert_eq!(session_key("api", None), session_key("api", None));
        assert_ne!(session_key("api", None), session_key("api", Some("ext")));
        assert_ne!(session_key("api", None), session_key("other", None));
    }

    #[test]
    fn loader_failure_reaches_caller_instead_of_hanging() {
        // 连接被拒：装载失败必须立刻把错误回给调用方，而不是让调用方等到超时
        let api = "http://127.0.0.1:9/nope.js";
        let started = std::time::Instant::now();
        let error = call(api, None, "home", &[]).expect_err("应当返回错误");
        assert!(
            started.elapsed() < CALL_TIMEOUT,
            "错误返回耗时 {:?}，不该等到超时",
            started.elapsed()
        );
        assert!(
            matches!(error.code, crate::error::ErrorCode::NetworkError | crate::error::ErrorCode::Timeout),
            "意外错误类型: {error:?}"
        );
        drop_session(api, None);
    }

    #[test]
    fn idle_timeout_is_longer_than_call_timeout() {
        assert!(IDLE_TIMEOUT > CALL_TIMEOUT, "空闲回收应晚于单次调用超时");
    }
}
