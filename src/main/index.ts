/**
 * IPTV Mac 主进程入口
 * 创建 BrowserWindow、设置 IPC handlers、启动本地服务器
 */
import { app, BrowserWindow, ipcMain, shell, session } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, appendFileSync } from 'fs'

// 设置自定义 userData 路径，避免与 Chromium 冲突
app.setPath('userData', join(app.getPath('appData'), 'mac-tv'))

// ==================== 文件日志（方便排查用户问题）====================
const LOG_DIR = join(process.cwd(), 'logs')
try {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })
} catch {}
const LOG_FILE = join(LOG_DIR, `iptv-${new Date().toISOString().slice(0, 10)}.log`)

const _origLog = console.log
const _origWarn = console.warn
const _origError = console.error
function writeLog(level: string, args: any[]) {
  const line = `[${new Date().toISOString()}] [${level}] ${args.map((a) => {
    if (typeof a === 'string') return a
    if (a instanceof Error) return `${a.message}\n${a.stack}`
    try { return JSON.stringify(a) } catch { return String(a) }
  }).join(' ')}\n`
  try { appendFileSync(LOG_FILE, line) } catch {}
}
console.log = (...args: any[]) => { _origLog(...args); writeLog('INFO', args) }
console.warn = (...args: any[]) => { _origWarn(...args); writeLog('WARN', args) }
console.error = (...args: any[]) => { _origError(...args); writeLog('ERROR', args) }
_origLog(`[Main] 日志文件: ${LOG_FILE}`)

import { startLocalServer, getServerPort, updateMediaState } from './server/LocalServer'
import { applyNetworkConfig } from './network/NetworkStack'
import type { Result } from '../shared/types'
import {
  addHistory,
  getHistoryList,
  deleteHistory,
  addKeep,
  getKeepList,
  deleteKeep,
  getCache,
  setCache,
  deleteCache,
  closeDatabase
} from './store/Database'
import {
  switchConfig,
  getCurrentConfig,
  getCurrentUrl,
  getConfigList,
  addConfig,
  removeConfig,
  getSiteByKey,
  ensureDefaultConfig
} from './config/ConfigManager'
import { loadVodConfig } from './config/VodConfig'
import { loadSpider, destroyAllSpiders } from './spider/SpiderLoader'
import { loadLiveSource } from './config/LiveConfig'
import { getEpgData, clearEpgCache } from './live/EpgManager'
import { startAutoRefresh, stopAutoRefresh, triggerRefresh, getRefreshStatus, setRefreshInterval } from './live/LiveRefresher'
import { getLiveTree, getRefreshStatus as getDbRefreshStatus } from './store/Database'
import type { LiveTree, CountryNode, CategoryNode, ClassifiedChannel } from '../shared/types'
import { superParse, isVideoFormat, needParse } from './parse/SuperParse'

/** 应用设置存储（延迟初始化路径，自动回退） */
let settingsPath = ''
function getSettingsPath(): string {
  if (!settingsPath) {
    let userDataDir = app.getPath('userData')
    try {
      if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true })
      const testFile = join(userDataDir, '.write-test')
      writeFileSync(testFile, 'test')
      unlinkSync(testFile)
    } catch {
      userDataDir = join(process.cwd(), 'data')
      if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true })
    }
    settingsPath = join(userDataDir, 'settings.json')
  }
  return settingsPath
}
function getSettings(): Record<string, unknown> {
  try {
    const path = getSettingsPath()
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8'))
  } catch { /* ignore */ }
  return {}
}
function saveSettings(data: Record<string, unknown>): void {
  writeFileSync(getSettingsPath(), JSON.stringify(data, null, 2), 'utf-8')
}

/** 主窗口引用 */
let mainWindow: BrowserWindow | null = null

/** 精简模式窗口引用 */
let miniPlayerWindow: BrowserWindow | null = null

