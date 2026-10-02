import { afterEach, describe, expect, it, vi } from 'vitest'
import { useConfigStore } from '../src/renderer/src/stores/useConfigStore'
import { cacheApi, invoke, siteApi } from '@/utils/ipc'

vi.mock('@/utils/ipc', () => ({
  invoke: vi.fn(),
  cacheApi: { get: vi.fn(), set: vi.fn() },
  configApi: { loadAsync: vi.fn(), peekLives: vi.fn() },
  settingsApi: { set: vi.fn().mockResolvedValue(undefined) },
  siteApi: { homeContentAsync: vi.fn() }
}))

/**
 * 复现"换站点后点分类标签显示暂无数据"：
 * 分类 type_id 是站点私有的——同一个"电影"，A 站是 1、B 站是 6。
 * 桩里严格模拟这一点：tid 不属于该站点时返回空列表。
 */
const SITE_A = { key: 'site-a', home: { class: [{ type_id: '1', type_name: '电影' }], filters: {}, list: [] } }
const SITE_B = { key: 'site-b', home: { class: [{ type_id: '6', type_name: '电影' }], filters: {}, list: [] } }

const categoryCalls: Array<{ siteKey: string; tid: string }> = []
/** 记录每个站点"最新的"分类请求结果，只有最后一条生效（模拟 requestId 语义） */
function stubSiteApis() {
  // 首页走 siteApi.homeContentAsync（loadSiteHome），分类走 invoke('site:categoryContent')
  vi.mocked(siteApi.homeContentAsync).mockImplementation((key: string) =>
    Promise.resolve({ success: true, data: key === SITE_A.key ? SITE_A.home : SITE_B.home })
  )
  vi.mocked(invoke).mockImplementation((channel: string, ...args: unknown[]) => {
    if (channel === 'config:getCurrentUrl') return Promise.resolve('config-url')
    if (channel === 'site:categoryContent') {
      const [siteKey, tid] = args as [string, string]
      categoryCalls.push({ siteKey, tid })
      const owned = siteKey === SITE_A.key ? ['1'] : ['6']
      return Promise.resolve({ success: true, data: { list: owned.includes(String(tid)) ? [{ vod_id: `${siteKey}-${tid}` }] : [] } })
    }
    return Promise.resolve(null)
  })
}

describe('换站点后的分类请求归属', () => {
  afterEach(() => {
    categoryCalls.length = 0
    vi.mocked(invoke).mockReset()
    vi.mocked(cacheApi.get).mockReset()
    vi.mocked(cacheApi.set).mockReset()
    vi.mocked(siteApi.homeContentAsync).mockReset()
    useConfigStore.getState().reset()
    try {
      localStorage.clear()
    } catch {
      /* ignore */
    }
  })

  it('切到 B 站后：pendingSiteKey 必须清空（否则标签会一直灰着、分类请求全被忽略）', async () => {
    stubSiteApis()
    useConfigStore.setState({
      currentSiteKey: SITE_A.key,
      contentSiteKey: SITE_A.key,
      configUrl: 'config-url',
      categories: SITE_A.home.class
    })

    await useConfigStore.getState().switchSite(SITE_B.key)

    const state = useConfigStore.getState()
    expect(state.pendingSiteKey).toBe('')
    expect(state.currentSiteKey).toBe(SITE_B.key)
    expect(state.contentSiteKey).toBe(SITE_B.key)
    expect(state.categories.map((c) => String(c.type_id))).toEqual(['6'])
  })

  it('切站后点新站点的「电影」能拿到数据，且请求打给正确的站点', async () => {
    stubSiteApis()
    useConfigStore.setState({
      currentSiteKey: SITE_A.key,
      contentSiteKey: SITE_A.key,
      configUrl: 'config-url',
      categories: SITE_A.home.class
    })

    await useConfigStore.getState().switchSite(SITE_B.key)
    // B 站的电影是 6
    await useConfigStore.getState().fetchCategoryContent('6', 1)

    expect(categoryCalls).toContainEqual({ siteKey: SITE_B.key, tid: '6' })
    expect(useConfigStore.getState().categoryVideos.map((v: any) => v.vod_id)).toEqual(['site-b-6'])
  })

  it('绝不把旧站点的 tid 发给新站点（这就是「暂无数据」的来源）', async () => {
    stubSiteApis()
    useConfigStore.setState({
      currentSiteKey: SITE_A.key,
      contentSiteKey: SITE_A.key,
      configUrl: 'config-url',
      categories: SITE_A.home.class
    })
    await useConfigStore.getState().switchSite(SITE_B.key)

    // 切站过程中点到了旧标签（A 的 1）——必须被忽略，而不是发给 B
    await useConfigStore.getState().fetchCategoryContent('1', 1)

    expect(categoryCalls.some((c) => c.siteKey === SITE_B.key && c.tid === '1')).toBe(false)
  })

  it('切站期间点旧标签 → 请求打给"标签所属的旧站点"（配对，而不是被忽略）', async () => {
    stubSiteApis()
    useConfigStore.setState({
      currentSiteKey: SITE_B.key,      // 已经切到 B
      contentSiteKey: SITE_A.key,      // 但屏幕上还是 A 的分类/内容
      configUrl: 'config-url',
      categories: SITE_A.home.class,
      pendingSiteKey: SITE_B.key
    })

    // 用户点的还是 A 的「电影」(tid=1)：必须请求 A，不能请求 B
    await useConfigStore.getState().fetchCategoryContent('1', 1)

    expect(categoryCalls).toEqual([{ siteKey: SITE_A.key, tid: '1' }])
    expect(useConfigStore.getState().categoryVideos.map((v: any) => v.vod_id)).toEqual(['site-a-1'])
  })
})
