/**
 * IPC 通信层
 *
 * 当前架构存在两种 IPC 通信模式：
 * 1. `invoke_ipc` 路由器 — 通过 "channel" 字符串分发到命令处理函数（`invoke()` 方法）
 * 2. `#[tauri::command]` 强类型命令 — Tauri 2 原生类型化命令（`invokeCommand()` 方法）
 *
 * @deprecated 新命令应优先使用强类型命令模式（`#[tauri::command] + invokeCommand`），
 *             逐步淘汰 invoke_ipc 路由器。详情见 docs/REMEDIATION_PLAN.md 7.1 节。
 */
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { EpgProgram } from '@shared/types'

export type IpcChannel =
  | 'config:load'
  | 'config:getCurrent'
  | 'config:getCurrentUrl'
  | 'config:inspect'
  | 'config:list'
  | 'config:remove'
  | 'config:rename'
  | 'config:peekLives'
  | 'site:probe'
  | 'site:homeContent'
  | 'site:categoryContent'
  | 'site:detailContent'
  | 'site:searchContent'
  | 'site:findAcrossSites'
  | 'site:playerContent'
  | 'site:superParse'
  | 'live:load'
  | 'live:loadByUrl'
  | 'live:epg'
  | 'live:refresh'
  | 'live:getRefreshStatus'
  | 'live:reportLineResult'
  | 'live:setRefreshInterval'
  | 'live:getChannelTree'
  | 'history:add'
  | 'history:list'
  | 'history:delete'
  | 'keep:add'
  | 'keep:list'
  | 'keep:delete'
  | 'cache:get'
  | 'cache:set'
  | 'cache:del'
  | 'dlna:search'
  | 'dlna:cast'
  | 'dlna:control'
  | 'settings:get'
  | 'settings:set'
  | 'local:getServerInfo'
  | 'log:frontend'
  | 'window:savePlayerState'
  | 'window:getPlayerState'
  | 'window:enterMiniMode'
  | 'window:resizeMiniMode'
  | 'window:setFullscreen'
  | 'window:isFullscreen'
  | 'proxy:throughput'
  | 'window:exitMiniMode'
  | 'window:applyMode'

/**
 * IPC 方法参数类型映射
 */
interface IpcArgsMap {
  'config:load': [url: string]
  'config:getCurrent': []
  'config:getCurrentUrl': []
  'config:inspect': [url: string]
  'config:list': []
  'config:remove': [url: string]
  'config:rename': [url: string, name: string]
  'config:peekLives': [url: string]
  'site:probe': [siteKeys: string[]]
  'site:homeContent': [siteKey: string, filter: boolean]
  'site:categoryContent': [siteKey: string, tid: string, pg: string, filter: boolean, extend: Record<string, string>]
  'site:detailContent': [siteKey: string, ids: string[]]
  'site:searchContent': [siteKey: string, key: string, quick: boolean, pg?: string]
  'site:findAcrossSites': [keyword: string, options?: {
    excludeSiteKey?: string
    excludeVodId?: string
    limit?: number
    timeoutMs?: number
  }]
  'site:playerContent': [siteKey: string, flag: string, id: string, vipFlags: string[]]
  'site:superParse': [params: {
    url: string
    flag: string
    siteKey: string
    playerResult?: { url: string; parse?: number; header?: Record<string, string>; playUrl?: string; click?: string }
  }]
  'live:load': [liveName: string]
  'live:loadByUrl': [url: string, name?: string]
  'live:epg': [epgUrl: string, channelMap?: Record<string, { id?: string; name: string }>]
  'live:refresh': []
  'live:getRefreshStatus': []
  'live:reportLineResult': [urls: string[], alive: boolean, latencyMs?: number]
  'live:setRefreshInterval': [minutes: number]
  'live:getChannelTree': []
  'history:add': [item: import('@shared/types').History]
  'history:list': []
  'history:delete': [siteKey: string, vodId: string]
  'keep:add': [item: import('@shared/types').Keep]
  'keep:list': []
  'keep:delete': [siteKey: string, vodId: string]
  'cache:get': [key: string, rule?: string]
  'cache:set': [key: string, value: string, rule?: string]
  'cache:del': [key: string, rule?: string]
  'dlna:search': []
  'dlna:cast': [deviceUrl: string, mediaUrl: string]
  'dlna:control': [deviceUrl: string, action: 'play' | 'pause' | 'stop' | 'seek', value?: number]
  'settings:get': [key: string]
  'settings:set': [key: string, value: any]
  'local:getServerInfo': []
  'log:frontend': [level: string, message: string, detail?: string]
  'window:savePlayerState': [state: { url: string; header?: Record<string, string>; currentTime?: number }]
  'window:getPlayerState': []
  'window:enterMiniMode': []
  'window:resizeMiniMode': [width: number, height: number]
  'window:setFullscreen': [fullscreen: boolean]
  'window:isFullscreen': []
  'proxy:throughput': []
  'window:exitMiniMode': []
  'window:applyMode': [mini: boolean]
}