/** 当前播放状态（用于传递给精简模式窗口） */
let currentPlayerState: { url: string; header?: Record<string, string>; currentTime?: number } | null = null

/**
 * 创建主窗口
 */
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    show: false,
    backgroundColor: '#1a1a2a',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // 关键修复：禁用后台节流
      // 切换到其他应用时，Chromium 默认会暂停 video 元素、setTimeout 限频 1Hz
      // 这会导致 HLS.js worker 暂停、m3u8 切片下载中断，切回时画面黑屏
      backgroundThrottling: false
    }
  })

  // 窗口准备好后显示
  win.on('ready-to-show', () => {
    win.show()
  })

  // 外部链接在系统浏览器打开
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 渲染进程日志桥接到主进程终端
  win.webContents.on('console-message', (_event, level, message, _line, sourceId) => {
    const prefix = '[Renderer]'
    const src = sourceId ? ` (${sourceId.split('/').pop()})` : ''
    if (level === 3) {
      console.error(`${prefix}${src}`, message)
    } else if (level === 2) {
      console.warn(`${prefix}${src}`, message)
    } else {
      console.log(`${prefix}${src}`, message)
    }
  })

  // 加载渲染进程
  // npx electron . 时 is.dev=true 但没有 dev server，需要判断 ELECTRON_RENDERER_URL 是否存在
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && rendererUrl) {
    console.log('[Main] 使用 dev server:', rendererUrl)
    win.loadURL(rendererUrl)
  } else {
    const htmlPath = join(__dirname, '../renderer/index.html')
    console.log('[Main] 加载本地文件:', htmlPath, 'exists:', existsSync(htmlPath))
    win.loadFile(htmlPath)
  }

  mainWindow = win
  return win
}

/**
 * 创建精简模式窗口
 */
