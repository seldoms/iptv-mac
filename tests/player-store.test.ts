import { afterEach, describe, expect, it } from 'vitest'
import { usePlayerStore } from '../src/renderer/src/stores/usePlayerStore'

describe('usePlayerStore playback diagnostics', () => {
  afterEach(() => {
    usePlayerStore.getState().reset()
  })

  it('records parse failures as structured diagnostics', () => {
    const store = usePlayerStore.getState()
    store.setVod({
      vod_id: 'vod-1',
      vod_name: '测试影片',
      vod_pic: ''
    }, [{ name: '第1集', url: 'parse-target' }], 0, '__resolving__', undefined, 'site-a')

    store.setPlaybackError('解析失败：未找到可播放地址', {
      stage: 'parse',
      errorKind: 'parse_failed',
      sourceId: 'site-a::vod-1',
      nextAction: '自动尝试下一个备选源'
    })

    const state = usePlayerStore.getState()
    expect(state.playbackPhase).toBe('failed')
    expect(state.playbackMessage).toBe('解析失败')
    expect(state.playbackDiagnostic).toMatchObject({
      stage: 'parse',
      errorKind: 'parse_failed',
      sourceId: 'site-a::vod-1',
      nextAction: '自动尝试下一个备选源'
    })
  })

  it('includes source attempt counts and clears diagnostics after first frame', () => {
    const store = usePlayerStore.getState()
    store.setAlternativeSources([
      { siteKey: 'site-b', siteName: '站点B', vodId: 'vod-b', vodName: '测试影片' },
      { siteKey: 'site-c', siteName: '站点C', vodId: 'vod-c', vodName: '测试影片' }
    ])
    store.markCurrentSourceBroken('site-a', 'vod-a')
    store.setPlaybackError('HLS主清单加载失败', {
      stage: 'manifest',
      errorKind: 'hls',
      protocol: 'hls'
    })

    let state = usePlayerStore.getState()
    expect(state.playbackDiagnostic?.attempt).toBe(2)
    expect(state.playbackDiagnostic?.sourceCount).toBe(4)

    store.markPlaybackFirstFrame()
    state = usePlayerStore.getState()
    expect(state.playbackPhase).toBe('playing')
    expect(state.playbackDiagnostic).toBeNull()
    expect(state.playbackError).toBe('')
  })

  it('keeps resume position and source name when selecting an episode', () => {
    const store = usePlayerStore.getState()
    store.setVod({
      vod_id: 'vod-1',
      vod_name: '测试影片',
      vod_pic: ''
    }, [
      { name: '第1集', url: 'https://example.com/1.m3u8' },
      { name: '第2集', url: 'https://example.com/2.m3u8' }
    ], 2, 'https://example.com/1.m3u8', undefined, 'site-a', '高清线路', 125)

    store.setCurrentEpisodeIndex(1, 'https://example.com/2.m3u8', 366)

    const state = usePlayerStore.getState()
    expect(state.currentSourceIndex).toBe(2)
    expect(state.currentSourceName).toBe('高清线路')
    expect(state.currentEpisodeIndex).toBe(1)
    expect(state.currentTime).toBe(366)
  })
})
