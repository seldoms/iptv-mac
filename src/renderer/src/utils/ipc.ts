/**
 * IPC 通信类型安全封装
 * 渲染进程通过 window.api.invoke 与主进程通信
 */

export type IpcChannel =
  | 'config:load'
  | 'config:getCurrent'
  | 'config:getCurrentUrl'
  | 'config:list'
  | 'config:remove'
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
  'config:list': []
  'config:remove': [url: string]
  'config:peekLives': [url: string]
  'site:probe': [siteKeys: string[]]
  'site:homeContent': [siteKey: string, filter: boolean]
  'site:categoryContent': [siteKey: string, tid: string, pg: string, filter: boolean, extend: Record<string, string>]
  'site:detailContent': [siteKey: string, ids: string[]]
  'site:searchContent': [siteKey: string, key: string, quick: boolean, pg?: string]
  'site:playerContent': [siteKey: string, flag: string, id: string, vipFlags: string[]]
  'site:superParse': [params: {
    url: string
    flag: string
    siteKey: string
    playerResult?: { url: string; parse?: number; header?: Record<string, string>; playUrl?: string; click?: string }
  }]
  'live:load': [liveName: string]
  'live:loadByUrl': [url: string, name?: string]
  'live:epg': [epgUrl: string, channelId: string]
  'live:refresh': []
  'live:getRefreshStatus': []
  'live:setRefreshInterval': [minutes: number]
  'live:getChannelTree': []
  'history:add': [item: any]
  'history:list': []
  'history:delete': [vodId: string]
  'keep:add': [item: any]
  'keep:list': []
  'keep:delete': [vodId: string]
  'cache:get': [key: string, rule?: string]
  'cache:set': [key: string, value: string, rule?: string]
  'cache:del': [key: string, rule?: string]
  'dlna:search': []
  'dlna:cast': [deviceUrl: string, mediaUrl: string]
  'dlna:control': [deviceUrl: string, action: 'play' | 'pause' | 'stop' | 'seek', value?: number]
  'settings:get': [key: string]
  'settings:set': [key: string, value: any]
  'window:savePlayerState': [state: { url: string; header?: Record<string, string>; currentTime?: number }]
  'window:getPlayerState': []
  'window:enterMiniMode': []
  'window:exitMiniMode': []
}

/**
 * 类型安全的 invoke 函数
 */
export function invoke<T extends IpcChannel>(channel: T, ...args: IpcArgsMap[T]): Promise<any> {
  return window.api.invoke(channel, ...args)
}

/**
 * 配置管理
 */
export const configApi = {
  load: (url: string) => invoke('config:load', url),
  getCurrent: () => invoke('config:getCurrent'),
  getCurrentUrl: () => invoke('config:getCurrentUrl'),
  list: () => invoke('config:list'),
  remove: (url: string) => invoke('config:remove', url),
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
  epg: (epgUrl: string, channelId: string) => invoke('live:epg', epgUrl, channelId),
  refresh: () => invoke('live:refresh'),
  getRefreshStatus: () => invoke('live:getRefreshStatus'),
  setRefreshInterval: (minutes: number) => invoke('live:setRefreshInterval', minutes),
  getChannelTree: () => invoke('live:getChannelTree')
}

/**
 * 历史记录
 */
export const historyApi = {
  add: (item: any) => invoke('history:add', item),
  list: () => invoke('history:list'),
  delete: (vodId: string) => invoke('history:delete', vodId)
}

/**
 * 收藏
 */
export const keepApi = {
  add: (item: any) => invoke('keep:add', item),
  list: () => invoke('keep:list'),
  delete: (vodId: string) => invoke('keep:delete', vodId)
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
