/**
 * IPTV 应用共享类型定义
 * 主进程与渲染进程共用
 */

// ==================== Vod 配置相关 ====================

/** 分類物件 */
export interface VodClass {
  type_id: string
  type_name: string
  type_flag?: string
  land?: number
  circle?: number
  ratio?: number
}

/** 篩選器選項 */
export interface FilterValue {
  n: string
  v: string
}

/** 篩選器 */
export interface Filter {
  key: string
  name: string
  init?: string
  value: FilterValue[]
}

/** 影片卡片物件 */
export interface Vod {
  vod_id: string
  vod_name: string
  vod_pic?: string
  vod_remarks?: string
  type_name?: string
  vod_year?: string
  vod_area?: string
  vod_director?: string
  vod_actor?: string
  vod_content?: string
  vod_play_from?: string
  vod_play_url?: string
  vod_tag?: string
  action?: string
  land?: number
  circle?: number
  ratio?: number
}

/** 通用回傳物件 */
export interface Result {
  class?: VodClass[]
  filters?: Record<string, Filter[]>
  list?: Vod[]
  pagecount?: number
  msg?: string
}

/** 播放解析結果 */
export interface PlayerResult {
  url: string
  parse?: number
  jx?: number
  playUrl?: string
  click?: string
  code?: number
  header?: Record<string, string>
  flag?: string
  jxFrom?: string
  format?: string
  danmaku?: Danmaku[]
  subs?: Sub[]
  drm?: Drm
  artwork?: string
  desc?: string
  position?: number
  msg?: string
}

/** 彈幕物件 */
export interface Danmaku {
  url: string
  name?: string
}

/** 字幕物件 */
export interface Sub {
  url: string
  name?: string
  lang?: string
  format?: string
  flag?: number
}

/** DRM 設定物件 */
export interface Drm {
  type: string
  key: string
  header?: Record<string, string>
  forceKey?: boolean
}

/** 卡片樣式 */
export interface Style {
  type?: 'rect' | 'oval' | 'list'
  ratio?: number
}

/** 解析規則 */
export interface Parse {
  name: string
  type: number
  url: string
  ext?: {
    flag?: string[]
    header?: Record<string, string>
  }
}

// ==================== Site 配置相关 ====================

/** 點播來源 */
export interface Site {
  key: string
  name: string
  type: number
  api: string
  ext?: string
  jar?: string
  click?: string
  playUrl?: string
  hide?: number
  timeout?: number
  searchable?: number
  changeable?: number
  quickSearch?: number
  indexs?: number
  categories?: string[]
  header?: Record<string, string>
  style?: Style
}

// ==================== VodConfig ====================

/** DNS over HTTPS 設定 */
export interface Doh {
  name: string
  url: string
  ips?: string[]
}

/** 代理伺服器設定 */
export interface ProxyConfig {
  name: string
  hosts: string[]
  urls: string[]
}

/** 網路攔截規則 */
export interface Rule {
  name?: string
  hosts: string[]
  regex?: string[]
  script?: string[]
  exclude?: string[]
}

/** 注入回應標頭 */
export interface HeaderConfig {
  host: string
  header: Record<string, string>
}

/** Vod 配置頂層 */
export interface VodConfig {
  spider?: string
  wallpaper?: string
  logo?: string
  notice?: string
  sites: Site[]
  parses?: Parse[]
  lives?: LiveSource[]
  doh?: Doh[]
  proxy?: ProxyConfig[]
  rules?: Rule[]
  headers?: HeaderConfig[]
  hosts?: string[]
  flags?: string[]
  ads?: string[]
}

// ==================== Live 配置相关 ====================

/** 追看/時移設定 */
export interface Catchup {
  type?: 'append' | 'default'
  regex?: string
  source?: string
  replace?: string
}

/** 頻道項目 */
export interface Channel {
  name: string
  urls: string[]
  number?: string
  logo?: string
  epg?: string
  ua?: string
  click?: string
  format?: string
  origin?: string
  referer?: string
  tvgId?: string
  tvgName?: string
  header?: Record<string, string>
  parse?: number
  catchup?: Catchup
  drm?: Drm
}

/** 頻道分組 */
export interface Group {
  name: string
  pass?: string
  channel: Channel[]
}