/**
 * 类型安全的 invoke 函数
 */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__)
}

function webFallback(channel: IpcChannel): unknown {
  switch (channel) {
    case 'config:getCurrentUrl':
      return ''
    case 'config:getCurrent':
      return null
    case 'config:list':
    case 'history:list':
    case 'keep:list':
      return []
    case 'settings:get':
    case 'window:getPlayerState':
    case 'local:getServerInfo':
      return null
    case 'live:getRefreshStatus':
      return { running: false, nextRun: null, intervalMinutes: 0 }
    case 'live:getChannelTree':
      return { success: true, data: [] }
    default:
      return { success: false, error: '此功能需要在桌面应用中使用' }
  }
}

export function invoke<T extends keyof IpcArgsMap>(
  channel: T,
  ...args: IpcArgsMap[T]
): Promise<any> {
  if (!isTauriRuntime()) {
    return Promise.resolve(webFallback(channel))
  }
  // 网络请求使用异步命令，避免同步分发器阻塞桌面事件循环。
  const values = args as unknown[]
  if (channel === 'config:peekLives') {
    return invokeCommand('cmd_config_peek_lives', { url: values[0] })
  }
  if (channel === 'site:categoryContent') {
    const [siteKey, tid, pg, filter, extend] = values
    return invokeCommand('cmd_site_category_content', { siteKey, tid, pg, filter, extend })
  }
  if (channel === 'site:detailContent') {
    const [siteKey, ids] = values
    return invokeCommand('cmd_site_detail_content', { siteKey, ids })
  }
  if (channel === 'site:searchContent') {
    const [siteKey, key, quick, pg] = values
    return invokeCommand('cmd_site_search_content', { siteKey, key, quick, pg })
  }
  return tauriInvoke('invoke_ipc', { channel, args })
}

function invokeCommand(command: string, args?: Record<string, unknown>): Promise<any> {
  if (!isTauriRuntime()) {
    return Promise.reject(new Error('此功能需要在桌面应用中使用'))
  }
  return tauriInvoke(command, args)
}

export function on(
  channel: string,
  callback: (...args: unknown[]) => void
): () => void {
  if (!isTauriRuntime()) {
    return () => {}
  }

  let disposed = false
  let unlisten: (() => void) | undefined

  void listen<unknown[]>(channel, (event) => {
    const payload = Array.isArray(event.payload) ? event.payload : [event.payload]
    callback(...payload)
  }).then((stop) => {
    if (disposed) stop()
    else unlisten = stop
  })

  return () => {
    disposed = true
    unlisten?.()
  }
}

/**
 * 配置管理
 */
