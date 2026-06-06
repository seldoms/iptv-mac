import { create } from 'zustand'

export interface Site {
  key: string
  name: string
  type: number
  api: string
  ext?: string
  jar?: string
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
  setFilters: (filters: Filter[]) => void
  reset: () => void
}

const initialState: ConfigState = {
  currentConfig: null,
  sites: [],
  currentSiteKey: '',
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
  return s.type === 0 || s.type === 1 || s.type === 4
}

/**
 * 从多个配置中找到有可用站点的配置
 * 策略：遍历所有配置，找到第一个有 type=0/1/4 站点的配置
 */
async function findConfigWithVisibleSites(
  excludeUrl?: string
): Promise<{ config: VodConfig; url: string } | null> {
  const configList = await window.api.invoke('config:list') as { url: string; name: string }[]
  for (const cfg of configList) {
    if (cfg.url === excludeUrl) continue
    try {
      const res = await window.api.invoke('config:load', cfg.url) as { success: boolean; data?: VodConfig; error?: string }
      if (res.success && res.data) {
        const visibleSites = (res.data.sites || []).filter(isVisibleSite)
        if (visibleSites.length > 0) {
          return { config: res.data, url: cfg.url }
        }
      }
    } catch { /* 忽略 */ }
  }
  return null
}

/**
 * 并行探测站点，返回第一个成功的
 */
async function probeSites(
  siteKeys: string[]
): Promise<{ siteKey: string; result: any } | null> {
  if (siteKeys.length === 0) return null
  const probeRes = await window.api.invoke('site:probe', siteKeys) as {
    success: boolean; data?: { siteKey: string; result: any }; error?: string
  }
  if (probeRes.success && probeRes.data) {
    return probeRes.data
  }
  return null
}

export const useConfigStore = create<ConfigState & ConfigActions>()((set, get) => ({
  ...initialState,

  loadConfig: async (url: string) => {
    set({ isLoading: true, error: null, categories: [], filters: {}, homeVideos: [], categoryVideos: [] })
    try {
      const res = await window.api.invoke('config:load', url) as { success: boolean; data?: VodConfig; error?: string }
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
      // 保存直播配置（独立于首页）
      if (hasLives) {
        set({ liveConfig: config })
      }

      if (visibleSites.length > 0) {
        // 当前配置有可用站点，直接探测
        const siteKeys = visibleSites.map((s) => s.key)
        console.log('[ConfigStore] 并行探测站点:', siteKeys)
        const probeResult = await probeSites(siteKeys)
        if (probeResult) {
          const { siteKey, result } = probeResult
          console.log('[ConfigStore] 探测成功, 使用站点:', siteKey)
          set({
            currentSiteKey: siteKey,
            categories: result.class || result.types || [],
            filters: result.filters || {},
            homeVideos: result.list || [],
            isLoading: false
          })
        } else {
          set({
            currentSiteKey: visibleSites[0].key,
            isLoading: false,
            error: '所有站点暂时不可用，请稍后重试或切换配置源'
          })
        }
      } else {
        // 当前配置没有可用站点，自动查找有站点的配置用于首页
        console.log('[ConfigStore] 当前配置无可见站点，自动查找其他配置')
        const altResult = await findConfigWithVisibleSites(url)
        if (altResult) {
          console.log('[ConfigStore] 找到有站点的配置:', altResult.url, '站点数:', altResult.config.sites.filter(isVisibleSite).length)
          // 用新配置的站点数据用于首页，但保留原配置的直播源
          const mergedConfig: VodConfig = {
            ...altResult.config,
            lives: config.lives || altResult.config.lives,
            parses: config.parses || altResult.config.parses
          }
          set({ currentConfig: mergedConfig, sites: altResult.config.sites || [] })
          if (!get().liveConfig && (altResult.config.lives?.length || 0) > 0) {
            set({ liveConfig: altResult.config })
          }

          const altVisibleSites = altResult.config.sites.filter(isVisibleSite)
          const probeResult = await probeSites(altVisibleSites.map(s => s.key))
          if (probeResult) {
            set({
              currentSiteKey: probeResult.siteKey,
              categories: probeResult.result.class || probeResult.result.types || [],
              filters: probeResult.result.filters || {},
              homeVideos: probeResult.result.list || [],
              isLoading: false
            })
          } else {
            set({ currentSiteKey: altVisibleSites[0].key, isLoading: false })
          }
        } else {
          // 所有配置都没有可用站点
          // 仍然保留当前配置（可能有直播源可用）
          set({ isLoading: false, error: '当前配置没有可用的影视站点，请在设置中添加配置源' })
        }
      }
    } catch (e: any) {
      console.error('[ConfigStore] loadConfig 失败:', e)
      set({ isLoading: false, error: e.message || '加载配置失败' })
    }
  },

  switchSite: async (siteKey: string) => {
    set({ currentSiteKey: siteKey, categories: [], filters: {}, homeVideos: [], categoryVideos: [], currentPage: 1, isLoading: true, error: null })
    try {
      const res = await window.api.invoke('site:homeContent', siteKey, true) as { success: boolean; data?: any; error?: string }
      if (res.success && res.data) {
        const result = res.data || {}
        set({
          categories: result.class || result.types || [],
          filters: result.filters || {},
          homeVideos: result.list || [],
          isLoading: false
        })
      } else {
        set({ isLoading: false, error: res.error || '获取首页内容失败' })
      }
    } catch (e: any) {
      set({ isLoading: false, error: e.message || '获取首页内容失败' })
    }
  },

  fetchHomeContent: async (): Promise<boolean> => {
    const { currentSiteKey } = get()
    if (!currentSiteKey) return false
    set({ isLoading: true, error: null })
    try {
      const res = await window.api.invoke('site:homeContent', currentSiteKey, true) as { success: boolean; data?: any; error?: string }
      if (!res.success) {
        set({ isLoading: false, error: res.error || '获取首页内容失败' })
        return false
      }
      const result = res.data || {}
      const categories = result.class || result.types || []
      const homeVideos = result.list || []
      const filters = result.filters || {}
      set({ categories, filters, homeVideos, isLoading: false })
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
      const res = await window.api.invoke('site:categoryContent', currentSiteKey, tid, String(pg), true, extend || {}) as { success: boolean; data?: any; error?: string }
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
  setFilters: (filters: Filter[]) => set({ filters: filters }),
  reset: () => set(initialState)
}))
