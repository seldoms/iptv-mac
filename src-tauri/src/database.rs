use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, Row};
use serde_json::{json, Value};

const SCHEMA_VERSION: i64 = 3;

struct Migration {
    version: i64,
    up: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        up: "
            CREATE TABLE IF NOT EXISTS history (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              siteKey TEXT NOT NULL,
              vodId TEXT NOT NULL,
              vodName TEXT NOT NULL,
              vodPic TEXT DEFAULT '',
              vodRemarks TEXT DEFAULT '',
              type INTEGER DEFAULT 0,
              source TEXT DEFAULT '',
              progress INTEGER DEFAULT 0,
              createTime INTEGER NOT NULL DEFAULT 0,
              updateTime INTEGER NOT NULL DEFAULT 0,
              UNIQUE(siteKey, vodId)
            );
            CREATE INDEX IF NOT EXISTS idx_history_update ON history(updateTime DESC);
            CREATE TABLE IF NOT EXISTS keep (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              siteKey TEXT NOT NULL,
              vodId TEXT NOT NULL,
              vodName TEXT NOT NULL,
              vodPic TEXT DEFAULT '',
              vodRemarks TEXT DEFAULT '',
              type INTEGER DEFAULT 0,
              source TEXT DEFAULT '',
              createTime INTEGER NOT NULL DEFAULT 0,
              updateTime INTEGER NOT NULL DEFAULT 0,
              UNIQUE(siteKey, vodId)
            );
            CREATE INDEX IF NOT EXISTS idx_keep_update ON keep(updateTime DESC);
            CREATE TABLE IF NOT EXISTS cache (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL DEFAULT '',
              createTime INTEGER NOT NULL DEFAULT 0
            );
        ",
    },
    Migration {
        version: 2,
        up: "
            CREATE TABLE IF NOT EXISTS live_channels (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              urls TEXT NOT NULL,
              best_url TEXT NOT NULL,
              country TEXT NOT NULL,
              category TEXT NOT NULL,
              sort_order REAL DEFAULT 0,
              latency INTEGER DEFAULT -2,
              original_groups TEXT,
              last_test_time INTEGER NOT NULL,
              is_alive INTEGER DEFAULT 1,
              UNIQUE(name, country, category)
            );
            CREATE INDEX IF NOT EXISTS idx_live_channels_country_category
              ON live_channels(country, category, sort_order);
            CREATE INDEX IF NOT EXISTS idx_live_channels_alive
              ON live_channels(is_alive);
            CREATE TABLE IF NOT EXISTS live_refresh_status (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              last_refresh_time INTEGER,
              next_refresh_time INTEGER,
              refresh_interval_minutes INTEGER DEFAULT 30,
              total_channels INTEGER DEFAULT 0,
              alive_channels INTEGER DEFAULT 0,
              status TEXT DEFAULT 'idle'
            );
            INSERT OR IGNORE INTO live_refresh_status (id, status, refresh_interval_minutes)
              VALUES (1, 'idle', 30);
        ",
    },
    Migration {
        version: 3,
        up: "
            ALTER TABLE history ADD COLUMN episodeId TEXT DEFAULT '';
            ALTER TABLE history ADD COLUMN episodeName TEXT DEFAULT '';
            ALTER TABLE history ADD COLUMN episodeIndex INTEGER DEFAULT 0;
            ALTER TABLE history ADD COLUMN sourceIndex INTEGER DEFAULT 0;
            ALTER TABLE history ADD COLUMN sourceName TEXT DEFAULT '';
            ALTER TABLE history ADD COLUMN urlIdentifier TEXT DEFAULT '';
            ALTER TABLE history ADD COLUMN duration INTEGER DEFAULT 0;
            ALTER TABLE history ADD COLUMN positionSeconds INTEGER DEFAULT 0;
            ALTER TABLE history ADD COLUMN completed INTEGER DEFAULT 0;
        ",
    },
];

#[derive(Debug)]
pub struct Database {
    connection: Connection,
}

