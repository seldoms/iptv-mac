import { create } from 'zustand'
import { cacheApi, invoke, configApi, siteApi, settingsApi } from '@/utils/ipc'
import { isSupportedContentSite } from '@/siteSupport'
import {
  type SiteSpeedInfo,
  getCachedSiteData,
  loadSavedSiteSpeeds,
  prewarmSites,
  startPeriodicPrefetch,
  sortAndFilterSites
} from '@/services/sitePrefetchService'

const LAST_SITE_PREFIX = 'iptv:last-site:'
const MAX_INITIAL_SITE_ATTEMPTS = 6

export interface Site {
  key: string
  name: string
  type: number
  api: string
  ext?: string
  jar?: string
  hide?: number
  searchable: number
  changeable: number
}

export interface Vod {
  vod_id: string
  vod_name: string
  vod_pic: string
  vod_remarks: string
  type_name?: string
  vod_year?: string
  vod_play_from?: string
  vod_play_url?: string
}

export interface Category {
  type_id: string
  type_name: string
  parent_id?: string
}

export interface Filter {
  key: string
  name: string
  init?: string
  value: { n: string; v: string }[]
}

export interface VodConfig {
  spider: string
  wallpaper?: string
  logo?: string
  notice?: string
  sites: Site[]
  lives?: { name: string; url: string; epg?: string; ua?: string }[]
  parses?: { name: string; url: string; type?: number }[]
}

export interface LoadConfigResult {
  success: boolean
  error?: string
}

interface ConfigState {
  configUrl: string
  liveConfigUrl: string
  isLiveConfigLoading: boolean
  liveConfigError: string | null
  isStartupReady: boolean
  // 首页相关（影视站点）
  currentConfig: VodConfig | null
  sites: Site[]
  siteSpeeds: Record<string, SiteSpeedInfo>
  currentSiteKey: string
  contentSiteKey: string
  pendingSiteKey: string
  categories: Category[]
  filters: Record<string, Filter[]>
  /** 首页选中的分类标签（放 store 才能在进播放页再返回后保持） */
  activeCategory: string
  /** 该分类下已选的二级筛选 */
  selectedFilters: Record<string, string>
  homeVideos: Vod[]
  categoryVideos: Vod[]
  currentPage: number
  hasMore: boolean
  isLoading: boolean
  error: string | null

  // 直播相关（独立配置源）
  liveConfig: VodConfig | null

  // 订阅列表（原先由 SubscriptionBar 自持 + window 事件刷新）
  subscriptions: Array<{ url: string; name: string }>
  subscriptionsError: string
}

