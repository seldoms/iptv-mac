import { cacheApi } from './ipc'

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

async function readSamples(): Promise<PlaybackMetricSample[]> {
  try {
    const raw = await cacheApi.get(STORAGE_KEY) as string | null
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

export async function recordPlaybackMetric(sample: PlaybackMetricSample): Promise<void> {
  try {
    const samples = [...await readSamples(), sample].slice(-MAX_SAMPLES)
    await cacheApi.set(STORAGE_KEY, JSON.stringify(samples))
  } catch {
    // Metrics should never interrupt playback.
  }
}

export async function getPlaybackMetricSummary(): Promise<PlaybackMetricSummary> {
  const samples = await readSamples()
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

export async function clearPlaybackMetrics(): Promise<void> {
  try {
    await cacheApi.del(STORAGE_KEY)
  } catch {
    // Ignore storage failures.
  }
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null
  const index = Math.round((values.length - 1) * percentileValue)
  return values[index] ?? null
}