import { afterEach, describe, expect, it, vi } from 'vitest'

//  Mock cacheApi before importing playbackMetrics
const cacheStore = new Map<string, string>()
vi.mock('../src/renderer/src/utils/ipc', () => ({
  cacheApi: {
    get: vi.fn(async (key: string) => cacheStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => { cacheStore.set(key, value) }),
    del: vi.fn(async (key: string) => { cacheStore.delete(key) })
  }
}))

import {
  clearPlaybackMetrics,
  getPlaybackMetricSummary,
  recordPlaybackMetric
} from '../src/renderer/src/utils/playbackMetrics'

describe('playbackMetrics', () => {
  afterEach(() => {
    cacheStore.clear()
    vi.clearAllMocks()
  })

  it('summarizes first-frame percentiles and failure count', async () => {
    await recordPlaybackMetric({ type: 'first_frame', at: 1, elapsedMs: 1200 })
    await recordPlaybackMetric({ type: 'failure', at: 2, stage: 'manifest', errorKind: 'hls' })
    await recordPlaybackMetric({ type: 'first_frame', at: 3, elapsedMs: 3600 })
    await recordPlaybackMetric({ type: 'first_frame', at: 4, elapsedMs: 2400 })

    expect(await getPlaybackMetricSummary()).toEqual({
      totalFirstFrameSamples: 3,
      p50FirstFrameMs: 2400,
      p90FirstFrameMs: 3600,
      totalFailures: 1
    })
    const { cacheApi } = await import('../src/renderer/src/utils/ipc')
    expect(cacheApi.set).toHaveBeenCalledTimes(4)
  })

  it('is a no-op without storage', async () => {
    await expect(recordPlaybackMetric({ type: 'failure', at: 1 })).resolves.toBeUndefined()
    await expect(clearPlaybackMetrics()).resolves.toBeUndefined()
    expect(await getPlaybackMetricSummary()).toEqual({
      totalFirstFrameSamples: 0,
      p50FirstFrameMs: null,
      p90FirstFrameMs: null,
      totalFailures: 0
    })
  })
})