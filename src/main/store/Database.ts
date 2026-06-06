/**
 * SQLite 数据库管理
 * 使用 sql.js 实现本地数据持久化（纯 JS，无需原生编译）
 * 存储：历史记录、收藏、缓存
 */
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'

let db: SqlJsDatabase | null = null
let dbPath: string = ''

/** 获取可写数据目录（自动回退） */
function getWritableDataDir(): string {
  let dir = app.getPath('userData')
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const testFile = join(dir, '.write-test')
    writeFileSync(testFile, 'test')
    unlinkSync(testFile)
    return dir
  } catch {
    // 回退到项目目录下的 data 文件夹
    dir = join(process.cwd(), 'data')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }
}

/** 获取数据库实例（单例） */
export async function getDatabase(): Promise<SqlJsDatabase> {
  if (db) return db

  const SQL = await initSqlJs()
  dbPath = join(getWritableDataDir(), 'iptv.db')

  // 如果数据库文件存在则加载，否则创建新的
  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  initTables(db)
  return db
}

/** 保存数据库到磁盘 */
export function saveDatabase(): void {
  if (db && dbPath) {
    const data = db.export()
    const buffer = Buffer.from(data)
    writeFileSync(dbPath, buffer)
  }
}

/** 初始化数据表 */
function initTables(database: SqlJsDatabase): void {
  database.run(`
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
      updateTime INTEGER NOT NULL DEFAULT 0
    )
  `)

  database.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_history_site_vod
    ON history(siteKey, vodId)
  `)
  database.run(`
    CREATE INDEX IF NOT EXISTS idx_history_update
    ON history(updateTime DESC)
  `)

  database.run(`
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
      updateTime INTEGER NOT NULL DEFAULT 0
    )
  `)

  database.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_keep_site_vod
    ON keep(siteKey, vodId)
  `)
  database.run(`
    CREATE INDEX IF NOT EXISTS idx_keep_update
    ON keep(updateTime DESC)
  `)

  database.run(`
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      createTime INTEGER NOT NULL DEFAULT 0
    )
  `)

  database.run(`
    CREATE INDEX IF NOT EXISTS idx_cache_key
    ON cache(key)
  `)

  // 直播频道表
  database.run(`
    CREATE TABLE IF NOT EXISTS live_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      urls TEXT NOT NULL,
      best_url TEXT NOT NULL,
      country TEXT NOT NULL,
      category TEXT NOT NULL,
      sort_order REAL DEFAULT 0,
      latency INTEGER DEFAULT -1,
      original_groups TEXT,
      last_test_time INTEGER NOT NULL,
      is_alive INTEGER DEFAULT 1,
      UNIQUE(name, country, category)
    )
  `)

  database.run(`
    CREATE INDEX IF NOT EXISTS idx_live_channels_country_category
    ON live_channels(country, category, sort_order)
  `)

  database.run(`
    CREATE INDEX IF NOT EXISTS idx_live_channels_alive
    ON live_channels(is_alive)
  `)

  // 刷新状态表
  database.run(`
    CREATE TABLE IF NOT EXISTS live_refresh_status (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_refresh_time INTEGER,
      next_refresh_time INTEGER,
      refresh_interval_minutes INTEGER DEFAULT 30,
      total_channels INTEGER DEFAULT 0,
      alive_channels INTEGER DEFAULT 0,
      status TEXT DEFAULT 'idle'
    )
  `)

  // 初始化默认状态
  database.run(`
    INSERT OR IGNORE INTO live_refresh_status (id, status, refresh_interval_minutes)
    VALUES (1, 'idle', 30)
  `)

  saveDatabase()
}

/** 关闭数据库连接 */
export function closeDatabase(): void {
  if (db) {
    saveDatabase()
    db.close()
    db = null
  }
}

// ==================== 历史记录 CRUD ====================

