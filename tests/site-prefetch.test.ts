import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  sortAndFilterSites,
  isSpeedsStale,
  CACHE_TTL_MS,
  type SiteSpeedInfo,
  getCachedSiteData,
  setCachedSiteData
} from '../src/renderer/src/services/sitePrefetchService'
import type { Site } from '../src/renderer/src/stores/useConfigStore'
import { cacheApi } from '@/utils/ipc'

vi.mock('@/utils/ipc', () => ({
  invoke: vi.fn(),
  cacheApi: {
    get: vi.fn(),
    set: vi.fn()
  },
  siteApi: {
    homeContentAsync: vi.fn()
  }
}))

describe('sitePrefetchService - sortAndFilterSites', () => {
  const dummySites: Site[] = [
    { key: 'slow-site', name: '慢速站点', type: 1, api: 'http://slow.com', searchable: 1, changeable: 1 },
    { key: 'fast-site', name: '极速站点', type: 1, api: 'http://fast.com', searchable: 1, changeable: 1 },
    { key: 'offline-site', name: '离线站点', type: 1, api: 'http://offline.com', searchable: 1, changeable: 1 },
    { key: 'untested-site', name: '未测站点', type: 1, api: 'http://untested.com', searchable: 1, changeable: 1 }
  ]

  it('filters out offline sites and sorts healthy sites by latency ascending', () => {
    const speeds: Record<string, SiteSpeedInfo> = {
      'slow-site': { latency: 1500, ok: true, lastChecked: Date.now() },
      'fast-site': { latency: 210, ok: true, lastChecked: Date.now() },
      'offline-site': { latency: 0, ok: false, lastChecked: Date.now(), error: 'Timeout' }
    }

    const result = sortAndFilterSites(dummySites, speeds)

    // 离线站点不应该显示
    const keys = result.map((s) => s.key)
    expect(keys).not.toContain('offline-site')

    // 极速站点 (210ms) 应排在 慢速站点 (1500ms) 前面
    expect(keys[0]).toBe('fast-site')
    expect(keys[1]).toBe('slow-site')

    // 未测试的站点排在已测试健康站点后面
    expect(keys[2]).toBe('untested-site')
  })

  it('keeps current site visible even if it failed so user sees failure status', () => {
    const speeds: Record<string, SiteSpeedInfo> = {
      'offline-site': { latency: 0, ok: false, lastChecked: Date.now(), error: 'Timeout' }
    }

    const result = sortAndFilterSites(dummySites, speeds, 'offline-site')
    const keys = result.map((s) => s.key)
    expect(keys).toContain('offline-site')
  })

  it('restores revived site when it becomes ok: true', () => {
    // 初始状态：offline-site 是离线的
    const initialSpeeds: Record<string, SiteSpeedInfo> = {
      'offline-site': { latency: 0, ok: false, lastChecked: Date.now() - 10000 }
    }
    let result = sortAndFilterSites(dummySites, initialSpeeds)
    expect(result.map((s) => s.key)).not.toContain('offline-site')

    // 每日刷新或重新检测后：站点复活，响应时间 180ms
    const revivedSpeeds: Record<string, SiteSpeedInfo> = {
      'offline-site': { latency: 180, ok: true, lastChecked: Date.now() },
      'slow-site': { latency: 1200, ok: true, lastChecked: Date.now() }
    }
    result = sortAndFilterSites(dummySites, revivedSpeeds)
    const keys = result.map((s) => s.key)
    expect(keys).toContain('offline-site')
    expect(keys[0]).toBe('offline-site') // 180ms 最快，排在第 1 位
  })
})

describe('sitePrefetchService - daily staleness & caching', () => {
  it('detects stale speeds older than 24 hours', () => {
    const now = Date.now()
    const freshSpeeds: Record<string, SiteSpeedInfo> = {
      'site-a': { latency: 200, ok: true, lastChecked: now - 3600 * 1000 } // 1小时前
    }
    expect(isSpeedsStale(freshSpeeds)).toBe(false)

    const staleSpeeds: Record<string, SiteSpeedInfo> = {
      'site-a': { latency: 200, ok: true, lastChecked: now - (CACHE_TTL_MS + 1000) } // >24小时前
    }
    expect(isSpeedsStale(staleSpeeds)).toBe(true)

    expect(isSpeedsStale({})).toBe(true)
  })

  it('stores and retrieves cached site data within 24 hours', async () => {
    const configUrl = 'http://source.json'
    const siteKey = 'test-site'
    const mockData = {
      list: [{ vod_id: 'v1', vod_name: '测试影片' }],
      cachedAt: Date.now()
    }

    await setCachedSiteData(configUrl, siteKey, mockData)
    const cached = await getCachedSiteData(configUrl, siteKey)
    expect(cached).toBeDefined()
    expect(cached?.list?.[0].vod_name).toBe('测试影片')
  })
})
