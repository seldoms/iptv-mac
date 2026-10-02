import { cacheApi, invoke, siteApi } from '@/utils/ipc'
import type { Site } from '@/stores/useConfigStore'
import { isSupportedContentSite } from '@/siteSupport'

export interface SiteSpeedInfo {
  latency: number
  ok: boolean
  lastChecked: number
  error?: string
}

export interface CachedSiteData {
  class?: Array<{ type_id: string; type_name: string }>
  types?: Array<{ type_id: string; type_name: string }>
  filters?: Record<string, any[]>
  list?: any[]
  firstCategoryPage1?: any[]
  firstCategoryPage2?: any[]
  cachedAt: number
}

const memoryCache = new Map<string, CachedSiteData>()
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 小时缓存（每日刷新）

function getCacheKey(configUrl: string, siteKey: string): string {
  return `iptv:site-cache:${configUrl}:${siteKey}`
}

function getSpeedStorageKey(configUrl: string): string {
  return `iptv:site-speeds:${configUrl}`
}

export async function getCachedSiteData(configUrl: string, siteKey: string): Promise<CachedSiteData | null> {
  const memKey = `${configUrl}:${siteKey}`
  const inMem = memoryCache.get(memKey)
  if (inMem && Date.now() - inMem.cachedAt < CACHE_TTL_MS) {
    return inMem
  }
  try {
    const raw = (await cacheApi.get(getCacheKey(configUrl, siteKey))) as string | null
    if (raw) {
      const parsed = JSON.parse(raw) as CachedSiteData
      if (parsed && Date.now() - parsed.cachedAt < CACHE_TTL_MS) {
        memoryCache.set(memKey, parsed)
        return parsed
      }
    }
  } catch (err) {
    console.debug('[SitePrefetch] 读取缓存失败:', err)
  }
  return null
}

export async function setCachedSiteData(configUrl: string, siteKey: string, data: CachedSiteData): Promise<void> {
  const memKey = `${configUrl}:${siteKey}`
  memoryCache.set(memKey, data)
  try {
    await cacheApi.set(getCacheKey(configUrl, siteKey), JSON.stringify(data))
  } catch (err) {
    console.debug('[SitePrefetch] 写入缓存失败:', err)
  }
}

export async function loadSavedSiteSpeeds(configUrl: string): Promise<Record<string, SiteSpeedInfo>> {
  if (!configUrl) return {}
  try {
    const raw = (await cacheApi.get(getSpeedStorageKey(configUrl))) as string | null
    if (raw) {
      return JSON.parse(raw) as Record<string, SiteSpeedInfo>
    }
  } catch {
    // ignore
  }
  return {}
}

export async function saveSiteSpeeds(configUrl: string, speeds: Record<string, SiteSpeedInfo>): Promise<void> {
  if (!configUrl) return
  try {
    await cacheApi.set(getSpeedStorageKey(configUrl), JSON.stringify(speeds))
  } catch {
    // ignore
  }
}

export function isSpeedsStale(speeds: Record<string, SiteSpeedInfo>): boolean {
  const keys = Object.keys(speeds)
  if (keys.length === 0) return true
  const now = Date.now()
  return keys.some((k) => now - speeds[k].lastChecked > CACHE_TTL_MS)
}

/**
 * 过滤离线站点并按延迟排序：
 * 1. 过滤掉测速失败的离线站点 (speed.ok === false)
 * 2. 正常站点按 latency 升序排列（最快排在最前面）
 * 3. 未测速的站点排在后面
 * 4. 当前选中站点保留，方便展示错误
 */
export function sortAndFilterSites(
  sites: Site[],
  speeds: Record<string, SiteSpeedInfo>,
  currentKey?: string
): Site[] {
  return sites
    .filter((site) => {
      if (currentKey && site.key === currentKey) return true
      const speed = speeds[site.key]
      if (speed && !speed.ok) return false
      return true
    })
    .sort((a, b) => {
      const speedA = speeds[a.key]
      const speedB = speeds[b.key]
      const aOk = speedA?.ok === true
      const bOk = speedB?.ok === true
      if (aOk && bOk) {
        return speedA.latency - speedB.latency
      }
      if (aOk) return -1
      if (bOk) return 1
      return 0
    })
}

let activePrewarmSession = 0

/**
 * 后台预热站点数据并测速（支持发现复活站点）
 * @param configUrl 当前配置源 URL
 * @param sites 站点列表（全量支持站点）
 * @param onSpeedUpdate 测速更新回调
 * @param concurrency 并发数，默认 3
 */