impl Database {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        match Self::try_open(&path) {
            Ok(db) => return Ok(db),
            Err(error) => {
                if path.as_os_str().is_empty() || path == PathBuf::from(":memory:") {
                    return Err(error);
                }
                // 数据库版本不兼容等逻辑错误不自动恢复
                if error.contains("高于应用支持版本") {
                    return Err(error);
                }
                // 损坏或无法打开的文件：备份后重建
                if path.exists() {
                    if path.is_file() {
                        let backup = path.with_extension(format!("db.backup-{}", now()));
                        let _ = fs::copy(&path, &backup);
                        let _ = fs::remove_file(&path);
                    } else {
                        let _ = fs::remove_dir_all(&path);
                    }
                }
                Self::try_open(&path)
            }
        }
    }

    fn try_open(path: &PathBuf) -> Result<Self, String> {
        let connection = Connection::open(path).map_err(|error| error.to_string())?;
        connection
            .execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
            .map_err(|error| error.to_string())?;

        let current_version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|error| error.to_string())?;

        if current_version > SCHEMA_VERSION {
            return Err(format!(
                "数据库版本 {} 高于应用支持版本 {}",
                current_version, SCHEMA_VERSION
            ));
        }

        if current_version < SCHEMA_VERSION {
            let pending: Vec<&Migration> = MIGRATIONS
                .iter()
                .filter(|m| m.version > current_version)
                .collect();

            if !pending.is_empty() {
                connection
                    .execute_batch("BEGIN TRANSACTION")
                    .map_err(|error| error.to_string())?;

                let result = (|| -> Result<(), String> {
                    for migration in &pending {
                        connection
                            .execute_batch(migration.up)
                            .map_err(|error| error.to_string())?;
                        connection
                            .pragma_update(None, "user_version", migration.version)
                            .map_err(|error| error.to_string())?;
                    }
                    Ok(())
                })();

                match result {
                    Ok(()) => {
                        connection
                            .execute_batch("COMMIT")
                            .map_err(|error| error.to_string())?;
                    }
                    Err(error) => {
                        connection
                            .execute_batch("ROLLBACK")
                            .map_err(|error| error.to_string())?;
                        return Err(error);
                    }
                }
            }
        }

        Ok(Self { connection })
    }

    // ==================== 历史记录 CRUD ====================

    pub fn add_history(&mut self, item: &Value) -> Result<(), String> {
        let site_key = required_text(item, "siteKey")?;
        let vod_id = required_text(item, "vodId")?;
        let vod_name = required_text(item, "vodName")?;
        let now = now();
        self.connection
            .execute(
                "
                INSERT INTO history
                  (siteKey, vodId, vodName, vodPic, vodRemarks, type, source, progress,
                   episodeId, episodeName, episodeIndex, sourceIndex, sourceName, urlIdentifier,
                   duration, positionSeconds, completed, createTime, updateTime)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?18)
                ON CONFLICT(siteKey, vodId) DO UPDATE SET
                  vodName = excluded.vodName,
                  vodPic = excluded.vodPic,
                  vodRemarks = excluded.vodRemarks,
                  type = excluded.type,
                  source = excluded.source,
                  progress = excluded.progress,
                  episodeId = excluded.episodeId,
                  episodeName = excluded.episodeName,
                  episodeIndex = excluded.episodeIndex,
                  sourceIndex = excluded.sourceIndex,
                  sourceName = excluded.sourceName,
                  urlIdentifier = excluded.urlIdentifier,
                  duration = excluded.duration,
                  positionSeconds = excluded.positionSeconds,
                  completed = excluded.completed,
                  updateTime = excluded.updateTime
                ",
                params![
                    site_key,
                    vod_id,
                    vod_name,
                    optional_text(item, "vodPic"),
                    optional_text(item, "vodRemarks"),
                    optional_i64(item, "type"),
                    optional_text(item, "source"),
                    optional_i64(item, "progress"),
                    optional_text(item, "episodeId"),
                    optional_text(item, "episodeName"),
                    optional_i64(item, "episodeIndex"),
                    optional_i64(item, "sourceIndex"),
                    optional_text(item, "sourceName"),
                    optional_text(item, "urlIdentifier"),
                    optional_i64(item, "duration"),
                    optional_i64(item, "positionSeconds"),
                    optional_bool_i64(item, "completed"),
                    now
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn history_list(&self, limit: i64, offset: i64) -> Result<Value, String> {
        self.list(
            "SELECT id, siteKey, vodId, vodName, vodPic, vodRemarks, type, source, progress,
                    episodeId, episodeName, episodeIndex, sourceIndex, sourceName, urlIdentifier,
                    duration, positionSeconds, completed, createTime, updateTime
             FROM history ORDER BY updateTime DESC LIMIT ?1 OFFSET ?2",
            limit,
            offset,
            history_row,
        )
    }

    pub fn delete_history(&mut self, site_key: &str, vod_id: &str) -> Result<(), String> {
        self.connection
            .execute(
                "DELETE FROM history WHERE siteKey = ?1 AND vodId = ?2",
                params![site_key, vod_id],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    // ==================== 收藏 CRUD ====================

    pub fn add_keep(&mut self, item: &Value) -> Result<(), String> {
        let site_key = required_text(item, "siteKey")?;
        let vod_id = required_text(item, "vodId")?;
        let vod_name = required_text(item, "vodName")?;
        let now = now();
        self.connection
            .execute(
                "
                INSERT INTO keep
                  (siteKey, vodId, vodName, vodPic, vodRemarks, type, source, createTime, updateTime)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
                ON CONFLICT(siteKey, vodId) DO UPDATE SET
                  vodName = excluded.vodName,
                  vodPic = excluded.vodPic,
                  vodRemarks = excluded.vodRemarks,
                  type = excluded.type,
                  source = excluded.source,
                  updateTime = excluded.updateTime
                ",
                params![
                    site_key,
                    vod_id,
                    vod_name,
                    optional_text(item, "vodPic"),
                    optional_text(item, "vodRemarks"),
                    optional_i64(item, "type"),
                    optional_text(item, "source"),
                    now
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn keep_list(&self, limit: i64, offset: i64) -> Result<Value, String> {
        self.list(
            "SELECT id, siteKey, vodId, vodName, vodPic, vodRemarks, type, source, createTime, updateTime
             FROM keep ORDER BY updateTime DESC LIMIT ?1 OFFSET ?2",
            limit,
            offset,
            keep_row,
        )
    }

    pub fn delete_keep(&mut self, site_key: &str, vod_id: &str) -> Result<(), String> {
        self.connection
            .execute(
                "DELETE FROM keep WHERE siteKey = ?1 AND vodId = ?2",
                params![site_key, vod_id],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    // ==================== 缓存 CRUD ====================

    pub fn get_cache(&self, key: &str) -> Result<Value, String> {
        let result =
            self.connection
                .query_row("SELECT value FROM cache WHERE key = ?1", [key], |row| {
                    row.get::<_, String>(0)
                });
        match result {
            Ok(value) => Ok(Value::String(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(Value::Null),
            Err(error) => Err(error.to_string()),
        }
    }

    pub fn set_cache(&mut self, key: &str, value: &str) -> Result<(), String> {
        self.connection
            .execute(
                "INSERT INTO cache (key, value, createTime) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, createTime = excluded.createTime",
                params![key, value, now()],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn delete_cache(&mut self, key: &str) -> Result<(), String> {
        self.connection
            .execute("DELETE FROM cache WHERE key = ?1", [key])
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    // ==================== 直播频道 CRUD ====================

    #[allow(dead_code)]
    pub fn save_live_channels(&mut self, channels: &[Value]) -> Result<(), String> {
        let now = now();

        let tx = self
            .connection
            .transaction()
            .map_err(|error| error.to_string())?;

        let result = (|| -> Result<(), String> {
            tx.execute("DELETE FROM live_channels", [])
                .map_err(|error| error.to_string())?;

            let mut stmt = tx
                .prepare(
                    "INSERT INTO live_channels
                       (name, urls, best_url, country, category, sort_order, latency, original_groups, last_test_time, is_alive)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                )
                .map_err(|error| error.to_string())?;

            for ch in channels {
                let name = required_text(ch, "name")?;
                let urls = ch.get("urls").map(json_to_string).unwrap_or_default();
                let best_url = optional_text(ch, "bestUrl");
                let country = optional_text(ch, "country");
                let category = optional_text(ch, "category");
                let sort_order = optional_f64(ch, "sortOrder");
                let latency = optional_i64(ch, "latency");
                let original_groups = ch
                    .get("originalGroups")
                    .map(json_to_string)
                    .unwrap_or_default();
                let is_alive = optional_i64(ch, "isAlive");

                stmt.execute(params![
                    name,
                    urls,
                    best_url,
                    country,
                    category,
                    sort_order,
                    latency,
                    original_groups,
                    now,
                    if is_alive == 0 { 0 } else { 1 },
                ])
                .map_err(|error| error.to_string())?;
            }

            Ok(())
        })();

        match result {
            Ok(()) => tx.commit().map_err(|error| error.to_string()),
            Err(error) => {
                tx.rollback().map_err(|error| error.to_string())?;
                Err(error)
            }
        }
    }

    pub fn get_live_tree(&self) -> Result<Value, String> {
        let sql = "SELECT id, name, urls, best_url, country, category, sort_order, latency, original_groups, last_test_time, is_alive
                   FROM live_channels WHERE is_alive = 1
                   ORDER BY country, category, sort_order, name";
        let mut stmt = self
            .connection
            .prepare(sql)
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map([], live_channel_row)
            .map_err(|error| error.to_string())?;

        let channels: Vec<Value> = rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?;

        Ok(Value::Array(channels))
    }

    pub fn update_refresh_status(&mut self, status: &Value) -> Result<(), String> {
        let mut parts: Vec<String> = Vec::new();
        let mut param_values: Vec<rusqlite::types::Value> = Vec::new();

        if let Some(value) = status.get("lastRefreshTime").and_then(Value::as_i64) {
            parts.push("last_refresh_time = ?".to_string());
            param_values.push(rusqlite::types::Value::Integer(value));
        }
        if let Some(value) = status.get("nextRefreshTime").and_then(Value::as_i64) {
            parts.push("next_refresh_time = ?".to_string());
            param_values.push(rusqlite::types::Value::Integer(value));
        }
        if let Some(value) = status.get("refreshIntervalMinutes").and_then(Value::as_i64) {
            parts.push("refresh_interval_minutes = ?".to_string());
            param_values.push(rusqlite::types::Value::Integer(value));
        }
        if let Some(value) = status.get("totalChannels").and_then(Value::as_i64) {
            parts.push("total_channels = ?".to_string());
            param_values.push(rusqlite::types::Value::Integer(value));
        }
        if let Some(value) = status.get("aliveChannels").and_then(Value::as_i64) {
            parts.push("alive_channels = ?".to_string());
            param_values.push(rusqlite::types::Value::Integer(value));
        }
        if let Some(value) = status.get("status").and_then(Value::as_str) {
            parts.push("status = ?".to_string());
            param_values.push(rusqlite::types::Value::Text(value.to_owned()));
        }

        if parts.is_empty() {
            return Ok(());
        }

        let sql = format!(
            "UPDATE live_refresh_status SET {} WHERE id = 1",
            parts.join(", ")
        );

        self.connection
            .execute(&sql, rusqlite::params_from_iter(param_values.iter()))
            .map_err(|error| error.to_string())?;

        Ok(())
    }

    pub fn get_refresh_status(&self) -> Result<Value, String> {
        let result = self.connection.query_row(
            "SELECT id, last_refresh_time, next_refresh_time, refresh_interval_minutes,
                    total_channels, alive_channels, status
             FROM live_refresh_status WHERE id = 1",
            [],
            refresh_status_row,
        );
        match result {
            Ok(value) => Ok(value),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(Value::Null),
            Err(error) => Err(error.to_string()),
        }
    }

    // ==================== 内部辅助 ====================

    fn list(
        &self,
        sql: &str,
        limit: i64,
        offset: i64,
        map: fn(&Row<'_>) -> rusqlite::Result<Value>,
    ) -> Result<Value, String> {
        let mut statement = self
            .connection
            .prepare(sql)
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![limit.clamp(1, 500), offset.max(0)], map)
            .map_err(|error| error.to_string())?;
        let values = rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?;
        Ok(Value::Array(values))
    }
}

// ==================== Row mappers ====================

fn history_row(row: &Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, i64>(0)?,
        "siteKey": row.get::<_, String>(1)?,
        "vodId": row.get::<_, String>(2)?,
        "vodName": row.get::<_, String>(3)?,
        "vodPic": row.get::<_, String>(4)?,
        "vodRemarks": row.get::<_, String>(5)?,
        "type": row.get::<_, i64>(6)?,
        "source": row.get::<_, String>(7)?,
        "progress": row.get::<_, i64>(8)?,
        "episodeId": row.get::<_, String>(9)?,
        "episodeName": row.get::<_, String>(10)?,
        "episodeIndex": row.get::<_, i64>(11)?,
        "sourceIndex": row.get::<_, i64>(12)?,
        "sourceName": row.get::<_, String>(13)?,
        "urlIdentifier": row.get::<_, String>(14)?,
        "duration": row.get::<_, i64>(15)?,
        "positionSeconds": row.get::<_, i64>(16)?,
        "completed": row.get::<_, i64>(17)? == 1,
        "createTime": row.get::<_, i64>(18)?,
        "updateTime": row.get::<_, i64>(19)?
    }))
}

fn keep_row(row: &Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, i64>(0)?,
        "siteKey": row.get::<_, String>(1)?,
        "vodId": row.get::<_, String>(2)?,
        "vodName": row.get::<_, String>(3)?,
        "vodPic": row.get::<_, String>(4)?,
        "vodRemarks": row.get::<_, String>(5)?,
        "type": row.get::<_, i64>(6)?,
        "source": row.get::<_, String>(7)?,
        "createTime": row.get::<_, i64>(8)?,
        "updateTime": row.get::<_, i64>(9)?
    }))
}

fn live_channel_row(row: &Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, i64>(0)?,
        "name": row.get::<_, String>(1)?,
        "urls": row.get::<_, String>(2)?,
        "best_url": row.get::<_, String>(3)?,
        "country": row.get::<_, String>(4)?,
        "category": row.get::<_, String>(5)?,
        "sort_order": row.get::<_, f64>(6)?,
        "latency": row.get::<_, i64>(7)?,
        "original_groups": row.get::<_, String>(8)?,
        "last_test_time": row.get::<_, i64>(9)?,
        "is_alive": row.get::<_, i64>(10)?
    }))
}

fn refresh_status_row(row: &Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, i64>(0)?,
        "last_refresh_time": row.get::<_, Option<i64>>(1)?,
        "next_refresh_time": row.get::<_, Option<i64>>(2)?,
        "refresh_interval_minutes": row.get::<_, i64>(3)?,
        "total_channels": row.get::<_, i64>(4)?,
        "alive_channels": row.get::<_, i64>(5)?,
        "status": row.get::<_, String>(6)?
    }))
}

// ==================== 值提取辅助 ====================

fn required_text<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| format!("invalid field: {key}"))
}