/** 直播來源 */
export interface LiveSource {
  name: string
  type?: number
  url?: string
  api?: string
  ext?: string | Record<string, unknown>
  jar?: string
  click?: string
  logo?: string
  epg?: string
  ua?: string
  origin?: string
  referer?: string
  timeZone?: string
  timeout?: number
  header?: Record<string, string> | string
  playerType?: number
  catchup?: Catchup
  groups?: Group[]
  boot?: boolean
  pass?: boolean | number
}

/** Live 配置頂層 */
export interface LiveConfig {
  spider?: string
  lives: LiveSource[]
  proxy?: ProxyConfig[]
  rules?: Rule[]
  headers?: HeaderConfig[]
  hosts?: string[]
  ads?: string[]
}

// ==================== 数据库相关 ====================

/** 觀看歷史記錄 */
export interface History {
  id?: number
  siteKey: string
  vodId: string
  vodName: string
  vodPic?: string
  vodRemarks?: string
  type?: number
  source?: string
  progress?: number
  createTime?: number
  updateTime?: number
}

/** 收藏記錄 */
export interface Keep {
  id?: number
  siteKey: string
  vodId: string
  vodName: string
  vodPic?: string
  vodRemarks?: string
  type?: number
  source?: string
  createTime?: number
  updateTime?: number
}

/** 快取項目 */
export interface CacheItem {
  key: string
  value: string
  createTime?: number
}

// ==================== EPG 相关 ====================

/** EPG 節目資訊 */
export interface EpgProgram {
  channel: string
  title: string
  start: string
  stop: string
  desc?: string
}

/** EPG 頻道資訊 */
export interface EpgChannel {
  id: string
  name: string
  logo?: string
  programs: EpgProgram[]
}

// ==================== DLNA 相关 ====================

/** 裝置資訊 */
export interface Device {
  uuid: string
  name: string
  ip: string
  type: number
  serial?: string
  eth?: string
  wlan?: string
  time: number
}

// ==================== 播放狀態 ====================

export interface MediaState {
  url?: string
  state?: number
  speed?: number
  title?: string
  artist?: string
  artwork?: string
  duration?: number
  position?: number
}

// ==================== 配置管理 ====================

/** 配置項 */
export interface ConfigItem {
  url: string
  name: string
  addTime: number
  updateTime: number
}

// ==================== 设置相关 ====================

export interface AppSettings {
  theme?: 'dark' | 'light' | 'system'
  language?: string
  defaultParse?: string
  playerType?: string
  hardwareDecode?: boolean
  proxyMode?: number
  currentConfigUrl?: string
  [key: string]: unknown
}

// ==================== 直播刷新相关 ====================

/** 刷新阶段 */
export type RefreshPhase = 'loading' | 'testing' | 'classifying' | 'dedup' | 'saving' | 'done' | 'error'

/** 刷新进度 */
export interface RefreshProgress {
  phase: RefreshPhase
  current: number
  total: number
  message?: string
}

/** 刷新状态 */
export interface RefreshStatus {
  isRefreshing: boolean
  lastRefreshTime: number
  nextRefreshTime: number
  progress: RefreshProgress | null
  interval: number // 分钟
}

/** 测试后的频道 */
export interface ChannelWithTest {
  name: string
  urls: string[]
  testResults: { url: string; alive: boolean; latency: number }[]
  originalGroups: string[]
}

/** 合并后的频道 */
export interface MergedChannel {
  name: string
  urls: string[]          // 可用 URL，按延迟排序
  bestUrl: string         // 最优 URL
  latency: number         // 最佳延迟
  country: string
  category: string
  sortOrder: number
  originalGroups: string[]
}

/** 分类后的频道 */
export interface ClassifiedChannel extends MergedChannel {}

/** 类别节点 */
export interface CategoryNode {
  name: string
  channels: ClassifiedChannel[]
}

/** 国家节点 */
export interface CountryNode {
  name: string
  categories: CategoryNode[]
}

/** 直播树 */
export interface LiveTree {
  countries: CountryNode[]
}

/** 刷新结果 */
export interface RefreshResult {
  totalChannels: number
  aliveChannels: number
  tree: LiveTree
}
