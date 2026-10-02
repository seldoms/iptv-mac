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
/// 启动时自动找站的**总**预算：单站超时不可控，串行试 6 个可能转好几分钟，
/// 超过预算就停下、把错误和站点选择入口交给用户（比一直转圈更有用）。
const STARTUP_ATTEMPT_BUDGET_MS = 25_000

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
  /** 启动自动找站的进度（用于加载动画里显示"正在尝试第 N/M 个：站点名"） */
  startupAttempt: { index: number; total: number; siteName: string } | null
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
  startupAttempt: null,
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

/**
 * 校验"当前选中的分类"是否属于这个站点。
 *
 * 分类按站点记忆后必须校验：记住的 type_id 可能不属于新站点（站点换过分类、
 * 或被写入时正处在切站过程中），那样会一直请求一个不存在的分类 → 界面长期"暂无数据"。
 */
export function validActiveCategory(categories: Category[], activeCategory: string): string {
  if (!activeCategory || activeCategory === '首页') return activeCategory
  if (categories.length === 0) return activeCategory
  return categories.some((cat) => String(cat.type_id) === String(activeCategory)) ? activeCategory : ''
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

        // 先把本地 24h 缓存里的内容显示出来：用户打开就看到首页，不用对着转圈等网络。
        // （loadSiteHome 自身也会读缓存，但那只覆盖"第一个"候选站；这里扫一遍候选，任一命中就秒开）
        for (const site of attemptedSites) {
          const cached = await getCachedSiteData(url, site.key)
          if (requestId !== siteHomeRequestId) return { success: false, error: '配置加载已取消' }
          const cachedCategories = cached?.class || cached?.types || []
          const cachedVideos = cached?.list || []
          if (cachedCategories.length > 0 || cachedVideos.length > 0) {
            console.log('[ConfigStore] 启动秒开（命中缓存）:', site.key)
            set({
              currentSiteKey: site.key,
              contentSiteKey: site.key,
              pendingSiteKey: '',
              categories: cachedCategories,
              filters: (cached?.filters as any) || {},
              homeVideos: cachedVideos,
              categoryVideos: cached?.firstCategoryPage1 || [],
              activeCategory: validActiveCategory(cachedCategories, get().activeCategory),
              isLoading: false
            })
            break
          }
        }

        const budgetStart = Date.now()
        let attemptIndex = 0
        for (const site of attemptedSites) {
          attemptIndex += 1
          if (Date.now() - budgetStart > STARTUP_ATTEMPT_BUDGET_MS) {
            lastError = `自动尝试已超过 ${Math.round(STARTUP_ATTEMPT_BUDGET_MS / 1000)} 秒（已试 ${attemptIndex - 1} 个站点），请手动选择站点`
            console.warn('[ConfigStore]', lastError)
            break
          }
          set({
            startupAttempt: { index: attemptIndex, total: attemptedSites.length, siteName: site.name },
            pendingSiteKey: site.key
          })
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
              startupAttempt: null,
              categories,
              filters: result.filters || {},
              homeVideos,
              activeCategory: validActiveCategory(categories, get().activeCategory),
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
          startupAttempt: null,
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
    // 注意：这里**故意保留** contentSiteKey / categories / homeVideos 旧值——
    // 新站点加载完成前继续显示旧内容，避免闪白（既有回归测试盯着这一点）。
    // 因此"标签与站点错配"不能靠清空解决，而是靠下面的守卫：
    //   ① 切站期间（pendingSiteKey 非空）不接受分类请求
    //   ② 分类请求打到"当前正在显示内容的站点"（contentSiteKey）
    //   ③ 新分类到达时校验 activeCategory 是否仍属于该站点
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
          const cachedCategories: Category[] = cached.class || cached.types || []
          set({
            contentSiteKey: siteKey,
            pendingSiteKey: '',
            categories: cachedCategories,
            filters: (cached.filters as any) || {},
            homeVideos: cached.list || [],
            categoryVideos: cached.firstCategoryPage1 || [],
            activeCategory: validActiveCategory(cachedCategories, get().activeCategory),
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
                const freshCategories: Category[] = fresh.class || fresh.types || []
                set({
                  categories: freshCategories,
                  filters: fresh.filters || {},
                  homeVideos: fresh.list || [],
                  activeCategory: validActiveCategory(freshCategories, get().activeCategory)
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
      const networkCategories: Category[] = result.class || result.types || []
      set({
        contentSiteKey: siteKey,
        pendingSiteKey: '',
        categories: networkCategories,
        filters: result.filters || {},
        homeVideos: result.list || [],
        categoryVideos: [],
        activeCategory: validActiveCategory(networkCategories, get().activeCategory),
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
    // 正在切站：此时屏幕上的标签还是旧站点的，拿它去请求新站点必然返回空（"暂无数据"就是这么来的）
    if (get().pendingSiteKey) {
      console.warn('[ConfigStore] 站点切换中，忽略分类请求:', tid)
      return
    }
    // 请求打到"当前正在显示内容的站点"：切换过程中它就是旧站点，与新标签天然匹配
    const siteKey = get().contentSiteKey || get().currentSiteKey
    if (!siteKey) return
    // 分类是站点私有的 type_id：与当前展示的站点分类对不上就说明状态错位，别发请求制造"暂无数据"
    const currentCategories = get().categories
    if (
      tid !== '首页' &&
      currentCategories.length > 0 &&
      !currentCategories.some((cat) => String(cat.type_id) === String(tid))
    ) {
      console.warn('[ConfigStore] 分类不属于当前站点，已忽略:', tid)
      return
    }
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
      // 只在内容已就绪时落盘：切站过程中 contentSiteKey 为空，写下去会把旧站点的
      // type_id 记到新站点名下，之后一进这个站点就是"暂无数据"
      if (state.contentSiteKey) {
        writeHomeTabs(state.contentSiteKey, {
          activeCategory: typeId,
          selectedFilters: state.selectedFilters
        })
      }
      return { activeCategory: typeId }
    }),

  setSelectedFilters: (filters) =>
    set((state) => {
      const next = typeof filters === 'function' ? filters(state.selectedFilters) : filters
      if (state.contentSiteKey) {
        writeHomeTabs(state.contentSiteKey, {
          activeCategory: state.activeCategory,
          selectedFilters: next
        })
      }
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
