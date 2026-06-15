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
  | 'window:savePlayerState'
  | 'window:getPlayerState'
  | 'window:enterMiniMode'
  | 'window:exitMiniMode'

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
  'window:savePlayerState': [state: { url: string; header?: Record<string, string>; currentTime?: number }]
  'window:getPlayerState': []
  'window:enterMiniMode': []
  'window:exitMiniMode': []
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
  return tauriInvoke('invoke_ipc', { channel, args })
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
  load: (url: string) => invoke('config:load', url),
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
  categoryContent: (siteKey: string, tid: string, pg: string, filter: boolean, extend: Record<string, string>) =>
    invoke('site:categoryContent', siteKey, tid, pg, filter, extend),
  detailContent: (siteKey: string, ids: string[]) => invoke('site:detailContent', siteKey, ids),
  searchContent: (siteKey: string, key: string, quick: boolean, pg?: string) =>
    invoke('site:searchContent', siteKey, key, quick, pg),
  findAcrossSites: (keyword: string, options?: { excludeSiteKey?: string; excludeVodId?: string; limit?: number; timeoutMs?: number }) =>
    invoke('site:findAcrossSites', keyword, options),
  playerContent: (siteKey: string, flag: string, id: string, vipFlags: string[]) =>
    invoke('site:playerContent', siteKey, flag, id, vipFlags),
  superParse: (params: {
    url: string
    flag: string
    siteKey: string
    playerResult?: { url: string; parse?: number; header?: Record<string, string>; playUrl?: string; click?: string }
  }) => invoke('site:superParse', params)
}

/**
 * 直播操作
 */
export const liveApi = {
  load: (liveName: string) => invoke('live:load', liveName),
  loadByUrl: (url: string, name?: string) => invoke('live:loadByUrl', url, name),
  epg: (epgUrl: string, channelMap?: Record<string, { id?: string; name: string }>) => invoke('live:epg', epgUrl, channelMap) as Promise<{ success: boolean; data?: EpgProgram[]; error?: string }>,
  refresh: () => invoke('live:refresh'),
  getRefreshStatus: () => invoke('live:getRefreshStatus'),
  setRefreshInterval: (minutes: number) => invoke('live:setRefreshInterval', minutes),
  getChannelTree: () => invoke('live:getChannelTree')
}

/**
 * 历史记录
 */
export const historyApi = {
  add: (item: import('@shared/types').History) => invoke('history:add', item),
  list: () => invoke('history:list'),
  delete: (siteKey: string, vodId: string) => invoke('history:delete', siteKey, vodId)
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
  getServerInfo: () => invoke('local:getServerInfo')
}

/**
 * 窗口控制
 */
export const windowApi = {
  savePlayerState: (state: { url: string; header?: Record<string, string>; currentTime?: number }) =>
    invoke('window:savePlayerState', state),
  getPlayerState: () => invoke('window:getPlayerState'),
  enterMiniMode: () => invoke('window:enterMiniMode'),
  exitMiniMode: () => invoke('window:exitMiniMode')
}
