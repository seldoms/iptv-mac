import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeChannelTree, normalizeLiveGroups, useLiveStore } from '../src/renderer/src/stores/useLiveStore'
import { liveApi } from '@/utils/ipc'

vi.mock('@/utils/ipc', () => ({ liveApi: { getChannelTree: vi.fn(), load: vi.fn(), loadByUrl: vi.fn(), epg: vi.fn() } }))

afterEach(() => {
  useLiveStore.getState().reset()
  vi.resetAllMocks()
})

function tree(channels: any[]) {
  return { countries: [{ name: '中国', categories: [{ name: '央视', channels }] }] }
}

describe('aggregated live cache', () => {
  it('preserves same-URL variants by normalized headers and ranks live lines first', () => {
    const groups = normalizeLiveGroups([{ name: '央视', channel: [{ name: 'CCTV-1', lines: [
      { url: 'https://a.test/live', header: { Authorization: 'Bearer A', Referer: 'https://a.test' }, latency: 5, alive: false },
      { url: 'https://a.test/live', header: { authorization: 'Bearer B', referer: 'https://a.test' }, latency: 80, alive: true },
      { url: 'https://a.test/live', header: { REFERER: 'https://a.test', AUTHORIZATION: 'Bearer B' }, latency: 40, alive: true }
    ] }] }])
    const channel = groups[0].channels[0]
    expect(channel.urls).toEqual(['https://a.test/live'])
    expect(channel.lines).toEqual([
      { url: 'https://a.test/live', header: { authorization: 'Bearer B', referer: 'https://a.test' }, latency: 40, alive: true },
      { url: 'https://a.test/live', header: { authorization: 'Bearer A', referer: 'https://a.test' }, latency: 5, alive: false }
    ])
  })

  it('merges same-URL lines from different channel records without losing authentication variants', () => {
    const groups = normalizeChannelTree(tree([
      { name: 'CCTV-1', lines: [{ url: 'https://a.test/live', header: { Cookie: 'account=A' }, latency: 70, alive: true }] },
      { name: 'CCTV-1', lines: [{ url: 'https://a.test/live', header: { Cookie: 'account=B' }, latency: 30, alive: true }] }
    ]))
    expect(groups[0].channels).toHaveLength(1)
    expect(groups[0].channels[0].lines?.map((line) => line.header.cookie)).toEqual(['account=B', 'account=A'])
    expect(groups[0].channels[0].lines?.map((line) => line.url)).toEqual(['https://a.test/live', 'https://a.test/live'])
  })

  it('retains legacy snapshot URL headers alongside new line variants', () => {
    const groups = normalizeChannelTree(tree([
      { name: 'CCTV-1', urls: ['https://a.test/live'], urlHeaders: { 'https://a.test/live': { Referer: 'https://legacy.test' } } },
      { name: 'CCTV-1', lines: [{ url: 'https://a.test/live', header: { Referer: 'https://new.test' }, latency: 30, alive: true }] }
    ]))
    expect(groups[0].channels[0].lines).toHaveLength(2)
    expect(groups[0].channels[0].lines?.map((line) => line.header.referer)).toEqual(['https://new.test', 'https://legacy.test'])
  })

  it('merges the same channel across groups with per-line headers and the fastest measured line', () => {
    const groups = normalizeChannelTree({ countries: [{ name: '中国', categories: [
      { name: '央视', channels: [{ name: ' CCTV-1 ', urls: ['https://a.test/live', 'https://a.test/live'], bestUrl: 'https://a.test/live', latency: 200, header: { Referer: 'https://a.test' } }] },
      { name: '其他', channels: [{ name: 'CCTV-1', urls: ['https://b.test/live'], bestUrl: 'https://b.test/live', latency: 30, urlHeaders: { 'https://b.test/live': { 'User-Agent': 'B' } } }] }
    ] }] })
    expect(groups.flatMap((group) => group.channels)).toHaveLength(1)
    expect(groups[0].channels[0]).toMatchObject({
      name: 'CCTV-1', urls: ['https://a.test/live', 'https://b.test/live'], bestUrl: 'https://b.test/live', latency: 30,
      urlHeaders: { 'https://a.test/live': { Referer: 'https://a.test' }, 'https://b.test/live': { 'User-Agent': 'B' } }
    })
  })

  it('loads cached channels without starting playback and preserves the playback object during updates', async () => {
    vi.mocked(liveApi.getChannelTree).mockResolvedValueOnce(tree([{ name: 'CCTV-1', urls: ['https://a.test/live'] }]))
    await useLiveStore.getState().loadChannelTree()
    expect(useLiveStore.getState().currentChannel).toBeNull()
    const playingChannel = useLiveStore.getState().channels[0]
    useLiveStore.getState().switchChannel(playingChannel)
    const epg = [{ title: '新闻', start: '12:00', end: '12:30' }]
    useLiveStore.setState({ epgData: epg })
    vi.mocked(liveApi.getChannelTree).mockResolvedValueOnce(tree([{ name: 'CCTV-1', urls: ['https://b.test/live'], bestUrl: 'https://b.test/live' }]))
    await useLiveStore.getState().loadChannelTree()
    const state = useLiveStore.getState()
    expect(state.channels[0].urls).toEqual(['https://b.test/live'])
    expect(state.currentChannel).toBe(playingChannel)
    expect(state.epgData).toBe(epg)
    expect(state.isPlaying).toBe(true)
    expect(state.currentGroup).toBe('中国 / 央视')
  })

  it('keeps cached channels usable after a failed refresh', async () => {
    vi.mocked(liveApi.getChannelTree).mockResolvedValueOnce(tree([{ name: 'CCTV-1', urls: ['https://a.test/live'] }]))
    await useLiveStore.getState().loadChannelTree()
    const cached = useLiveStore.getState().channels
    vi.mocked(liveApi.getChannelTree).mockRejectedValueOnce(new Error('缓存暂不可读'))
    await useLiveStore.getState().loadChannelTree()
    expect(useLiveStore.getState().channels).toBe(cached)
    expect(useLiveStore.getState().error).toBe('缓存暂不可读')
    expect(useLiveStore.getState().isLoading).toBe(false)
  })

  it('browses groups without replacing the playing channel', async () => {
    vi.mocked(liveApi.getChannelTree).mockResolvedValue({ countries: [{ name: '中国', categories: [
      { name: '央视', channels: [{ name: 'CCTV-1', urls: ['https://a.test/live'] }] },
      { name: '卫视', channels: [{ name: '卫视', urls: ['https://b.test/live'] }] }
    ] }] })
    await useLiveStore.getState().loadChannelTree()
    const channel = useLiveStore.getState().channels[0]
    useLiveStore.getState().switchChannel(channel)
    useLiveStore.getState().switchGroup('中国 / 卫视')
    expect(useLiveStore.getState().channels[0].name).toBe('卫视')
    expect(useLiveStore.getState().currentChannel).toBe(channel)
    await useLiveStore.getState().loadChannelTree()
    expect(useLiveStore.getState().currentGroup).toBe('中国 / 卫视')
    expect(useLiveStore.getState().currentChannel).toBe(channel)
  })

  it('ignores an older cache read that completes after a newer snapshot', async () => {
    let resolveOld!: (value: unknown) => void
    vi.mocked(liveApi.getChannelTree).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    const olderRead = useLiveStore.getState().loadChannelTree()
    vi.mocked(liveApi.getChannelTree).mockResolvedValueOnce(tree([{ name: '新版频道', urls: ['https://new.test/live'] }]))
    await useLiveStore.getState().loadChannelTree()
    resolveOld(tree([{ name: '旧版频道', urls: ['https://old.test/live'] }]))
    await olderRead
    expect(useLiveStore.getState().channels[0].name).toBe('新版频道')
  })
})

describe('normalizeLiveGroups', () => {
  it('preserves playback headers, measured source metadata and EPG fields', () => {
    const groups = normalizeLiveGroups([{
      name: '央视',
      channel: [{
        name: 'CCTV-1',
        urls: ['https://example.test/live.m3u8'],
        ua: 'TestAgent',
        referer: 'https://example.test/',
        header: { 'X-Test': 'yes' },
        tvgId: 'cctv1',
        epgUrl: 'https://example.test/epg.xml',
        bestUrl: 'https://example.test/live.m3u8',
        latency: 88
      }]
    }])

    expect(groups[0].channels[0]).toMatchObject({
      epgId: 'cctv1',
      epgUrl: 'https://example.test/epg.xml',
      bestUrl: 'https://example.test/live.m3u8',
      latency: 88,
      urlHeaders: {
        'https://example.test/live.m3u8': {
          'User-Agent': 'TestAgent',
          Referer: 'https://example.test/',
          'X-Test': 'yes'
        }
      }
    })
  })
})
