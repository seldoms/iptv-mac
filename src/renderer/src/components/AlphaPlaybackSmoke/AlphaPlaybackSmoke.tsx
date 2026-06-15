import { useEffect, useRef, useState } from 'react'
import VideoPlayer from '@/components/VideoPlayer/VideoPlayer'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { settingsApi } from '@/utils/ipc'
import { getPlayableMediaUrl } from '@/utils/media'
import { clearPlaybackMetrics, getPlaybackMetricSummary } from '@/utils/playbackMetrics'

export interface AlphaPlaybackSmokeConfig {
  enabled: boolean
  mediaUrl?: string
  timeoutMs?: number
}

interface AlphaPlaybackSmokeResult {
  ok: boolean
  at: string
  elapsedMs?: number
  phase: string
  message: string
  error?: string
  diagnostic?: unknown
  metrics: ReturnType<typeof getPlaybackMetricSummary>
  debug?: unknown
  mediaUrl: string
  userAgent: string
}

const RESULT_KEY = '__alphaPlaybackSmokeResult'
const DEFAULT_MEDIA_URL = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
const DEFAULT_TIMEOUT_MS = 20000

export default function AlphaPlaybackSmoke({ config }: { config: AlphaPlaybackSmokeConfig }) {
  const wroteResultRef = useRef(false)
  const [lastResult, setLastResult] = useState<AlphaPlaybackSmokeResult | null>(null)
  const {
    playbackPhase,
    playbackMessage,
    playbackError,
    playbackStartedAt,
    playbackFirstFrameAt,
    playbackDiagnostic,
    setVod,
    setVolume,
    reset
  } = usePlayerStore()

  const mediaUrl = config.mediaUrl || DEFAULT_MEDIA_URL
  const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS

  useEffect(() => {
    let cancelled = false
    clearPlaybackMetrics()
    reset()
    setVolume(0)
    const startPlayback = async () => {
      const playableUrl = await getPlayableMediaUrl(mediaUrl)
      if (cancelled) return
      setVod(
        {
          vod_id: 'alpha-smoke',
          vod_name: 'Alpha 2.1 Playback Smoke',
          vod_pic: '',
          vod_remarks: '自动首帧验证'
        },
        [{ name: '首帧验证', url: playableUrl }],
        0,
        playableUrl,
        undefined,
        'alpha-smoke'
      )
    }
    void startPlayback()
    return () => {
      cancelled = true
    }
  }, [mediaUrl, reset, setVod, setVolume])

  useEffect(() => {
    if (wroteResultRef.current) return

    const timer = window.setTimeout(() => {
      if (!wroteResultRef.current) {
        void writeResult(false, `首帧超时: ${timeoutMs}ms`)
      }
    }, timeoutMs)

    return () => window.clearTimeout(timer)
  }, [timeoutMs])

  useEffect(() => {
    if (wroteResultRef.current) return
    if (playbackFirstFrameAt > 0) {
      const elapsedMs = playbackStartedAt ? Math.max(0, playbackFirstFrameAt - playbackStartedAt) : undefined
      void writeResult(true, '首帧播放成功', elapsedMs)
    } else if (playbackPhase === 'failed') {
      void writeResult(false, playbackError || playbackMessage || '播放失败')
    }
  }, [playbackError, playbackFirstFrameAt, playbackMessage, playbackPhase, playbackStartedAt])

  async function writeResult(ok: boolean, message: string, elapsedMs?: number) {
    wroteResultRef.current = true
    const result: AlphaPlaybackSmokeResult = {
      ok,
      at: new Date().toISOString(),
      elapsedMs,
      phase: usePlayerStore.getState().playbackPhase,
      message,
      error: usePlayerStore.getState().playbackError || undefined,
      diagnostic: usePlayerStore.getState().playbackDiagnostic || undefined,
      metrics: getPlaybackMetricSummary(),
      debug: window.__alphaPlaybackDebug,
      mediaUrl,
      userAgent: navigator.userAgent
    }
    setLastResult(result)
    await settingsApi.set(RESULT_KEY, result)
  }

  return (
    <div className="h-screen w-screen bg-black text-white">
      <VideoPlayer />
      <div className="fixed left-4 top-4 z-50 max-w-lg rounded-md border border-white/20 bg-black/80 p-3 text-xs">
        <div className="font-medium">Alpha 2.1 Playback Smoke</div>
        <div className="mt-1 text-white/70">phase={playbackPhase}</div>
        <div className="mt-1 text-white/70">message={playbackMessage || '-'}</div>
        <div className="mt-1 text-white/70">firstFrame={playbackFirstFrameAt ? 'yes' : 'no'}</div>
        {lastResult && (
          <div className={lastResult.ok ? 'mt-2 text-green-300' : 'mt-2 text-red-300'}>
            {lastResult.ok ? 'PASS' : 'FAIL'} {lastResult.elapsedMs ? `${lastResult.elapsedMs}ms` : ''}
          </div>
        )}
      </div>
    </div>
  )
}
