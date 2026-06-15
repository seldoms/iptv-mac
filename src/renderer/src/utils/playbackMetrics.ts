const STORAGE_KEY = 'iptv:playback-metrics:v1'
const MAX_SAMPLES = 200

export interface PlaybackMetricSample {
  type: 'first_frame' | 'failure'
  at: number
  elapsedMs?: number
  phase?: string
  errorKind?: string
  stage?: string
  protocol?: string
  sourceId?: string
}

export interface PlaybackMetricSummary {
  totalFirstFrameSamples: number
  p50FirstFrameMs: number | null
  p90FirstFrameMs: number | null
  totalFailures: number
}

function readSamples(): PlaybackMetricSample[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isSample) : []
  } catch {
    return []
  }
}

function isSample(value: unknown): value is PlaybackMetricSample {
  if (!value || typeof value !== 'object') return false
  const sample = value as PlaybackMetricSample
  return (sample.type === 'first_frame' || sample.type === 'failure') && typeof sample.at === 'number'
}

export function recordPlaybackMetric(sample: PlaybackMetricSample): void {
  if (typeof window === 'undefined') return
  try {
    const samples = [...readSamples(), sample].slice(-MAX_SAMPLES)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(samples))
  } catch {
    // Metrics should never interrupt playback.
  }
}

export function getPlaybackMetricSummary(): PlaybackMetricSummary {
  const samples = readSamples()
  const firstFrameMs = samples
    .filter((sample) => sample.type === 'first_frame' && typeof sample.elapsedMs === 'number')
    .map((sample) => sample.elapsedMs as number)
    .sort((a, b) => a - b)

  return {
    totalFirstFrameSamples: firstFrameMs.length,
    p50FirstFrameMs: percentile(firstFrameMs, 0.5),
    p90FirstFrameMs: percentile(firstFrameMs, 0.9),
    totalFailures: samples.filter((sample) => sample.type === 'failure').length
  }
}

export function clearPlaybackMetrics(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore storage failures.
  }
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null
  const index = Math.round((values.length - 1) * percentileValue)
  return values[index] ?? null
}