export const configApi = {
  save: (url: string) => invokeCommand('cmd_config_save', { url }),
  load: (url: string) => invoke('config:load', url),
  loadAsync: (url: string) =>
    isTauriRuntime()
      ? invokeCommand('cmd_config_load', { url })
      : invoke('config:load', url),
  getCurrent: () => invoke('config:getCurrent'),
  getCurrentUrl: () => invoke('config:getCurrentUrl'),
  inspect: (url: string) => invoke('config:inspect', url),
  list: () => invoke('config:list'),
  remove: (url: string) => invoke('config:remove', url),
  rename: (url: string, name: string) => invoke('config:rename', url, name),
  peekLives: (url: string) => invoke('config:peekLives', url)
}

/**
 * 站点操作
 */
export const siteApi = {
  probe: (siteKeys: string[]) => invoke('site:probe', siteKeys),
  homeContent: (siteKey: string, filter: boolean) => invoke('site:homeContent', siteKey, filter),
  homeContentAsync: (siteKey: string, filter: boolean) =>
    isTauriRuntime()
      ? invokeCommand('cmd_site_home_content', { siteKey, filter })
      : invoke('site:homeContent', siteKey, filter),
  categoryContent: (siteKey: string, tid: string, pg: string, filter: boolean, extend: Record<string, string>) =>
    invoke('site:categoryContent', siteKey, tid, pg, filter, extend),
  detailContent: (siteKey: string, ids: string[]) => invoke('site:detailContent', siteKey, ids),
  searchContent: (siteKey: string, key: string, quick: boolean, pg?: string) =>
    invoke('site:searchContent', siteKey, key, quick, pg),
  findAcrossSites: (keyword: string, options?: { excludeSiteKey?: string; excludeVodId?: string; limit?: number; timeoutMs?: number }) =>
    isTauriRuntime()
      ? invokeCommand('cmd_site_find_across_sites', { keyword, options: options ?? null })
      : invoke('site:findAcrossSites', keyword, options),
  playerContent: (siteKey: string, flag: string, id: string, vipFlags: string[]) =>
    isTauriRuntime()
      ? invokeCommand('cmd_site_player_content', { siteKey, flag, id, vipFlags })
      : invoke('site:playerContent', siteKey, flag, id, vipFlags),
  superParse: (params: {
    url: string
    flag: string
    siteKey: string
    playerResult?: { url: string; parse?: number; header?: Record<string, string>; playUrl?: string; click?: string }
  }) => isTauriRuntime()
    ? invokeCommand('cmd_site_super_parse', { params })
    : invoke('site:superParse', params)
}

/**
 * 直播操作
 */
export const liveApi = {
  load: (liveName: string) =>
    isTauriRuntime() ? invokeCommand('cmd_live_load', { liveName }) : invoke('live:load', liveName),
  loadByUrl: (url: string, name?: string) =>
    isTauriRuntime() ? invokeCommand('cmd_live_load_by_url', { url, name: name ?? null }) : invoke('live:loadByUrl', url, name),
  epg: (epgUrl: string, channelMap?: Record<string, { id?: string; name: string }>) =>
    (isTauriRuntime()
      ? invokeCommand('cmd_live_epg', { epgUrl, channelMap: channelMap ?? null })
      : invoke('live:epg', epgUrl, channelMap)) as Promise<{ success: boolean; data?: EpgProgram[]; error?: string }>,
  refresh: () => invoke('live:refresh'),
  getRefreshStatus: () => invoke('live:getRefreshStatus'),
  setRefreshInterval: (minutes: number) => invoke('live:setRefreshInterval', minutes),
  getChannelTree: () => invoke('live:getChannelTree'),
  /** 把真实播放结果回写（真实能播就不该显示「无信号」） */
  reportLineResult: (urls: string[], alive: boolean, latencyMs?: number) =>
    invoke('live:reportLineResult', urls, alive, latencyMs)
}

/**
 * 历史记录
 */
