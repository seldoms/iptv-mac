import { afterEach, describe, expect, it, vi } from 'vitest'
import { useConfigStore } from '../src/renderer/src/stores/useConfigStore'
import { cacheApi, configApi, invoke, siteApi, settingsApi } from '@/utils/ipc'

vi.mock('@/utils/ipc', () => ({
  invoke: vi.fn(),
  cacheApi: {
    get: vi.fn(),
    set: vi.fn()
  },
  configApi: {
    loadAsync: vi.fn(),
    peekLives: vi.fn()
  },
  settingsApi: { set: vi.fn().mockResolvedValue(undefined) },
  siteApi: {
    homeContentAsync: vi.fn()
  }
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useConfigStore site switching', () => {
  afterEach(() => {
    vi.mocked(invoke).mockReset()
    vi.mocked(cacheApi.get).mockReset()
    vi.mocked(cacheApi.set).mockReset()
    vi.mocked(configApi.loadAsync).mockReset()
    vi.mocked(configApi.peekLives).mockReset()
    vi.mocked(siteApi.homeContentAsync).mockReset()
    useConfigStore.getState().reset()
  })

  it('keeps existing content usable while a new site loads', async () => {
    const siteBHome = deferred<{ success: boolean; data: any }>()
    vi.mocked(siteApi.homeContentAsync).mockImplementation(() => siteBHome.promise)
    vi.mocked(invoke).mockImplementation((channel: string) => {
      if (channel === 'config:getCurrentUrl') return Promise.resolve('config-url')
      return Promise.resolve(null)
    })

    useConfigStore.setState({
      currentSiteKey: 'site-a',
      contentSiteKey: 'site-a',
      homeVideos: [{ vod_id: 'old-1', vod_name: '旧影片', vod_pic: '', vod_remarks: '' }]
    })

    const switching = useConfigStore.getState().switchSite('site-b')
    let state = useConfigStore.getState()
    expect(state.currentSiteKey).toBe('site-b')
    expect(state.pendingSiteKey).toBe('site-b')
    expect(state.contentSiteKey).toBe('site-a')
    expect(state.homeVideos[0].vod_id).toBe('old-1')

    siteBHome.resolve({
      success: true,
      data: {
        class: [{ type_id: '1', type_name: '电影' }],
        filters: {},
        list: [{ vod_id: 'new-1', vod_name: '新影片', vod_pic: '', vod_remarks: '' }]
      }
    })
    await switching

    state = useConfigStore.getState()
    expect(state.pendingSiteKey).toBe('')
    expect(state.contentSiteKey).toBe('site-b')
    expect(state.homeVideos[0].vod_id).toBe('new-1')
  })

  it('ignores stale site responses when users switch again quickly', async () => {
    const slowSite = deferred<{ success: boolean; data: any }>()
    const fastSite = deferred<{ success: boolean; data: any }>()
    vi.mocked(siteApi.homeContentAsync).mockImplementation((siteKey: string) =>
      siteKey === 'site-b' ? slowSite.promise : fastSite.promise
    )
    vi.mocked(invoke).mockImplementation((channel: string) => {
      if (channel === 'config:getCurrentUrl') return Promise.resolve('config-url')
      return Promise.resolve(null)
    })

    useConfigStore.setState({
      currentSiteKey: 'site-a',
      contentSiteKey: 'site-a',
      homeVideos: [{ vod_id: 'old-1', vod_name: '旧影片', vod_pic: '', vod_remarks: '' }]
    })

    const firstSwitch = useConfigStore.getState().switchSite('site-b')
    const secondSwitch = useConfigStore.getState().switchSite('site-c')

    fastSite.resolve({
      success: true,
      data: { class: [], filters: {}, list: [{ vod_id: 'site-c-1', vod_name: 'C', vod_pic: '', vod_remarks: '' }] }
    })
    await secondSwitch

    slowSite.resolve({
      success: true,
      data: { class: [], filters: {}, list: [{ vod_id: 'site-b-1', vod_name: 'B', vod_pic: '', vod_remarks: '' }] }
    })
    await firstSwitch

    const state = useConfigStore.getState()
    expect(state.currentSiteKey).toBe('site-c')
    expect(state.contentSiteKey).toBe('site-c')
    expect(state.homeVideos[0].vod_id).toBe('site-c-1')
  })

  it('ignores stale category responses after switching sites', async () => {
    const staleCategory = deferred<{ success: boolean; data: any }>()
    vi.mocked(invoke).mockImplementation((channel: string) => {
      if (channel === 'site:categoryContent') return staleCategory.promise
      if (channel === 'config:getCurrentUrl') return Promise.resolve('')
      return Promise.resolve(null)
    })
    vi.mocked(siteApi.homeContentAsync).mockResolvedValue({
      success: true,
      data: { class: [], filters: {}, list: [] }
    })

    useConfigStore.setState({
      currentSiteKey: 'site-a',
      contentSiteKey: 'site-a',
      categoryVideos: [{ vod_id: 'old', vod_name: '旧内容', vod_pic: '', vod_remarks: '' }]
    })

    const staleRequest = useConfigStore.getState().fetchCategoryContent('cat-a', 1)
    await useConfigStore.getState().switchSite('site-b')

    staleCategory.resolve({
      success: true,
      data: { list: [{ vod_id: 'stale', vod_name: '旧站点结果' }] }
    })
    await staleRequest

    expect(useConfigStore.getState().currentSiteKey).toBe('site-b')
    expect(useConfigStore.getState().categoryVideos).toEqual([])
  })

  it('keeps only the latest category request result', async () => {
    const firstCategory = deferred<{ success: boolean; data: any }>()
    const secondCategory = deferred<{ success: boolean; data: any }>()
    vi.mocked(invoke).mockImplementation((channel: string, ...args: any[]) => {
      if (channel !== 'site:categoryContent') return Promise.resolve(null)
      return args[1] === 'cat-a' ? firstCategory.promise : secondCategory.promise
    })

    useConfigStore.setState({
      currentSiteKey: 'site-a',
      contentSiteKey: 'site-a'
    })

    const firstRequest = useConfigStore.getState().fetchCategoryContent('cat-a', 1)
    const secondRequest = useConfigStore.getState().fetchCategoryContent('cat-b', 1)

    secondCategory.resolve({
      success: true,
      data: { list: [{ vod_id: 'new', vod_name: '新分类结果' }] }
    })
    await secondRequest

    firstCategory.resolve({
      success: true,
      data: { list: [{ vod_id: 'stale', vod_name: '旧分类结果' }] }
    })
    await firstRequest

    expect(useConfigStore.getState().categoryVideos[0].vod_id).toBe('new')
  })

  it('stays on selected site and sets error when site switch fails', async () => {
    vi.mocked(siteApi.homeContentAsync).mockRejectedValue(new Error('站点请求超时'))

    useConfigStore.setState({
      currentSiteKey: 'site-a',
      contentSiteKey: 'site-a',
      categories: [{ type_id: '1', type_name: '电影' }],
      homeVideos: [{ vod_id: 'old-1', vod_name: '旧影片', vod_pic: '', vod_remarks: '' }]
    })

    await useConfigStore.getState().switchSite('site-fail')

    const state = useConfigStore.getState()
    expect(state.currentSiteKey).toBe('site-fail')
    expect(state.contentSiteKey).toBe('')
    expect(state.pendingSiteKey).toBe('')
    expect(state.categories).toEqual([])
    expect(state.homeVideos).toEqual([])
    expect(state.error).toBe('站点请求超时')
  })

  it('returns a failed result when config loading fails', async () => {
    vi.mocked(configApi.loadAsync).mockResolvedValue({
      success: false,
      error: '配置地址不可访问'
    })

    const result = await useConfigStore.getState().loadConfig('https://example.com/bad.json')

    expect(result).toEqual({ success: false, error: '配置地址不可访问' })
    expect(useConfigStore.getState().error).toBe('配置地址不可访问')
  })

  it('keeps live and VOD subscriptions independent', async () => {
    vi.mocked(configApi.peekLives).mockResolvedValue({ success: true, data: [{ name: 'Live', url: 'https://example.com/live.m3u' }] })
    await useConfigStore.getState().loadLiveConfig('https://example.com/live.json')
    vi.mocked(configApi.loadAsync).mockResolvedValue({ success: true, data: { sites: [], lives: [{ name: 'Other', url: 'https://example.com/other.m3u' }] } })
    await useConfigStore.getState().loadConfig('https://example.com/vod.json')
    expect(useConfigStore.getState().liveConfigUrl).toBe('https://example.com/live.json')
    expect(useConfigStore.getState().liveConfig?.lives?.[0].name).toBe('Live')
    expect(settingsApi.set).toHaveBeenCalledWith('lastLiveConfigUrl', 'https://example.com/live.json')
  })

  it('preserves the last live subscription when a replacement fails', async () => {
    vi.mocked(configApi.peekLives).mockResolvedValueOnce({ success: true, data: [{ name: 'Live', url: 'https://example.com/live.m3u' }] })
      .mockRejectedValueOnce('[NETWORK_ERROR] connection refused')
    await useConfigStore.getState().loadLiveConfig('working')
    const result = await useConfigStore.getState().loadLiveConfig('broken')
    expect(result.success).toBe(false)
    expect(useConfigStore.getState().liveConfigUrl).toBe('working')
    expect(useConfigStore.getState().liveConfigError).toContain('connection refused')
  })

  it('ignores a startup config response superseded by another subscription', async () => {
    const oldConfig = deferred<any>()
    vi.mocked(configApi.loadAsync).mockReturnValueOnce(oldConfig.promise)
      .mockResolvedValueOnce({ success: true, data: { sites: [], lives: [{ name: 'New', url: 'https://example.com/live.m3u' }] } })
    const oldLoad = useConfigStore.getState().loadConfig('old')
    await useConfigStore.getState().loadConfig('new')
    oldConfig.resolve({ success: true, data: { sites: [], lives: [] } })
    await oldLoad
    expect(useConfigStore.getState().configUrl).toBe('new')
    expect(useConfigStore.getState().error).toBeNull()
  })

  it('reports unsupported VOD even when the same subscription contains live TV', async () => {
    vi.mocked(configApi.loadAsync).mockResolvedValue({ success: true, data: { sites: [{ key: 'jar', name: 'JAR', type: 3, api: 'csp_Demo' }], lives: [{ name: 'Live', url: 'https://example.com/live.m3u' }] } })
    const result = await useConfigStore.getState().loadConfig('jar-config')
    expect(result.success).toBe(false)
    expect(result.error).toContain('JAR/CSP')
    expect(useConfigStore.getState().liveConfig?.lives).toHaveLength(1)
    expect(siteApi.homeContentAsync).not.toHaveBeenCalled()
  })

  it('returns a successful result after config and first site content load', async () => {
    vi.mocked(configApi.loadAsync).mockResolvedValue({
      success: true,
      data: {
        spider: '',
        sites: [{
          key: 'site-a',
          name: '站点 A',
          type: 1,
          api: 'https://example.com/api.php',
          searchable: 1,
          changeable: 1
        }]
      }
    })
    vi.mocked(siteApi.homeContentAsync).mockResolvedValue({
      success: true,
      data: {
        class: [{ type_id: '1', type_name: '电影' }],
        filters: {},
        list: [{ vod_id: 'vod-1', vod_name: '影片', vod_pic: '', vod_remarks: '' }]
      }
    })

    const result = await useConfigStore.getState().loadConfig('https://example.com/config.json')

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    expect(useConfigStore.getState().currentSiteKey).toBe('site-a')
    expect(useConfigStore.getState().homeVideos[0].vod_id).toBe('vod-1')
  })

  it('loads a supported type 3 JavaScript source as the initial content source', async () => {
    vi.mocked(configApi.loadAsync).mockResolvedValue({
      success: true,
      data: {
        spider: '',
        sites: [{
          key: 'js-site',
          name: 'JS 站点',
          type: 3,
          api: 'https://example.com/drpy2.min.js',
          ext: 'https://example.com/rule.js',
          searchable: 1,
          changeable: 1
        }]
      }
    })
    vi.mocked(siteApi.homeContentAsync).mockResolvedValue({
      success: true,
      data: {
        class: [],
        filters: {},
        list: [{ vod_id: 'js-vod', vod_name: 'JS 影片', vod_pic: '', vod_remarks: '' }]
      }
    })

    const result = await useConfigStore.getState().loadConfig('https://example.com/js-config.json')

    expect(result.success).toBe(true)
    expect(siteApi.homeContentAsync).toHaveBeenCalledWith('js-site', true)
    expect(useConfigStore.getState().currentSiteKey).toBe('js-site')
    expect(useConfigStore.getState().homeVideos[0].vod_id).toBe('js-vod')
  })

  it('falls back to another site when the preferred site cannot load home content', async () => {
    vi.mocked(configApi.loadAsync).mockResolvedValue({
      success: true,
      data: {
        spider: '',
        sites: [
          { key: 'broken-site', name: '失效站点', type: 1, api: 'https://broken.example/api', searchable: 1, changeable: 1 },
          { key: 'working-site', name: '可用站点', type: 1, api: 'https://working.example/api', searchable: 1, changeable: 1 }
        ]
      }
    })
    vi.mocked(cacheApi.get).mockResolvedValue('broken-site')
    vi.mocked(siteApi.homeContentAsync).mockImplementation((siteKey: string) => {
      if (siteKey === 'broken-site') {
        return Promise.resolve({ success: false, error: '首页接口失效' })
      }
      return Promise.resolve({
        success: true,
        data: {
          class: [{ type_id: '1', type_name: '电影' }],
          filters: {},
          list: [{ vod_id: 'fallback-vod', vod_name: '可用影片', vod_pic: '', vod_remarks: '' }]
        }
      })
    })

    const result = await useConfigStore.getState().loadConfig('https://example.com/fallback.json')

    expect(result).toEqual({ success: true })
    expect(siteApi.homeContentAsync).toHaveBeenNthCalledWith(1, 'broken-site', true)
    expect(siteApi.homeContentAsync).toHaveBeenNthCalledWith(2, 'working-site', true)
    expect(useConfigStore.getState().currentSiteKey).toBe('working-site')
    expect(useConfigStore.getState().homeVideos[0].vod_id).toBe('fallback-vod')
  })

  it('skips empty home responses while selecting an initial site', async () => {
    vi.mocked(configApi.loadAsync).mockResolvedValue({
      success: true,
      data: {
        spider: '',
        sites: [
          { key: 'empty-site', name: '空站点', type: 1, api: 'https://empty.example/api', searchable: 1, changeable: 1 },
          { key: 'content-site', name: '内容站点', type: 1, api: 'https://content.example/api', searchable: 1, changeable: 1 }
        ]
      }
    })
    vi.mocked(siteApi.homeContentAsync)
      .mockResolvedValueOnce({ success: true, data: { class: [], filters: {}, list: [] } })
      .mockResolvedValueOnce({ success: true, data: { class: [], filters: {}, list: [{ vod_id: 'content-vod', vod_name: '内容', vod_pic: '', vod_remarks: '' }] } })

    const result = await useConfigStore.getState().loadConfig('https://example.com/empty-fallback.json')

    expect(result).toEqual({ success: true })
    expect(useConfigStore.getState().currentSiteKey).toBe('content-site')
    expect(useConfigStore.getState().homeVideos[0].vod_id).toBe('content-vod')
  })

  it('instantly renders content from 24h cache upon switchSite', async () => {
    const { setCachedSiteData } = await import('../src/renderer/src/services/sitePrefetchService')
    const configUrl = 'https://example.com/cached-test.json'
    useConfigStore.setState({ configUrl })

    await setCachedSiteData(configUrl, 'cached-site', {
      class: [{ type_id: 'cat-1', type_name: '电影' }],
      list: [{ vod_id: 'cached-vod-1', vod_name: '缓存的秒开电影', vod_pic: '', vod_remarks: '' }],
      cachedAt: Date.now()
    })

    // switchSite 应直接命中缓存并同步设为可用内容，无需等待慢速网络
    await useConfigStore.getState().switchSite('cached-site')
    const state = useConfigStore.getState()
    expect(state.currentSiteKey).toBe('cached-site')
    expect(state.contentSiteKey).toBe('cached-site')
    expect(state.homeVideos[0].vod_name).toBe('缓存的秒开电影')
    expect(state.isLoading).toBe(false)
  })

  it('marks site as offline in siteSpeeds when switchSite fails', async () => {
    vi.mocked(siteApi.homeContentAsync).mockRejectedValueOnce(new Error('站点连接超时'))
    vi.mocked(invoke).mockResolvedValue('https://example.com/speed-test.json')

    await useConfigStore.getState().switchSite('dead-site')
    const state = useConfigStore.getState()
    expect(state.currentSiteKey).toBe('dead-site')
    expect(state.contentSiteKey).toBe('')
    expect(state.error).toContain('站点连接超时')
    expect(state.siteSpeeds['dead-site']).toBeDefined()
    expect(state.siteSpeeds['dead-site'].ok).toBe(false)
  })

  it('manages isStartupReady state correctly to prevent UI flashing', () => {
    expect(useConfigStore.getState().isStartupReady).toBe(false)
    useConfigStore.getState().setStartupReady(true)
    expect(useConfigStore.getState().isStartupReady).toBe(true)
  })
})
