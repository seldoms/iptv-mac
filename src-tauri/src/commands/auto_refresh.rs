use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Manager};

static AUTO_REFRESH_RUNNING: AtomicBool = AtomicBool::new(false);

fn should_auto_refresh(
    last_refresh: i64,
    has_live_channels: bool,
    now: i64,
    interval_mins: i64,
) -> bool {
    if interval_mins <= 0 || interval_mins > 1440 {
        return false;
    }
    if last_refresh <= 0 || !has_live_channels {
        return false;
    }
    now - last_refresh >= interval_mins * 60
}

/// 启动自动刷新后台任务
pub fn start_auto_refresh(app_handle: AppHandle) {
    if AUTO_REFRESH_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }

    let running = Arc::new(AtomicBool::new(true));
    let r = running.clone();
    let handle = app_handle.clone();

    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(20));

        while r.load(Ordering::SeqCst) {
            let has_saved_config = {
                let state = handle.state::<crate::AppState>();
                let has_config = !state.config_manager.lock().list().is_empty();
                has_config
            };
            if !has_saved_config {
                std::thread::sleep(Duration::from_secs(30));
                continue;
            }

            let interval_mins = {
                let state = handle.state::<crate::AppState>();
                let db = state.database.lock();
                db.get_refresh_status()
                    .ok()
                    .and_then(|s| s.get("refresh_interval_minutes").and_then(|v| v.as_i64()))
                    .unwrap_or(30)
            };

            let last_refresh = {
                let state = handle.state::<crate::AppState>();
                let db = state.database.lock();
                db.get_refresh_status()
                    .ok()
                    .and_then(|s| s.get("last_refresh_time").and_then(|v| v.as_i64()))
                    .unwrap_or(0)
            };
            let has_live_channels = {
                let state = handle.state::<crate::AppState>();
                let db = state.database.lock();
                db.get_live_tree()
                    .ok()
                    .and_then(|value| value.as_array().map(|items| !items.is_empty()))
                    .unwrap_or(false)
            };

            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);

            if should_auto_refresh(last_refresh, has_live_channels, now, interval_mins) {
                eprintln!("[auto_refresh] 触发刷新 (interval={}min)", interval_mins);
                let state = handle.state::<crate::AppState>();
                let _ = crate::commands::handle_live_refresh(&state, Some(&handle));
            }

            std::thread::sleep(Duration::from_secs(30));
        }
    });

    let r2 = running.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));
        let state = app_handle.state::<crate::AppState>();
        if state.database.lock().get_refresh_status().is_err() {
            r2.store(false, Ordering::SeqCst);
            break;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::should_auto_refresh;

    #[test]
    fn skips_first_launch_without_refresh_history() {
        assert!(!should_auto_refresh(0, true, 3_600, 30));
    }

    #[test]
    fn skips_when_live_channel_cache_is_empty() {
        assert!(!should_auto_refresh(1_000, false, 3_600, 30));
    }

    #[test]
    fn refreshes_only_after_interval_elapsed() {
        assert!(!should_auto_refresh(1_000, true, 2_700, 30));
        assert!(should_auto_refresh(1_000, true, 2_800, 30));
    }

    #[test]
    fn skips_invalid_intervals() {
        assert!(!should_auto_refresh(1_000, true, 3_000, 0));
        assert!(!should_auto_refresh(1_000, true, 3_000, 1_441));
    }
}