export const historyApi = {
  add: (item: import('@shared/types').History) =>
    isTauriRuntime() ? invokeCommand('cmd_history_add', { item }) : invoke('history:add', item),
  list: () =>
    isTauriRuntime() ? invokeCommand('cmd_history_list') : invoke('history:list'),
  delete: (siteKey: string, vodId: string) =>
    isTauriRuntime() ? invokeCommand('cmd_history_delete', { siteKey, vodId }) : invoke('history:delete', siteKey, vodId)
}

/**
 * 收藏
 */
export const keepApi = {
  add: (item: import('@shared/types').Keep) => invoke('keep:add', item),
  list: () => invoke('keep:list'),
  delete: (siteKey: string, vodId: string) => invoke('keep:delete', siteKey, vodId)
}

/**
 * 缓存
 */
export const cacheApi = {
  get: (key: string, rule?: string) => invoke('cache:get', key, rule),
  set: (key: string, value: string, rule?: string) => invoke('cache:set', key, value, rule),
  del: (key: string, rule?: string) => invoke('cache:del', key, rule)
}

/**
 * DLNA
 */
export const dlnaApi = {
  search: () => invoke('dlna:search'),
  cast: (deviceUrl: string, mediaUrl: string) => invoke('dlna:cast', deviceUrl, mediaUrl),
  control: (deviceUrl: string, action: 'play' | 'pause' | 'stop' | 'seek', value?: number) =>
    invoke('dlna:control', deviceUrl, action, value)
}

/**
 * 设置
 */
export const settingsApi = {
  get: (key: string) => invoke('settings:get', key),
  set: (key: string, value: any) => invoke('settings:set', key, value)
}

export const localApi = {
  getServerInfo: () =>
    isTauriRuntime() ? invokeCommand('cmd_local_get_server_info') : invoke('local:getServerInfo')
}

/**
 * 窗口控制
 */
export const windowApi = {
  savePlayerState: (state: { url: string; header?: Record<string, string>; currentTime?: number }) =>
    invoke('window:savePlayerState', state),
  getPlayerState: () => invoke('window:getPlayerState'),
  enterMiniMode: () => invoke('window:enterMiniMode'),
  resizeMiniMode: (width: number, height: number) => invoke('window:resizeMiniMode', width, height),
  setFullscreen: (fullscreen: boolean) => invoke('window:setFullscreen', fullscreen),
  isFullscreen: () => invoke('window:isFullscreen'),
  exitMiniMode: () => invoke('window:exitMiniMode'),
  applyMode: (mini: boolean) => invoke('window:applyMode', mini)
}

/**
 * 下载管理：调用 Rust 侧的下载任务表（内部使用 ffmpeg / N_m3u8DL-RE / yt-dlp）
 */
export interface DownloadTaskInfo {
  id: string
  name: string
  url: string
  tool: string
  dir: string
  path: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  live: boolean
  progress: number
  out_time_ms: number
  total_size: number
  speed: string
  message: string
  started_at: number
  log: string[]
}

export const downloadApi = {
  tools: () =>
    invokeCommand('cmd_download_tools') as Promise<{
      tools: Array<{ name: string; path?: string; available: boolean; bundled: boolean }>
      defaultDir: string
    }>,
  list: () => invokeCommand('cmd_download_list') as Promise<DownloadTaskInfo[]>,
  start: (payload: {
    url: string
    headers?: Record<string, string>
    fileName?: string
    tool?: string
    /** 直播录像：输出 MPEG-TS，可随时停止且文件仍可播放 */
    live?: boolean
  }) => invokeCommand('cmd_download_start', payload) as Promise<DownloadTaskInfo>,
  cancel: (id: string) => invokeCommand('cmd_download_cancel', { id }) as Promise<void>,
  remove: (id: string) => invokeCommand('cmd_download_remove', { id }) as Promise<void>,
  clearFinished: () => invokeCommand('cmd_download_clear_finished') as Promise<void>,
  reveal: (path: string) => invokeCommand('cmd_download_reveal', { path }) as Promise<void>,
  openDir: () => invokeCommand('cmd_download_open_dir') as Promise<void>
}