fn optional_text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}

fn optional_i64(value: &Value, key: &str) -> i64 {
    value.get(key).and_then(Value::as_i64).unwrap_or(0)
}

fn optional_bool_i64(value: &Value, key: &str) -> i64 {
    match value.get(key) {
        Some(Value::Bool(true)) => 1,
        Some(Value::Number(number)) if number.as_i64().unwrap_or(0) != 0 => 1,
        _ => 0,
    }
}

#[allow(dead_code)]
fn optional_f64(value: &Value, key: &str) -> f64 {
    value.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

#[allow(dead_code)]
fn json_to_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::Database;
    use serde_json::json;
    use std::path::PathBuf;

    fn database() -> Database {
        Database::open(":memory:".into()).expect("open in-memory database")
    }

    #[test]
    fn schema_version_is_current() {
        let mut db = database();
        db.save_live_channels(&[]).unwrap();
        let status = db.get_refresh_status().unwrap();
        assert_eq!(status["status"], "idle");
    }

    #[test]
    fn history_upsert_preserves_one_composite_key() {
        let mut db = database();
        db.add_history(&json!({
            "siteKey": "site-a",
            "vodId": "vod-1",
            "vodName": "First",
            "progress": 10
        }))
        .unwrap();
        db.add_history(&json!({
            "siteKey": "site-a",
            "vodId": "vod-1",
            "vodName": "Updated",
            "progress": 35,
            "episodeId": "2",
            "episodeName": "第 2 集",
            "episodeIndex": 1,
            "sourceIndex": 2,
            "sourceName": "高清",
            "urlIdentifier": "abc123",
            "duration": 1800,
            "positionSeconds": 630,
            "completed": false
        }))
        .unwrap();

        let rows = db.history_list(50, 0).unwrap();
        assert_eq!(rows.as_array().unwrap().len(), 1);
        assert_eq!(rows[0]["vodName"], "Updated");
        assert_eq!(rows[0]["progress"], 35);
        assert_eq!(rows[0]["episodeName"], "第 2 集");
        assert_eq!(rows[0]["episodeIndex"], 1);
        assert_eq!(rows[0]["sourceIndex"], 2);
        assert_eq!(rows[0]["positionSeconds"], 630);
        assert_eq!(rows[0]["completed"], false);
    }

    #[test]
    fn keep_and_cache_round_trip() {
        let mut db = database();
        db.add_keep(&json!({
            "siteKey": "site-a",
            "vodId": "vod-2",
            "vodName": "Favorite"
        }))
        .unwrap();
        db.set_cache("search", "[\"news\"]").unwrap();

        assert_eq!(db.keep_list(50, 0).unwrap().as_array().unwrap().len(), 1);
        assert_eq!(db.get_cache("search").unwrap(), "[\"news\"]");
    }

    #[test]
    fn live_channels_save_and_get_tree() {
        let mut db = database();
        let channels = vec![
            json!({
                "name": "CCTV-1",
                "urls": ["http://example.com/1.m3u8"],
                "bestUrl": "http://example.com/1.m3u8",
                "country": "China",
                "category": "CCTV",
                "sortOrder": 1.0,
                "latency": 100,
                "originalGroups": ["CCTV"],
                "isAlive": 1
            }),
            json!({
                "name": "BBC World",
                "urls": ["http://example.com/bbc.m3u8"],
                "bestUrl": "http://example.com/bbc.m3u8",
                "country": "UK",
                "category": "News",
                "sortOrder": 0.0,
                "latency": 200,
                "originalGroups": ["News"],
                "isAlive": 1
            }),
        ];

        db.save_live_channels(&channels).unwrap();
        let tree = db.get_live_tree().unwrap();
        let list = tree.as_array().unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0]["country"], "China");
        assert_eq!(list[1]["country"], "UK");
    }

    #[test]
    fn live_channels_dead_channel_excluded() {
        let mut db = database();
        let channels = vec![json!({
            "name": "Dead Channel",
            "urls": [],
            "bestUrl": "",
            "country": "Test",
            "category": "Test",
            "sortOrder": 0.0,
            "latency": -1,
            "originalGroups": [],
            "isAlive": 0
        })];

        db.save_live_channels(&channels).unwrap();
        let tree = db.get_live_tree().unwrap();
        assert!(tree.as_array().unwrap().is_empty());
    }

    #[test]
    fn refresh_status_defaults() {
        let db = database();
        let status = db.get_refresh_status().unwrap();
        assert_eq!(status["status"], "idle");
        assert_eq!(status["refresh_interval_minutes"], 30);
    }

    #[test]
    fn update_refresh_status_partial() {
        let mut db = database();
        db.update_refresh_status(&json!({
            "status": "refreshing",
            "totalChannels": 100,
            "aliveChannels": 80
        }))
        .unwrap();

        let status = db.get_refresh_status().unwrap();
        assert_eq!(status["status"], "refreshing");
        assert_eq!(status["total_channels"], 100);
        assert_eq!(status["alive_channels"], 80);
        assert_eq!(status["refresh_interval_minutes"], 30);
    }

    #[test]
    fn migration_from_v1_adds_live_tables() {
        let dir = std::env::temp_dir().join("iptv-mig-test-v1");
        let _ = std::fs::remove_file(&dir);
        let path = dir.to_string_lossy().to_string() + ".db";

        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS history (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              siteKey TEXT NOT NULL,
              vodId TEXT NOT NULL,
              vodName TEXT NOT NULL,
              UNIQUE(siteKey, vodId)
            );
            CREATE TABLE IF NOT EXISTS keep (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              siteKey TEXT NOT NULL,
              vodId TEXT NOT NULL,
              vodName TEXT NOT NULL,
              UNIQUE(siteKey, vodId)
            );
            CREATE TABLE IF NOT EXISTS cache (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL DEFAULT '',
              createTime INTEGER NOT NULL DEFAULT 0
            );
            PRAGMA user_version = 1;",
        )
        .unwrap();
        drop(conn);

        let db = Database::open(PathBuf::from(&path)).unwrap();
        let status = db.get_refresh_status().unwrap();
        assert_eq!(status["status"], "idle");

        let mut db = Database::open(PathBuf::from(&path)).unwrap();
        db.save_live_channels(&[]).unwrap();
        let tree = db.get_live_tree().unwrap();
        assert!(tree.as_array().unwrap().is_empty());

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn migration_from_v2_adds_resume_history_columns() {
        let dir = std::env::temp_dir().join("iptv-mig-test-v2");
        let _ = std::fs::remove_file(&dir);
        let path = dir.to_string_lossy().to_string() + ".db";

        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS history (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              siteKey TEXT NOT NULL,
              vodId TEXT NOT NULL,
              vodName TEXT NOT NULL,
              vodPic TEXT DEFAULT '',
              vodRemarks TEXT DEFAULT '',
              type INTEGER DEFAULT 0,
              source TEXT DEFAULT '',
              progress INTEGER DEFAULT 0,
              createTime INTEGER NOT NULL DEFAULT 0,
              updateTime INTEGER NOT NULL DEFAULT 0,
              UNIQUE(siteKey, vodId)
            );
            CREATE INDEX IF NOT EXISTS idx_history_update ON history(updateTime DESC);
            CREATE TABLE IF NOT EXISTS keep (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              siteKey TEXT NOT NULL,
              vodId TEXT NOT NULL,
              vodName TEXT NOT NULL,
              vodPic TEXT DEFAULT '',
              vodRemarks TEXT DEFAULT '',
              type INTEGER DEFAULT 0,
              source TEXT DEFAULT '',
              createTime INTEGER NOT NULL DEFAULT 0,
              updateTime INTEGER NOT NULL DEFAULT 0,
              UNIQUE(siteKey, vodId)
            );
            CREATE TABLE IF NOT EXISTS cache (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL DEFAULT '',
              createTime INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS live_channels (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              urls TEXT NOT NULL,
              best_url TEXT NOT NULL,
              country TEXT NOT NULL,
              category TEXT NOT NULL,
              sort_order REAL DEFAULT 0,
              latency INTEGER DEFAULT -2,
              original_groups TEXT,
              last_test_time INTEGER NOT NULL,
              is_alive INTEGER DEFAULT 1,
              UNIQUE(name, country, category)
            );
            CREATE TABLE IF NOT EXISTS live_refresh_status (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              status TEXT DEFAULT 'idle'
            );
            INSERT INTO history (siteKey, vodId, vodName, progress, createTime, updateTime)
              VALUES ('site-a', 'vod-1', 'Legacy', 12, 1, 1);
            PRAGMA user_version = 2;",
        )
        .unwrap();
        drop(conn);

        let db = Database::open(PathBuf::from(&path)).unwrap();
        let rows = db.history_list(50, 0).unwrap();
        assert_eq!(rows[0]["vodName"], "Legacy");
        assert_eq!(rows[0]["episodeIndex"], 0);
        assert_eq!(rows[0]["positionSeconds"], 0);
        assert_eq!(rows[0]["completed"], false);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn corrupt_database_creates_backup_and_new_db() {
        let dir = std::env::temp_dir().join("iptv-corrupt-test-dir");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("iptv.db");

        // 创建一个文件阻塞数据库路径（目录），让 Connection::open 失败
        std::fs::write(&path, "some data").unwrap();
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();

        // open 应删除阻塞路径并创建新的数据库
        let db = Database::open(path.clone()).unwrap();
        let status = db.get_refresh_status().unwrap();
        assert_eq!(status["status"], "idle");
        // 路径现在是有效的数据库文件
        assert!(path.is_file());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_future_schema_version() {
        let dir = std::env::temp_dir().join("iptv-reject-test");
        let _ = std::fs::remove_file(&dir);
        let path = dir.to_string_lossy().to_string() + ".db";

        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.pragma_update(None, "user_version", 99).unwrap();
        drop(conn);

        let result = Database::open(PathBuf::from(&path));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("高于应用支持版本"));

        let _ = std::fs::remove_file(&path);
    }
}