/** 添加或更新观看历史 */
export async function addHistory(item: {
  siteKey: string
  vodId: string
  vodName: string
  vodPic?: string
  vodRemarks?: string
  type?: number
  source?: string
  progress?: number
}): Promise<void> {
  const database = await getDatabase()
  const now = Math.floor(Date.now() / 1000)

  database.run(
    `INSERT OR REPLACE INTO history (siteKey, vodId, vodName, vodPic, vodRemarks, type, source, progress, createTime, updateTime)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 
       COALESCE((SELECT createTime FROM history WHERE siteKey = ? AND vodId = ?), ?), ?)`,
    [
      item.siteKey ?? '', item.vodId ?? '', item.vodName ?? '', item.vodPic ?? '',
      item.vodRemarks ?? '', item.type ?? 0, item.source ?? '', item.progress ?? 0,
      item.siteKey ?? '', item.vodId ?? '', now, now
    ]
  )
  saveDatabase()
}

/** 获取观看历史列表 */
export async function getHistoryList(limit = 50, offset = 0): Promise<any[]> {
  const database = await getDatabase()
  const stmt = database.prepare(
    'SELECT * FROM history ORDER BY updateTime DESC LIMIT ? OFFSET ?'
  )
  stmt.bind([limit, offset])
  const results: any[] = []
  while (stmt.step()) {
    results.push(stmt.getAsObject())
  }
  stmt.free()
  return results
}

/** 删除指定观看历史 */
export async function deleteHistory(siteKey: string, vodId: string): Promise<void> {
  const database = await getDatabase()
  database.run('DELETE FROM history WHERE siteKey = ? AND vodId = ?', [siteKey, vodId])
  saveDatabase()
}

/** 清空所有观看历史 */
export async function clearHistory(): Promise<void> {
  const database = await getDatabase()
  database.run('DELETE FROM history')
  saveDatabase()
}

// ==================== 收藏 CRUD ====================

/** 添加或更新收藏 */
export async function addKeep(item: {
  siteKey: string
  vodId: string
  vodName: string
  vodPic?: string
  vodRemarks?: string
  type?: number
  source?: string
}): Promise<void> {
  const database = await getDatabase()
  const now = Math.floor(Date.now() / 1000)

  database.run(
    `INSERT OR REPLACE INTO keep (siteKey, vodId, vodName, vodPic, vodRemarks, type, source, createTime, updateTime)
     VALUES (?, ?, ?, ?, ?, ?, ?, 
       COALESCE((SELECT createTime FROM keep WHERE siteKey = ? AND vodId = ?), ?), ?)`,
    [
      item.siteKey ?? '', item.vodId ?? '', item.vodName ?? '', item.vodPic ?? '',
      item.vodRemarks ?? '', item.type ?? 0, item.source ?? '',
      item.siteKey ?? '', item.vodId ?? '', now, now
    ]
  )
  saveDatabase()
}

/** 获取收藏列表 */
export async function getKeepList(limit = 50, offset = 0): Promise<any[]> {
  const database = await getDatabase()
  const stmt = database.prepare(
    'SELECT * FROM keep ORDER BY updateTime DESC LIMIT ? OFFSET ?'
  )
  stmt.bind([limit, offset])
  const results: any[] = []
  while (stmt.step()) {
    results.push(stmt.getAsObject())
  }
  stmt.free()
  return results
}

/** 删除指定收藏 */
export async function deleteKeep(siteKey: string, vodId: string): Promise<void> {
  const database = await getDatabase()
  database.run('DELETE FROM keep WHERE siteKey = ? AND vodId = ?', [siteKey, vodId])
  saveDatabase()
}

/** 清空所有收藏 */
export async function clearKeep(): Promise<void> {
  const database = await getDatabase()
  database.run('DELETE FROM keep')
  saveDatabase()
}

// ==================== 缓存 CRUD ====================

/** 获取缓存值 */
export async function getCache(key: string): Promise<string> {
  const database = await getDatabase()
  const stmt = database.prepare('SELECT value FROM cache WHERE key = ?')
  stmt.bind([key])
  let value = ''
  if (stmt.step()) {
    const row = stmt.getAsObject()
    value = (row as any).value?.toString() ?? ''
  }
  stmt.free()
  return value
}