interface ConfigActions {
  loadLiveConfig: (url: string) => Promise<LoadConfigResult>
  loadConfig: (url: string) => Promise<LoadConfigResult>
  switchSite: (siteKey: string) => Promise<void>
  fetchHomeContent: () => Promise<boolean>
  fetchCategoryContent: (tid: string, pg: number, extend?: Record<string, string>) => Promise<void>
  setCurrentSiteKey: (key: string) => void
  setSiteSpeeds: (speeds: Record<string, SiteSpeedInfo>) => void
  setCategories: (cats: Category[]) => void
  setActiveCategory: (typeId: string) => void
  setSelectedFilters: (filters: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void
  setFilters: (filters: Record<string, Filter[]>) => void
  setStartupReady: (ready: boolean) => void
  /** 重新读取订阅列表（替代原先的 `subscriptions:changed` window 事件） */
  reloadSubscriptions: () => Promise<void>
  reset: () => void
}

const initialState: ConfigState = {
  configUrl: '',
  liveConfigUrl: '',
  isLiveConfigLoading: false,
  liveConfigError: null,
  isStartupReady: false,
  currentConfig: null,
  sites: [],
  siteSpeeds: {},
  currentSiteKey: '',
  contentSiteKey: '',
  pendingSiteKey: '',
  categories: [],
  filters: {},
  activeCategory: '',
  selectedFilters: {},
  homeVideos: [],
  categoryVideos: [],
  currentPage: 1,
  hasMore: true,
  isLoading: false,
  error: null,
  liveConfig: null,
  subscriptions: [],
  subscriptionsError: ''
}

function lastSiteStorageKey(configUrl: string) {
  return `${LAST_SITE_PREFIX}${configUrl}`
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error
  return error instanceof Error ? error.message : fallback
}

async function readLastSiteKey(configUrl: string): Promise<string> {
  try {
    const value = (await cacheApi.get(lastSiteStorageKey(configUrl))) as string | null
    return value || ''
  } catch {
    return ''
  }
}

async function writeLastSiteKey(configUrl: string, siteKey: string) {
  try {
    await cacheApi.set(lastSiteStorageKey(configUrl), siteKey)
  } catch {
    // ignore storage failures
  }
}

async function loadSiteHome(siteKey: string) {
  const res = (await siteApi.homeContentAsync(siteKey, true)) as {
    success: boolean
    data?: any
    error?: string
  }
  if (!res.success || !res.data) {
    throw new Error(res.error || '获取首页内容失败')
  }
  return res.data || {}
}

let siteHomeRequestId = 0
let liveConfigRequestId = 0
let homeContentRequestId = 0
let categoryRequestId = 0


/* ------------------- 首页标签的按站点记忆 -------------------
 * 分类标签/二级筛选要能扛过「进播放页 → 详情页 → 返回」，也要扛过应用重启；
 * 同时切换站点必须换回该站点自己记住的标签（没记过就是空，走默认首页）。
 * 用 localStorage 按 siteKey 存，store 只负责读写。
 */
const HOME_TABS_PREFIX = 'iptv.homeTabs:'

interface HomeTabs {
  activeCategory: string
  selectedFilters: Record<string, string>
}

function readHomeTabs(siteKey: string): HomeTabs {
  if (!siteKey) return { activeCategory: '', selectedFilters: {} }
  try {
    const raw = localStorage.getItem(`${HOME_TABS_PREFIX}${siteKey}`)
    if (!raw) return { activeCategory: '', selectedFilters: {} }
    const parsed = JSON.parse(raw) as Partial<HomeTabs>
    return {
      activeCategory: typeof parsed.activeCategory === 'string' ? parsed.activeCategory : '',
      selectedFilters: parsed.selectedFilters && typeof parsed.selectedFilters === 'object'
        ? parsed.selectedFilters
        : {}
    }
  } catch {
    return { activeCategory: '', selectedFilters: {} }
  }
}

function writeHomeTabs(siteKey: string, tabs: HomeTabs): void {
  if (!siteKey) return
  try {
    localStorage.setItem(`${HOME_TABS_PREFIX}${siteKey}`, JSON.stringify(tabs))
  } catch {
    /* 忽略隐私模式等写入失败：记忆是增强，不该影响主流程 */
  }
}

export const useConfigStore = create<ConfigState & ConfigActions>()((set, get) => ({
  ...initialState,

  reloadSubscriptions: async () => {
    try {
      const items = await configApi.list()
      if (Array.isArray(items)) {
        set({ subscriptions: items, subscriptionsError: '' })
      }
    } catch {
      set({ subscriptionsError: '订阅列表读取失败' })
    }
  },

  loadLiveConfig: async (url: string) => {
    const requestId = ++liveConfigRequestId
    set({ isLiveConfigLoading: true, liveConfigError: null })
    try {
      const result = await configApi.peekLives(url)
      if (requestId !== liveConfigRequestId) return { success: false, error: '直播订阅加载已取消' }
      if (!result.success || !Array.isArray(result.data) || result.data.length === 0) {
        throw new Error(result.error || '该订阅没有直播源，请选择其他订阅')
      }
      set({
        liveConfig: { spider: '', sites: [], lives: result.data },
        liveConfigUrl: url,
        isLiveConfigLoading: false
      })
      await settingsApi.set('lastLiveConfigUrl', url).catch(() => {})
      return { success: true }
    } catch (error) {
      if (requestId !== liveConfigRequestId) return { success: false, error: '直播订阅加载已取消' }
      const message = errorMessage(error, '直播订阅加载失败')
      set({ isLiveConfigLoading: false, liveConfigError: message })
      return { success: false, error: message }
    }
  },

  loadConfig: async (url: string) => {
    const requestId = ++siteHomeRequestId
    homeContentRequestId += 1
    categoryRequestId += 1
    set({
      isLoading: true,
      error: null,
      currentSiteKey: '',
      contentSiteKey: '',
      pendingSiteKey: '',
      categories: [],
      filters: {},
      homeVideos: [],
      categoryVideos: [],
      currentPage: 1,
      hasMore: true
    })
    try {
      const res = (await configApi.loadAsync(url)) as {
        success: boolean
        data?: VodConfig
        error?: string
      }
      if (requestId !== siteHomeRequestId) return { success: false, error: '配置加载已取消' }
      if (!res.success || !res.data) {
        const error = res.error || '加载配置失败'
        set({ isLoading: false, error })
        return { success: false, error }
      }
      const config = res.data
      const sites = config.sites || []
      const visibleSites = sites
        .filter(isSupportedContentSite)
        .sort((a, b) => Number(a.type === 3) - Number(b.type === 3))
      const hasLives = config.lives && config.lives.length > 0
      console.log(
        '[ConfigStore] loadConfig 成功, sites:',
        sites.length,
        'visibleSites:',
        visibleSites.length,
        'hasLives:',
        hasLives
      )

      // 读取历史保存的测速与健康信息（24小时内有效）
      const savedSpeeds = await loadSavedSiteSpeeds(url)
      if (requestId !== siteHomeRequestId) return { success: false, error: '配置加载已取消' }
      set({ currentConfig: config, sites, configUrl: url, siteSpeeds: savedSpeeds })
      if (!get().liveConfigUrl) set({ liveConfig: hasLives ? config : null })

      if (visibleSites.length > 0) {
        const savedSiteKey = await readLastSiteKey(url)
        if (requestId !== siteHomeRequestId) return { success: false, error: '配置加载已取消' }

        // 优先使用速度快、状态健康的站点作为首选候选列表
        const fastCandidates = sortAndFilterSites(visibleSites, savedSpeeds)
        const preferredPool = fastCandidates.length > 0 ? fastCandidates : visibleSites

        const savedSite = preferredPool.find((site) => site.key === savedSiteKey)
        const candidates = savedSite
          ? [savedSite, ...preferredPool.filter((site) => site.key !== savedSiteKey)]
          : preferredPool
        const attemptedSites = candidates.slice(0, MAX_INITIAL_SITE_ATTEMPTS)
        let lastError = '站点没有返回首页内容'

        for (const site of attemptedSites) {
          console.log('[ConfigStore] 尝试加载站点:', site.key)
          try {
            const result = await loadSiteHome(site.key)
            if (requestId !== siteHomeRequestId) return { success: false, error: '配置加载已取消' }
            const categories = result.class || result.types || []
            const homeVideos = result.list || []
            if (categories.length === 0 && homeVideos.length === 0) {
              lastError = `${site.name} 没有返回首页内容`
              continue
            }
            set({
              currentSiteKey: site.key,
              contentSiteKey: site.key,
              pendingSiteKey: '',
              categories,
              filters: result.filters || {},
              homeVideos,
              isLoading: false
            })
            await writeLastSiteKey(url, site.key)

            // 成功加载后在后台预热全部站点（包括离线站点的复活检测），并启动每日定时后台刷新
            void prewarmSites(url, sites, (newSpeeds) => {
              set({ siteSpeeds: newSpeeds })
            }).catch(() => {})
            startPeriodicPrefetch(url, sites, (newSpeeds) => {
              set({ siteSpeeds: newSpeeds })
            })

            return { success: true }
          } catch (error: any) {
            if (requestId !== siteHomeRequestId) return { success: false, error: '配置加载已取消' }
            lastError = errorMessage(error, `${site.name} 获取首页内容失败`)
          }
        }

        const siteKey = attemptedSites[0]?.key || ''
        const message = `已尝试 ${attemptedSites.length} 个站点，仍未获取到首页内容：${lastError}`
        set({
          currentSiteKey: siteKey,
          contentSiteKey: '',
          pendingSiteKey: '',
          isLoading: false,
          error: message
        })
        return { success: false, error: message }
      } else {
        const error =
          sites.length > 0
            ? '该订阅的点播站点暂不兼容（如 JAR/CSP 爬虫），请切换点播订阅；直播源可单独使用'
            : hasLives
              ? undefined
              : '当前配置没有可用的影视站点，请切换配置源'
        set({
          currentSiteKey: '',
          contentSiteKey: '',
          pendingSiteKey: '',
          categories: [],
          filters: {},
          homeVideos: [],
          categoryVideos: [],
          isLoading: false,
          error: error || null
        })
        return error ? { success: false, error } : { success: true }
      }
    } catch (e: any) {
      if (requestId !== siteHomeRequestId) return { success: false, error: '配置加载已取消' }
      console.error('[ConfigStore] loadConfig 失败:', e)
      const error = errorMessage(e, '加载配置失败')
      set({ isLoading: false, error })
      return { success: false, error }
    }
  },

  switchSite: async (siteKey: string) => {
    const requestId = ++siteHomeRequestId
    homeContentRequestId += 1
    categoryRequestId += 1
    set({
      currentSiteKey: siteKey,
      pendingSiteKey: siteKey,
      categoryVideos: [],
      currentPage: 1,
      hasMore: true,
      isLoading: true,
      error: null
    })
    try {
      const currentConfigUrl = get().configUrl || ((await invoke('config:getCurrentUrl')) as string)

      // 1. 尝试直接从本地 24h 缓存中瞬间秒开
      if (currentConfigUrl) {
        const cached = await getCachedSiteData(currentConfigUrl, siteKey)
        if (cached && (cached.class?.length || cached.types?.length || cached.list?.length)) {
          if (requestId !== siteHomeRequestId || get().currentSiteKey !== siteKey) return
          await writeLastSiteKey(currentConfigUrl, siteKey)
          set({
            contentSiteKey: siteKey,
            pendingSiteKey: '',
            categories: cached.class || cached.types || [],
            filters: (cached.filters as any) || {},
            homeVideos: cached.list || [],
            categoryVideos: cached.firstCategoryPage1 || [],
            isLoading: false,
            error: null
          })

          // 后台静默刷新一次最新内容
          void loadSiteHome(siteKey)
            .then((fresh) => {
              if (
                requestId === siteHomeRequestId &&
                get().currentSiteKey === siteKey &&
                get().contentSiteKey === siteKey &&
                (fresh.class?.length || fresh.types?.length || fresh.list?.length)
              ) {
                set({
                  categories: fresh.class || fresh.types || [],
                  filters: fresh.filters || {},
                  homeVideos: fresh.list || []
                })
              }
            })
            .catch(() => {})
          return
        }
      }

      // 2. 缓存未命中，执行网络请求
      const result = await loadSiteHome(siteKey)
      if (requestId !== siteHomeRequestId || get().currentSiteKey !== siteKey) return
      if (currentConfigUrl) await writeLastSiteKey(currentConfigUrl, siteKey)
      set({
        contentSiteKey: siteKey,
        pendingSiteKey: '',
        categories: result.class || result.types || [],
        filters: result.filters || {},
        homeVideos: result.list || [],
        categoryVideos: [],
        isLoading: false
      })
    } catch (e: any) {
      if (requestId !== siteHomeRequestId || get().currentSiteKey !== siteKey) return
      // 记录失败离线状态，避免用户再次踩坑
      const prevSpeeds = get().siteSpeeds
      const errText = errorMessage(e, '获取首页内容失败')
      set({
        siteSpeeds: {
          ...prevSpeeds,
          [siteKey]: { latency: 0, ok: false, lastChecked: Date.now(), error: errText }
        },
        currentSiteKey: siteKey,
        contentSiteKey: '',
        categories: [],
        filters: {},
        homeVideos: [],
        categoryVideos: [],
        pendingSiteKey: '',
        isLoading: false,
        error: errText
      })
    }
  },

  fetchHomeContent: async (): Promise<boolean> => {
    const { currentSiteKey } = get()
    if (!currentSiteKey) return false
    const siteKey = currentSiteKey
    const requestId = ++homeContentRequestId
    categoryRequestId += 1
    set({ isLoading: true, error: null })
    try {
      const result = await loadSiteHome(siteKey)
      if (requestId !== homeContentRequestId || get().currentSiteKey !== siteKey) return false
      const categories = result.class || result.types || []
      const homeVideos = result.list || []
      const filters = result.filters || {}
      set({
        categories,
        filters,
        homeVideos,
        contentSiteKey: siteKey,
        pendingSiteKey: '',
        isLoading: false
      })
      return categories.length > 0 || homeVideos.length > 0
    } catch (e: any) {
      if (requestId !== homeContentRequestId || get().currentSiteKey !== siteKey) return false
      set({ isLoading: false, error: errorMessage(e, '获取首页内容失败') })
      return false
    }
  },

  fetchCategoryContent: async (tid: string, pg: number, extend?: Record<string, string>) => {
    const siteKey = get().currentSiteKey
    if (!siteKey) return
    const requestId = ++categoryRequestId
    set({ isLoading: true, error: null })
    try {
      const res = (await invoke('site:categoryContent', siteKey, tid, String(pg), true, extend || {})) as {
        success: boolean
        data?: any
        error?: string
      }
      if (!res.success || !res.data) throw new Error(res.error || '获取分类内容失败')
      const result = res.data || {}
      const newList = result.list || []
      if (requestId !== categoryRequestId || get().currentSiteKey !== siteKey) return
      const currentCategoryVideos = get().categoryVideos
      set({
        categoryVideos: pg === 1 ? newList : [...currentCategoryVideos, ...newList],
        currentPage: pg,
        hasMore: newList.length > 0,
        isLoading: false
      })
    } catch (e: any) {
      if (requestId !== categoryRequestId || get().currentSiteKey !== siteKey) return
      set({ isLoading: false, error: errorMessage(e, '获取分类内容失败') })
    }
  },

  setCurrentSiteKey: (key: string) => set({ currentSiteKey: key }),
  setSiteSpeeds: (siteSpeeds) => set({ siteSpeeds }),
  setCategories: (cats: Category[]) => set({ categories: cats }),

  setActiveCategory: (typeId: string) =>
    set((state) => {
      writeHomeTabs(state.contentSiteKey || state.currentSiteKey, {
        activeCategory: typeId,
        selectedFilters: state.selectedFilters
      })
      return { activeCategory: typeId }
    }),

  setSelectedFilters: (filters) =>
    set((state) => {
      const next = typeof filters === 'function' ? filters(state.selectedFilters) : filters
      writeHomeTabs(state.contentSiteKey || state.currentSiteKey, {
        activeCategory: state.activeCategory,
        selectedFilters: next
      })
      return { selectedFilters: next }
    }),
  setFilters: (filters: Record<string, Filter[]>) => set({ filters }),
  setStartupReady: (isStartupReady: boolean) => set({ isStartupReady }),
  reset: () => {
    siteHomeRequestId += 1
    liveConfigRequestId += 1
    homeContentRequestId += 1
    categoryRequestId += 1
    set(initialState)
  }
}))

/* 站点切换时恢复该站点自己记住的分类标签；未记录过的站点回到默认首页。
 * 用订阅而不是各 action 里逐个处理，避免漏掉任何一条切站路径。 */
let lastHomeTabsSiteKey = ''
useConfigStore.subscribe((state) => {
  if (state.contentSiteKey === lastHomeTabsSiteKey) return
  lastHomeTabsSiteKey = state.contentSiteKey
  const remembered = readHomeTabs(state.contentSiteKey)
  if (
    state.activeCategory !== remembered.activeCategory ||
    JSON.stringify(state.selectedFilters) !== JSON.stringify(remembered.selectedFilters)
  ) {
    useConfigStore.setState({
      activeCategory: remembered.activeCategory,
      selectedFilters: remembered.selectedFilters
    })
  }
})