export async function prewarmSites(
  configUrl: string,
  sites: Site[],
  onSpeedUpdate?: (speeds: Record<string, SiteSpeedInfo>) => void,
  concurrency = 3
): Promise<Record<string, SiteSpeedInfo>> {
  const sessionId = ++activePrewarmSession
  const candidateSites = sites.filter(isSupportedContentSite)
  if (candidateSites.length === 0) return {}

  const currentSpeeds = await loadSavedSiteSpeeds(configUrl)
  if (sessionId !== activePrewarmSession) return currentSpeeds

  if (Object.keys(currentSpeeds).length > 0) {
    onSpeedUpdate?.({ ...currentSpeeds })
  }

  const queue = [...candidateSites]
  const running: Promise<void>[] = []

  const processSite = async (site: Site) => {
    if (sessionId !== activePrewarmSession) return

    const startTime = performance.now()
    try {
      const res = (await siteApi.homeContentAsync(site.key, true)) as {
        success: boolean
        data?: any
        error?: string
      }
      const latency = Math.round(performance.now() - startTime)

      if (sessionId !== activePrewarmSession) return

      if (res.success && res.data) {
        const homeData = res.data || {}
        const categories = homeData.class || homeData.types || []
        const homeVideos = homeData.list || []

        let p1List: any[] | undefined = undefined
        let p2List: any[] | undefined = undefined

        // 如果有分类，预取第一分类的前两页
        if (categories.length > 0) {
          const firstCatId = categories[0].type_id
          try {
            const p1Res = (await invoke('site:categoryContent', site.key, firstCatId, '1', false, {})) as any
            if (p1Res?.success && p1Res?.data?.list) {
              p1List = p1Res.data.list
            }
          } catch {
            // ignore
          }

          if (sessionId !== activePrewarmSession) return

          try {
            const p2Res = (await invoke('site:categoryContent', site.key, firstCatId, '2', false, {})) as any
            if (p2Res?.success && p2Res?.data?.list) {
              p2List = p2Res.data.list
            }
          } catch {
            // ignore
          }
        }

        const cachedData: CachedSiteData = {
          class: homeData.class,
          types: homeData.types,
          filters: homeData.filters,
          list: homeVideos,
          firstCategoryPage1: p1List,
          firstCategoryPage2: p2List,
          cachedAt: Date.now()
        }

        await setCachedSiteData(configUrl, site.key, cachedData)

        // 站点在线（包括先前离线后复活的站点）
        currentSpeeds[site.key] = {
          latency,
          ok: true,
          lastChecked: Date.now()
        }
      } else {
        currentSpeeds[site.key] = {
          latency,
          ok: false,
          lastChecked: Date.now(),
          error: res.error || '获取首页内容失败'
        }
      }
    } catch (error: any) {
      if (sessionId !== activePrewarmSession) return
      const latency = Math.round(performance.now() - startTime)
      currentSpeeds[site.key] = {
        latency,
        ok: false,
        lastChecked: Date.now(),
        error: error.message || '连接失败'
      }
    }

    if (sessionId === activePrewarmSession) {
      onSpeedUpdate?.({ ...currentSpeeds })
      // 每次测速完成后持久化已测数据
      void saveSiteSpeeds(configUrl, currentSpeeds)
    }
  }

  // 并发控制池
  while (queue.length > 0 || running.length > 0) {
    if (sessionId !== activePrewarmSession) break

    while (queue.length > 0 && running.length < concurrency) {
      const site = queue.shift()!
      const p = processSite(site).then(() => {
        const idx = running.indexOf(p)
        if (idx >= 0) running.splice(idx, 1)
      })
      running.push(p)
    }

    if (running.length > 0) {
      await Promise.race(running)
    }
  }

  if (sessionId === activePrewarmSession) {
    await saveSiteSpeeds(configUrl, currentSpeeds)
  }

  return currentSpeeds
}

let periodicTimer: any = null

export function stopPeriodicPrefetch(): void {
  if (periodicTimer) {
    clearInterval(periodicTimer)
    periodicTimer = null
  }
}

/**
 * 开启每日定时后台刷新（每 30 分钟检查一次是否已超 24 小时）
 */
export function startPeriodicPrefetch(
  configUrl: string,
  sites: Site[],
  onSpeedUpdate?: (speeds: Record<string, SiteSpeedInfo>) => void
): void {
  stopPeriodicPrefetch()
  if (!configUrl || sites.length === 0) return

  periodicTimer = setInterval(async () => {
    try {
      const currentSpeeds = await loadSavedSiteSpeeds(configUrl)
      if (isSpeedsStale(currentSpeeds)) {
        console.log('[SitePrefetch] 测速缓存已超时(>24h)，启动每日全量后台刷新（检测复活站点）...')
        await prewarmSites(configUrl, sites, onSpeedUpdate)
      }
    } catch (err) {
      console.debug('[SitePrefetch] 定时后台刷新检查出错:', err)
    }
  }, 30 * 60 * 1000)
}