/** 设置缓存值 */
export async function setCache(key: string, value: string): Promise<void> {
  const database = await getDatabase()
  const now = Math.floor(Date.now() / 1000)
  database.run(
    'INSERT OR REPLACE INTO cache (key, value, createTime) VALUES (?, ?, ?)',
    [key ?? '', value ?? '', now]
  )
  saveDatabase()
}

/** 删除缓存值 */
export async function deleteCache(key: string): Promise<void> {
  const database = await getDatabase()
  database.run('DELETE FROM cache WHERE key = ?', [key])
  saveDatabase()
}

/** 按前缀删除缓存 */
export async function deleteCacheByPrefix(prefix: string): Promise<void> {
  const database = await getDatabase()
  database.run("DELETE FROM cache WHERE key LIKE ? || '%'", [prefix])
  saveDatabase()
}

/** 清空所有缓存 */
export async function clearCache(): Promise<void> {
  const database = await getDatabase()
  database.run('DELETE FROM cache')
  saveDatabase()
}

// ==================== 直播频道 CRUD ====================

/** 批量保存直播频道（先清空再插入） */
export async function saveLiveChannels(channels: {
  name: string
  urls: string[]
  bestUrl: string
  country: string
  category: string
  sortOrder: number
  latency: number
  originalGroups: string[]
}[]): Promise<void> {
  const database = await getDatabase()
  const now = Math.floor(Date.now() / 1000)

  database.run('DELETE FROM live_channels')

  const stmt = database.prepare(
    `INSERT INTO live_channels (name, urls, best_url, country, category, sort_order, latency, original_groups, last_test_time, is_alive)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  for (const ch of channels) {
    stmt.run([
      ch.name,
      JSON.stringify(ch.urls),
      ch.bestUrl,
      ch.country,
      ch.category,
      ch.sortOrder,
      ch.latency,
      JSON.stringify(ch.originalGroups),
      now,
      1
    ])
  }

  stmt.free()
  saveDatabase()
}

/** 获取直播树 */
export async function getLiveTree(): Promise<any[]> {
  const database = await getDatabase()
  const stmt = database.prepare(
    `SELECT * FROM live_channels WHERE is_alive = 1 ORDER BY country, category, sort_order, name`
  )
  const results: any[] = []
  while (stmt.step()) {
    results.push(stmt.getAsObject())
  }
  stmt.free()
  return results
}

/** 更新刷新状态 */
export async function updateRefreshStatus(status: {
  lastRefreshTime?: number
  nextRefreshTime?: number
  refreshIntervalMinutes?: number
  totalChannels?: number
  aliveChannels?: number
  status?: string
}): Promise<void> {
  const database = await getDatabase()

  const fields: string[] = []
  const values: any[] = []

  if (status.lastRefreshTime !== undefined) {
    fields.push('last_refresh_time = ?')
    values.push(status.lastRefreshTime)
  }
  if (status.nextRefreshTime !== undefined) {
    fields.push('next_refresh_time = ?')
    values.push(status.nextRefreshTime)
  }
  if (status.refreshIntervalMinutes !== undefined) {
    fields.push('refresh_interval_minutes = ?')
    values.push(status.refreshIntervalMinutes)
  }
  if (status.totalChannels !== undefined) {
    fields.push('total_channels = ?')
    values.push(status.totalChannels)
  }
  if (status.aliveChannels !== undefined) {
    fields.push('alive_channels = ?')
    values.push(status.aliveChannels)
  }
  if (status.status !== undefined) {
    fields.push('status = ?')
    values.push(status.status)
  }

  if (fields.length > 0) {
    database.run(
      `UPDATE live_refresh_status SET ${fields.join(', ')} WHERE id = 1`,
      values
    )
    saveDatabase()
  }
}

/** 获取刷新状态 */
export async function getRefreshStatus(): Promise<any> {
  const database = await getDatabase()
  const stmt = database.prepare('SELECT * FROM live_refresh_status WHERE id = 1')
  let result: any = null
  if (stmt.step()) {
    result = stmt.getAsObject()
  }
  stmt.free()
  return result
}