function createMiniPlayerWindow(): BrowserWindow {
  const miniWin = new BrowserWindow({
    width: 480,
    height: 300,
    minWidth: 320,
    minHeight: 200,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    transparent: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 加载同一个 renderer，但带 query 参数 ?mode=mini
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && rendererUrl) {
    miniWin.loadURL(`${rendererUrl}?mode=mini`)
  } else {
    const htmlPath = join(__dirname, '../renderer/index.html')
    miniWin.loadFile(htmlPath, { query: { mode: 'mini' } })
  }

  return miniWin
}

/**
 * 注册所有 IPC handlers
 */
function registerIpcHandlers(): void {
  // ==================== 配置相关 ====================
  ipcMain.handle('config:load', async (_event, url: string, name?: string) => {
    try {
      console.log('[config:load] 渲染进程请求加载配置:', url)
      const config = await switchConfig(url)
      // 确保配置在列表中
      addConfig(url, name || config.sites?.[0]?.name || url)
      // 应用网络配置
      applyNetworkConfig(config)
      const visibleSites = (config.sites || []).filter((s: any) => s.type === 0 || s.type === 1 || s.type === 4)
      console.log('[config:load] 配置加载完成, sites:', config.sites?.length, 'visibleSites:', visibleSites.length, 'lives:', config.lives?.length)
      return { success: true, data: config }
    } catch (err) {
      console.error('[config:load] 失败:', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('config:getCurrent', () => {
    return getCurrentConfig()
  })

  ipcMain.handle('config:getCurrentUrl', () => {
    return getCurrentUrl()
  })

  ipcMain.handle('config:list', () => {
    return getConfigList()
  })

  ipcMain.handle('config:remove', (_event, url: string) => {
    removeConfig(url)
    return { success: true }
  })

  // 预览配置的直播源（不改变当前配置）
  ipcMain.handle('config:peekLives', async (_event, url: string) => {
    try {
      const config = await loadVodConfig(url)
      const lives = config.lives || []
      console.log('[config:peekLives] 配置:', url, '直播源数:', lives.length)
      return { success: true, data: lives }
    } catch (err) {
      console.error('[config:peekLives] 失败:', err)
      return { success: false, error: String(err) }
    }
  })

  // ==================== 站点相关 ====================
  ipcMain.handle(
    'site:probe',
    async (_event, siteKeys: string[]) => {
      // 并行探测多个站点，返回第一个成功的站点 key
      const results = await Promise.allSettled(
        siteKeys.map(async (siteKey) => {
          const site = getSiteByKey(siteKey)
          if (!site) throw new Error('站点不存在')
          const spider = await loadSpider(site)
          const result = await spider.homeContent(true)
          const hasContent = (result.class?.length || 0) > 0 || (result.list?.length || 0) > 0
          if (!hasContent) throw new Error('无内容')
          return { siteKey, result }
        })
      )
      // 找第一个成功的
      for (const r of results) {
        if (r.status === 'fulfilled') {
          console.log('[site:probe] 找到可用站点:', r.value.siteKey)
          return { success: true, data: { siteKey: r.value.siteKey, result: r.value.result } }
        }
      }
      console.log('[site:probe] 所有站点均不可用')
      return { success: false, error: '所有站点均不可用' }
    }
  )

  ipcMain.handle(
    'site:homeContent',
    async (_event, siteKey: string, filter: boolean) => {
      try {
        const site = getSiteByKey(siteKey)
        if (!site) return { success: false, error: '站点不存在' }

        console.log('[site:homeContent] 请求:', siteKey, 'type:', site.type, 'api:', site.api)
        const spider = await loadSpider(site)
        const result = await spider.homeContent(filter)
        console.log('[site:homeContent] 结果:', siteKey, 'class:', result.class?.length, 'list:', result.list?.length, 'filters:', result.filters ? Object.keys(result.filters).length : 0)
        return { success: true, data: result }
      } catch (err) {
        console.error('[site:homeContent] 失败:', siteKey, err)
        return { success: false, error: String(err) }
      }
    }
  )

  ipcMain.handle(
    'site:categoryContent',
    async (
      _event,
      siteKey: string,
      tid: string,
      pg: string,
      filter: boolean,
      extend: Record<string, string>
    ) => {
      try {
        const site = getSiteByKey(siteKey)
        if (!site) return { success: false, error: '站点不存在' }

        const spider = await loadSpider(site)
        const result = await spider.categoryContent(tid, pg, filter, extend)
        return { success: true, data: result }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    }
  )

  ipcMain.handle(
    'site:detailContent',
    async (_event, siteKey: string, ids: string[]) => {
      try {
        const site = getSiteByKey(siteKey)
        if (!site) return { success: false, error: '站点不存在' }

        console.log('[site:detailContent] 请求:', siteKey, 'ids:', ids)
        const spider = await loadSpider(site)
        const result = await spider.detailContent(ids)
        const vod = result.list?.[0]
        console.log('[site:detailContent] 结果:', siteKey, 'vod_name:', vod?.vod_name, 'play_from:', vod?.vod_play_from, 'play_url长度:', vod?.vod_play_url?.length)
        return { success: true, data: result }
      } catch (err) {
        console.error('[site:detailContent] 失败:', siteKey, err)
        return { success: false, error: String(err) }
      }
    }
  )

  ipcMain.handle(
    'site:searchContent',
    async (_event, siteKey: string, key: string, quick: boolean, pg?: string) => {
      try {
        const site = getSiteByKey(siteKey)
        if (!site) return { success: false, error: '站点不存在' }

        const spider = await loadSpider(site)
        const result = await spider.searchContent(key, quick, pg)
        return { success: true, data: result }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    }
  )

  // ==================== 跨站点搜索（换源用）====================
  // 参考 FongMi/TV 的 mQuickAdapter 机制：按 VOD 名称搜索所有其他站点
  // 用于播放失败时自动/手动换源
  ipcMain.handle(
    'site:findAcrossSites',
    async (_event, keyword: string, options?: { excludeSiteKey?: string; excludeVodId?: string; limit?: number; timeoutMs?: number }) => {
      try {
        const config = getCurrentConfig()
        if (!config?.sites) return { success: false, error: '当前无配置' }

        const excludeSiteKey = options?.excludeSiteKey || ''
        const excludeVodId = options?.excludeVodId || ''
        const limit = options?.limit || 20
        const timeoutMs = options?.timeoutMs || 8000

        // 过滤出可搜索的 type=0/1/4 站点
        const candidateSites = config.sites.filter((s: any) =>
          (s.type === 0 || s.type === 1 || s.type === 4) &&
          s.searchable !== 0 &&
          s.key !== excludeSiteKey
        )

        console.log('[site:findAcrossSites] 关键词:', keyword, '候选站点数:', candidateSites.length)

        // 并行搜索所有站点，每个站点独立超时
        const searchPromises = candidateSites.map(async (site) => {
          try {
            const spider = await loadSpider(site)
            const result = await Promise.race([
              spider.searchContent(keyword, true),
              new Promise<Result>((_, reject) =>
                setTimeout(() => reject(new Error('搜索超时')), timeoutMs)
              )
            ])
            const list = result?.list || []
            // 过滤掉当前的 vod_id
            const filtered = list.filter((v: any) => v.vod_id && v.vod_id !== excludeVodId)
            return {
              siteKey: site.key,
              siteName: site.name,
              items: filtered.slice(0, 3) // 每个站点最多取 3 个匹配项
            }
          } catch (err) {
            console.log('[site:findAcrossSites] 站点搜索失败:', site.name, (err as Error).message)
            return { siteKey: site.key, siteName: site.name, items: [] }
          }
        })

        const results = await Promise.allSettled(searchPromises)
        const alternativeSources: { siteKey: string; siteName: string; vodId: string; vodName: string; vodPic?: string; vodRemarks?: string }[] = []

        for (const r of results) {
          if (r.status === 'fulfilled' && r.value.items.length > 0) {
            for (const item of r.value.items) {
              alternativeSources.push({
                siteKey: r.value.siteKey,
                siteName: r.value.siteName,
                vodId: item.vod_id,
                vodName: item.vod_name,
                vodPic: item.vod_pic,
                vodRemarks: item.vod_remarks
              })
              if (alternativeSources.length >= limit) break
            }
          }
          if (alternativeSources.length >= limit) break
        }

        console.log('[site:findAcrossSites] 找到', alternativeSources.length, '个备选源')
        return { success: true, data: alternativeSources }
      } catch (err) {
        console.error('[site:findAcrossSites] 异常:', err)
        return { success: false, error: String(err) }
      }
    }
  )

  ipcMain.handle(
    'site:playerContent',
    async (_event, siteKey: string, flag: string, id: string, vipFlags: string[]) => {
      try {
        const site = getSiteByKey(siteKey)
        if (!site) return { success: false, error: '站点不存在' }

        console.log('[site:playerContent] 请求:', siteKey, 'flag:', flag, 'id:', id?.substring(0, 100))
        const spider = await loadSpider(site)
        const result = await spider.playerContent(flag, id, vipFlags)
        console.log('[site:playerContent] 结果:', siteKey, 'url:', result.url?.substring(0, 100), 'parse:', result.parse, 'header:', result.header ? Object.keys(result.header) : undefined)
        return { success: true, data: result }
      } catch (err) {
        console.error('[site:playerContent] 失败:', siteKey, err)
        return { success: false, error: String(err) }
      }
    }
  )

  // ==================== SuperParse 分层解析 ====================
  // 参考 Android ParseJob + cat-catch 嗅探逻辑
  // Level 0: 直链识别 → Level 1: JSON Parse → Level 2: 并行解析+嗅探
  ipcMain.handle(
    'site:superParse',
    async (_event, params: {
      url: string
      flag: string
      siteKey: string
      playerResult?: { url: string; parse?: number; header?: Record<string, string>; playUrl?: string; click?: string }
    }) => {
      try {
        const site = getSiteByKey(params.siteKey)
        const config = getCurrentConfig()
        const parses = config?.parses || []

        console.log('[site:superParse] 开始分层解析, url:', params.url?.substring(0, 80), 'flag:', params.flag, 'parses数:', parses.length)

        const result = await superParse({
          url: params.url,
          flag: params.flag,
          siteKey: params.siteKey,
          site: site || undefined,
          parses,
          playUrl: site?.playUrl,
          click: site?.click,
          header: site?.header,
          playerResult: params.playerResult
        })

        if (result) {
          console.log('[site:superParse] 解析成功, from:', result.from, 'url:', result.url?.substring(0, 100))
          return { success: true, data: result }
        } else {
          console.log('[site:superParse] 解析失败')
          return { success: false, error: '所有解析方式均失败' }
        }
      } catch (err) {
        console.error('[site:superParse] 异常:', err)
        return { success: false, error: String(err) }
      }
    }
  )

  // ==================== 直播相关 ====================
  ipcMain.handle('live:load', async (_event, liveName: string) => {
    try {
      const config = getCurrentConfig()
      if (!config?.lives) {
        console.log('[live:load] 无直播源配置')
        return { success: false, error: '无直播源配置' }
      }

      const live = config.lives.find((l) => l.name === liveName)
      if (!live) {
        console.log('[live:load] 直播源不存在:', liveName, '可用:', config.lives.map(l => l.name))
        return { success: false, error: `直播源不存在: ${liveName}` }
      }

      console.log('[live:load] 加载直播源:', liveName, 'url:', live.url, 'api:', live.api)
      const groups = await loadLiveSource(live)
      console.log('[live:load] 加载完成, 分组数:', groups.length, '总频道数:', groups.reduce((s, g) => s + (g.channel?.length || 0), 0))
      return { success: true, data: groups }
    } catch (err) {
      console.error('[live:load] 加载失败:', err)
      return { success: false, error: String(err) }
    }
  })

  // 通过 URL 直接加载直播源（用于跨配置加载直播）
  ipcMain.handle('live:loadByUrl', async (_event, url: string, name?: string) => {
    try {
      console.log('[live:loadByUrl] 加载直播源:', name || url, 'url:', url)
      const live = { name: name || '直播', url }
      const groups = await loadLiveSource(live)
      console.log('[live:loadByUrl] 加载完成, 分组数:', groups.length, '总频道数:', groups.reduce((s, g) => s + (g.channel?.length || 0), 0))
      return { success: true, data: groups }
    } catch (err) {
      console.error('[live:loadByUrl] 加载失败:', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle(
    'live:epg',
    async (_event, epgUrl: string, channelMap?: Record<string, { id?: string; name: string }>) => {
      try {
        const map = channelMap ? new Map(Object.entries(channelMap)) : undefined
        const data = await getEpgData(epgUrl, map)
        return { success: true, data }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    }
  )

  // ==================== 直播刷新相关 ====================
  ipcMain.handle('live:refresh', async () => {
    try {
      await triggerRefresh()
      return { success: true }
    } catch (err) {
      console.error('[live:refresh] 失败:', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('live:getRefreshStatus', async () => {
    const status = getRefreshStatus()
    const dbStatus = await getDbRefreshStatus()
    if (dbStatus) {
      status.lastRefreshTime = dbStatus.last_refresh_time || 0
      status.nextRefreshTime = dbStatus.next_refresh_time || 0
      status.interval = dbStatus.refresh_interval_minutes || status.interval
    }
    return status
  })

  ipcMain.handle('live:setRefreshInterval', async (_event, minutes: number) => {
    if (typeof minutes !== 'number' || minutes < 1 || minutes > 1440) {
      return { success: false, error: '无效的刷新间隔' }
    }
    setRefreshInterval(minutes)
    return { success: true }
  })

  ipcMain.handle('live:getChannelTree', async () => {
    try {
      const rows = await getLiveTree()
      if (!rows || rows.length === 0) return { countries: [] }

      // 将数据库行转换为树结构
      const tree: LiveTree = { countries: [] }
      const countryMap = new Map<string, CountryNode>()
      const categoryMap = new Map<string, Map<string, CategoryNode>>()

      for (const row of rows) {
        const country = row.country
        const category = row.category

        if (!countryMap.has(country)) {
          countryMap.set(country, { name: country, categories: [] })
        }
        if (!categoryMap.has(country)) {
          categoryMap.set(country, new Map())
        }
        if (!categoryMap.get(country)!.has(category)) {
          categoryMap.get(country)!.set(category, { name: category, channels: [] })
        }

        const channel: ClassifiedChannel = {
          name: row.name,
          urls: JSON.parse(row.urls),
          bestUrl: row.best_url,
          latency: row.latency,
          country: row.country,
          category: row.category,
          sortOrder: row.sort_order,
          originalGroups: row.original_groups ? JSON.parse(row.original_groups) : []
        }

        categoryMap.get(country)!.get(category)!.channels.push(channel)
      }

      for (const [countryName, countryNode] of countryMap) {
        const cats = categoryMap.get(countryName)!
        for (const [catName, catNode] of cats) {
          countryNode.categories.push(catNode)
        }
        tree.countries.push(countryNode)
      }

      return tree
    } catch (err) {
      console.error('[live:getChannelTree] 失败:', err)
      return { countries: [] }
    }
  })

  // ==================== 历史记录 ====================
  ipcMain.handle('history:add', (_event, item) => {
    addHistory(item)
    return { success: true }
  })

  ipcMain.handle('history:list', (_event, limit?: number, offset?: number) => {
    return getHistoryList(limit, offset)
  })

  ipcMain.handle('history:delete', (_event, siteKey: string, vodId: string) => {
    deleteHistory(siteKey, vodId)
    return { success: true }
  })

  // ==================== 收藏 ====================
  ipcMain.handle('keep:add', (_event, item) => {
    addKeep(item)
    return { success: true }
  })

  ipcMain.handle('keep:list', (_event, limit?: number, offset?: number) => {
    return getKeepList(limit, offset)
  })

  ipcMain.handle('keep:delete', (_event, siteKey: string, vodId: string) => {
    deleteKeep(siteKey, vodId)
    return { success: true }
  })

  // ==================== 缓存 ====================
  ipcMain.handle('cache:get', (_event, key: string) => {
    if (typeof key !== 'string' || !key.trim()) return ''
    return getCache(key)
  })

  ipcMain.handle('cache:set', (_event, key: string, value: string) => {
    // 验证 key
    if (typeof key !== 'string' || !key.trim() || key.length > 256) {
      return { success: false, error: 'Invalid cache key' }
    }
    // 验证 value 大小
    if (typeof value !== 'string' || value.length > 1024 * 1024) { // 1MB 限制
      return { success: false, error: 'Cache value too large' }
    }
    setCache(key, value)
    return { success: true }
  })

  ipcMain.handle('cache:del', (_event, key: string) => {
    if (typeof key === 'string' && key.trim()) {
      deleteCache(key)
    }
    return { success: true }
  })

  // ==================== DLNA ====================
  ipcMain.handle('dlna:search', async () => {
    // TODO: 实现 DLNA 设备搜索
    return { success: true, data: [] }
  })

  ipcMain.handle(
    'dlna:cast',
    async (_event, _deviceUrl: string, _mediaUrl: string, _title?: string) => {
      // TODO: 实现 DLNA 投放
      return { success: false, error: 'DLNA 投放暂未实现' }
    }
  )

  ipcMain.handle('dlna:control', async (_event, _deviceUrl: string, _action: string) => {
    // TODO: 实现 DLNA 控制
    return { success: false, error: 'DLNA 控制暂未实现' }
  })

  // ==================== 设置 ====================
  ipcMain.handle('settings:get', (_event, key: string) => {
    // 验证 key 是字符串且不为空
    if (typeof key !== 'string' || !key.trim()) return undefined
    return getSettings()[key]
  })

  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    // 验证 key 是有效的字符串
    if (typeof key !== 'string' || !key.trim() || key.length > 100) {
      return { success: false, error: 'Invalid key' }
    }
    
    // 限制 value 的大小，避免存储过大的数据
    const valueStr = JSON.stringify(value)
    if (valueStr.length > 1024 * 100) { // 100KB 限制
      return { success: false, error: 'Value too large' }
    }
    
    const data = getSettings()
    data[key] = value
    saveSettings(data)
    return { success: true }
  })

  // ==================== 精简模式 ====================
  // 保存当前播放状态（由渲染进程在进入精简模式前调用）
  ipcMain.handle('window:savePlayerState', (_event, state: { url: string; header?: Record<string, string>; currentTime?: number }) => {
    // 验证 state 对象
    if (!state || typeof state !== 'object') {
      return { success: false, error: 'Invalid state' }
    }
    // 验证 url
    if (typeof state.url !== 'string' || state.url.length > 8192) {
      return { success: false, error: 'Invalid URL' }
    }
    // 验证 currentTime
    if (state.currentTime !== undefined && (typeof state.currentTime !== 'number' || state.currentTime < 0)) {
      return { success: false, error: 'Invalid currentTime' }
    }
    // 验证 header
    if (state.header && typeof state.header === 'object') {
      // 简单检查 header 不是过大
      const headerSize = JSON.stringify(state.header).length
      if (headerSize > 4096) {
        return { success: false, error: 'Header too large' }
      }
    }
    currentPlayerState = state
    return { success: true }
  })

  // 获取保存的播放状态（精简模式窗口启动时调用）
  ipcMain.handle('window:getPlayerState', () => {
    return currentPlayerState
  })

  // 进入精简模式
  ipcMain.handle('window:enterMiniMode', () => {
    if (miniPlayerWindow) return { success: true }
    const mainWin = mainWindow
    if (!mainWin) return { success: false, error: '主窗口不存在' }

    miniPlayerWindow = createMiniPlayerWindow()
    mainWin.hide()

    miniPlayerWindow.on('closed', () => {
      miniPlayerWindow = null
      currentPlayerState = null
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
      }
    })

    return { success: true }
  })

  // 退出精简模式
  ipcMain.handle('window:exitMiniMode', () => {
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
      miniPlayerWindow.close()
      miniPlayerWindow = null
    }
    currentPlayerState = null
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
    }
    return { success: true }
  })
}

// ==================== 应用生命周期 ====================

app.whenReady().then(async () => {
  // 注册 IPC handlers
  registerIpcHandlers()

  // 自动加载默认配置（在创建窗口之前，确保渲染进程能拿到 currentUrl）
  try {
    const url = ensureDefaultConfig()
    if (url) {
      console.log(`自动加载配置: ${url}`)
      await switchConfig(url)
      console.log('配置加载成功')
    }
  } catch (err) {
    console.error('自动加载配置失败:', err)
  }

  // 创建主窗口
  createWindow()

  // 启动直播源自动刷新
  startAutoRefresh()

  // 启动本地 HTTP 服务器
  try {
    await startLocalServer()
    console.log(`本地服务器端口: ${getServerPort()}`)
  } catch (err) {
    console.error('本地服务器启动失败:', err)
  }

  // macOS 激活窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// 所有窗口关闭时退出
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 应用退出前清理
app.on('before-quit', () => {
  // 停止直播源自动刷新
  stopAutoRefresh()
  // 销毁所有 Spider 实例
  destroyAllSpiders()
  // 清除 EPG 缓存
  clearEpgCache()
  // 关闭数据库
  closeDatabase()
})

