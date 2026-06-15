import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPlaybackMetrics,
  getPlaybackMetricSummary,
  recordPlaybackMetric
} from '../src/renderer/src/utils/playbackMetrics'

function installWindowStorage() {
  const values = new Map<string, string>()
  const localStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key)
    })
  }

  vi.stubGlobal('window', { localStorage })
  return localStorage
}

describe('playbackMetrics', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('summarizes first-frame percentiles and failure count', () => {
    const localStorage = installWindowStorage()

    recordPlaybackMetric({ type: 'first_frame', at: 1, elapsedMs: 1200 })
    recordPlaybackMetric({ type: 'failure', at: 2, stage: 'manifest', errorKind: 'hls' })
    recordPlaybackMetric({ type: 'first_frame', at: 3, elapsedMs: 3600 })
    recordPlaybackMetric({ type: 'first_frame', at: 4, elapsedMs: 2400 })

    expect(getPlaybackMetricSummary()).toEqual({
      totalFirstFrameSamples: 3,
      p50FirstFrameMs: 2400,
      p90FirstFrameMs: 3600,
      totalFailures: 1
    })
    expect(localStorage.setItem).toHaveBeenCalledTimes(4)
  })

  it('is a no-op without browser storage', () => {
    expect(() => recordPlaybackMetric({ type: 'failure', at: 1 })).not.toThrow()
    expect(() => clearPlaybackMetrics()).not.toThrow()
    expect(getPlaybackMetricSummary()).toEqual({
      totalFirstFrameSamples: 0,
      p50FirstFrameMs: null,
      p90FirstFrameMs: null,
      totalFailures: 0
    })
  })
})
