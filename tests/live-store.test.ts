import { describe, expect, it } from 'vitest'
import { normalizeLiveGroups } from '../src/renderer/src/stores/useLiveStore'

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
