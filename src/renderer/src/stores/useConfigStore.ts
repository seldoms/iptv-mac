import { create } from 'zustand'
import { cacheApi, invoke } from '@/utils/ipc'

const LAST_SITE_PREFIX = 'iptv:last-site:'

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

interface ConfigState {
  // 首页相关（影视站点）
  currentConfig: VodConfig | null
  sites: Site[]
  currentSiteKey: string
  contentSiteKey: string
  pendingSiteKey: string
  categories: Category[]
  filters: Record<string, Filter[]>
  homeVideos: Vod[]
  categoryVideos: Vod[]
  currentPage: number
  hasMore: boolean
  isLoading: boolean
  error: string | null

  // 直播相关（独立配置源）
  liveConfig: VodConfig | null
}

interface ConfigActions {
  loadConfig: (url: string) => Promise<void>
  switchSite: (siteKey: string) => Promise<void>
  fetchHomeContent: () => Promise<boolean>
  fetchCategoryContent: (tid: string, pg: number, extend?: Record<string, string>) => Promise<void>
  setCurrentSiteKey: (key: string) => void
  setCategories: (cats: Category[]) => void
  setFilters: (filters: Record<string, Filter[]>) => void
  reset: () => void
}

const initialState: ConfigState = {
  currentConfig: null,
  sites: [],
  currentSiteKey: '',
  contentSiteKey: '',
  pendingSiteKey: '',
  categories: [],
  filters: {},
  homeVideos: [],
  categoryVideos: [],
  currentPage: 1,
  hasMore: true,
  isLoading: false,
  error: null,
  liveConfig: null
}

/**
 * 判断站点是否可用于首页（type=0/1/4 是 HTTP API 站点）
 */
function isVisibleSite(s: Site): boolean {
  return (s.type === 0 || s.type === 1 || s.type === 4) && s.hide !== 1 && Boolean(s.api?.trim())
}

function lastSiteStorageKey(configUrl: string) {
  return `${LAST_SITE_PREFIX}${configUrl}`
}

async function readLastSiteKey(configUrl: string): Promise<string> {
  try {
    const value = await cacheApi.get(lastSiteStorageKey(configUrl)) as string | null
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
  const res = await invoke('site:homeContent', siteKey, true) as { success: boolean; data?: any; error?: string }
  if (!res.success || !res.data) {
    throw new Error(res.error || '获取首页内容失败')
  }
  return res.data || {}
}

let siteHomeRequestId = 0

export const useConfigStore = create<ConfigState & ConfigActions>()((set, get) => ({
  ...initialState,

  loadConfig: async (url: string) => {
    siteHomeRequestId += 1
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
      const res = await invoke('config:load', url) as { success: boolean; data?: VodConfig; error?: string }
      if (!res.success || !res.data) {
        set({ isLoading: false, error: res.error || '加载配置失败' })
        return
      }
      const config = res.data
      const sites = config.sites || []
      const visibleSites = sites.filter(isVisibleSite)
      const hasLives = config.lives && config.lives.length > 0
      console.log('[ConfigStore] loadConfig 成功, sites:', sites.length, 'visibleSites:', visibleSites.length, 'hasLives:', hasLives)

      // 无论有没有可见站点，先设置配置（直播源可能可用）
      set({ currentConfig: config, sites })
      set({ liveConfig: hasLives ? config : null })

      if (visibleSites.length > 0) {
        const savedSiteKey = await readLastSiteKey(url)
        const initialSite = visibleSites.find((site) => site.key === savedSiteKey) || visibleSites[0]
        const siteKey = initialSite.key
        console.log('[ConfigStore] 加载站点:', siteKey)
        try {
          const result = await loadSiteHome(siteKey)
          set({
            currentSiteKey: siteKey,
            contentSiteKey: siteKey,
            pendingSiteKey: '',
            categories: result.class || result.types || [],
            filters: result.filters || {},
            homeVideos: result.list || [],
            isLoading: false
          })
          await writeLastSiteKey(url, siteKey)
        } catch (error: any) {
          set({
            currentSiteKey: siteKey,
            contentSiteKey: '',
            pendingSiteKey: '',
            isLoading: false,
            error: error.message || '获取首页内容失败，请切换站点重试'
          })
        }
      } else {
        set({
          currentSiteKey: '',
          contentSiteKey: '',
          pendingSiteKey: '',
          categories: [],
          filters: {},
          homeVideos: [],
          categoryVideos: [],
          isLoading: false,
          error: hasLives ? null : '当前配置没有可用的影视站点，请切换配置源'
        })
      }
    } catch (e: any) {
      console.error('[ConfigStore] loadConfig 失败:', e)
      set({ isLoading: false, error: e.message || '加载配置失败' })
    }
  },

  switchSite: async (siteKey: string) => {
    const requestId = ++siteHomeRequestId
    set({
      currentSiteKey: siteKey,
      pendingSiteKey: siteKey,
      categories: [],
      filters: {},
      categoryVideos: [],
      currentPage: 1,
      hasMore: true,
      isLoading: true,
      error: null
    })
    try {
      const result = await loadSiteHome(siteKey)
      if (requestId !== siteHomeRequestId || get().currentSiteKey !== siteKey) return
      const currentConfigUrl = await invoke('config:getCurrentUrl') as string
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
      set({
        pendingSiteKey: '',
        isLoading: false,
        error: e.message || '获取首页内容失败'
      })
    }
  },

  fetchHomeContent: async (): Promise<boolean> => {
    const { currentSiteKey } = get()
    if (!currentSiteKey) return false
    set({ isLoading: true, error: null })
    try {
      const result = await loadSiteHome(currentSiteKey)
      const categories = result.class || result.types || []
      const homeVideos = result.list || []
      const filters = result.filters || {}
      set({ categories, filters, homeVideos, contentSiteKey: currentSiteKey, pendingSiteKey: '', isLoading: false })
      return categories.length > 0 || homeVideos.length > 0
    } catch (e: any) {
      set({ isLoading: false, error: e.message || '获取首页内容失败' })
      return false
    }
  },

  fetchCategoryContent: async (tid: string, pg: number, extend?: Record<string, string>) => {
    const { currentSiteKey, categoryVideos } = get()
    if (!currentSiteKey) return
    set({ isLoading: true, error: null })
    try {
      const res = await invoke('site:categoryContent', currentSiteKey, tid, String(pg), true, extend || {}) as { success: boolean; data?: any; error?: string }
      const result = res.data || {}
      const newList = result.list || []
      set({
        categoryVideos: pg === 1 ? newList : [...categoryVideos, ...newList],
        currentPage: pg,
        hasMore: newList.length > 0,
        isLoading: false
      })
    } catch (e: any) {
      set({ isLoading: false, error: e.message || '获取分类内容失败' })
    }
  },

  setCurrentSiteKey: (key: string) => set({ currentSiteKey: key }),
  setCategories: (cats: Category[]) => set({ categories: cats }),
  setFilters: (filters: Record<string, Filter[]>) => set({ filters }),
  reset: () => set(initialState)
}))
