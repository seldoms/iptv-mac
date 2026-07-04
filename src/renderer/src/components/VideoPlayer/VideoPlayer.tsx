import { useRef, useEffect, useCallback, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import Hls from 'hls.js'
import dashjs from 'dashjs'
import { usePlayerStore } from '@/stores/usePlayerStore'
import DanmakuLayer from '@/components/DanmakuLayer/DanmakuLayer'
import SubtitleLayer from '@/components/SubtitleLayer/SubtitleLayer'
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  SkipBack,
  SkipForward,
  MessageSquare,
  PictureInPicture2,
  Monitor,
  Loader2,
  ClipboardList,
  Copy,
  X,
  RotateCw,
  Shuffle
} from 'lucide-react'
import { historyApi, windowApi } from '@/utils/ipc'
import { redactHeaders, redactText } from '@/utils/redact'
import { getPlaybackMetricSummary, recordPlaybackMetric } from '@/utils/playbackMetrics'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
const MAX_HLS_NETWORK_RECOVERY_ATTEMPTS = 3
const MAX_HLS_MEDIA_RECOVERY_ATTEMPTS = 2
const MAX_HLS_DEBUG_EVENTS = 20
const HISTORY_SAVE_INTERVAL_MS = 15_000
const LOAD_TIMEOUT_MS = 25000

declare global {
  interface Window {
    __alphaPlaybackDebug?: {
      protocol?: string
      url?: string
      events: Array<Record<string, unknown>>
    }
  }
}

interface StreamStats {
  bitrateKbps: number | null
  linkSpeedKbps: number | null
  updatedAt: number
}

const emptyStreamStats: StreamStats = {
  bitrateKbps: null,
  linkSpeedKbps: null,
  updatedAt: 0
}

function formatThroughput(kbps: number | null): string {
  if (!kbps || !Number.isFinite(kbps) || kbps <= 0) return '--'
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(kbps >= 10000 ? 0 : 1)} Mbps`
  return `${Math.round(kbps)} Kbps`
}

function inferProtocol(url: string): 'hls' | 'dash' | 'native' | 'unknown' {
  if (!url) return 'unknown'
  const candidates = [url]
  try {
    const nestedUrl = new URL(url).searchParams.get('url')
    if (nestedUrl) candidates.unshift(nestedUrl)
  } catch {
    // Keep the original string fallback for non-URL values.
  }
  if (candidates.some((candidate) => /\.m3u8(?:$|[?&#])/i.test(candidate))) return 'hls'
  if (candidates.some((candidate) => /\.mpd(?:$|[?&#])/i.test(candidate))) return 'dash'
  if (candidates.some((candidate) => /\.(mp4|m4v|webm|mov|flv|ts)(?:$|[?&#])/i.test(candidate))) return 'native'
  return 'unknown'
}

function appendHlsDebugEvent(event: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  const debug = window.__alphaPlaybackDebug || { events: [] }
  debug.events = [...debug.events, { at: Date.now(), ...event }].slice(-MAX_HLS_DEBUG_EVENTS)
  window.__alphaPlaybackDebug = debug
}

function formatUrlIdentifier(url: string): string {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    const nested = parsed.searchParams.get('url')
    const target = nested ? new URL(nested) : parsed
    return `${target.hostname}${target.pathname}`.slice(0, 240)
  } catch {
    return url.split('?')[0].slice(0, 240)
  }
}

export default function VideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const dashRef = useRef<dashjs.MediaPlayerClass | null>(null)
  const hideTimerRef = useRef<number>(0)
  /** 加载启动时间，用于判断加载超时 */
  const loadStartTimeRef = useRef<number>(0)
  /** 是否已触发过失败事件，防止重复触发 */
  const failureReportedRef = useRef<boolean>(false)
  /** 加载超时定时器 ID */
  const loadTimeoutRef = useRef<number>(0)
  /** 是否已实际开始播放（用 ref 而非 state，避免触发 effect 重跑） */
  const hasPlaybackStartedRef = useRef<boolean>(false)
  /** 当前正在播放的 URL（用于判断是否需要重新加载） */
  const loadedUrlRef = useRef<string>('')
  /** 上一个 HLS 分片加载完成时间，用于估算链路速度 */
  const lastFragLoadedAtRef = useRef<number>(0)
  /** stalled 防抖定时器 - 持续停滞超过阈值才显示覆盖层 */
  const stalledTimerRef = useRef<number>(0)
  const pendingSeekRef = useRef<number>(0)
  const lastHistorySaveAtRef = useRef<number>(0)

  // 用 ref 缓存 store 中的 siteKey/vodId，避免 reportPlayFailure 引用变化导致 effect 重跑
  const currentSiteKeyRef = useRef<string>('')
  const currentVodIdRef = useRef<string>('')

  const {
    isPlaying, currentUrl, playKey, currentTime, duration, speed, volume,
    isDanmakuOn, isFullscreen, episodes, currentEpisodeIndex, currentSourceIndex,
    playHeader, currentSiteKey, currentVod, playbackPhase, playbackMessage, playbackError,
    playbackStartedAt, playbackFirstFrameAt, playbackLastErrorAt, playbackDiagnostic,
    alternativeSources, brokenSources, sourceSwitchState, sourceSwitchMessage, autoSwitchSource,
    setIsPlaying, setCurrentTime, setDuration, setSpeed, setVolume,
    toggleDanmaku, toggleFullscreen, nextEpisode, prevEpisode,
    setPlaybackPhase, markPlaybackFirstFrame, setAutoSwitchSource
  } = usePlayerStore()

  // 同步 siteKey/vodId 到 ref（变化时不影响 effect）
  useEffect(() => {
    currentSiteKeyRef.current = currentSiteKey || ''
    currentVodIdRef.current = currentVod?.vod_id || ''
  }, [currentSiteKey, currentVod?.vod_id])

  useEffect(() => {
    const target = usePlayerStore.getState().currentTime
    pendingSeekRef.current = target > 3 ? target : 0
    lastHistorySaveAtRef.current = 0
  }, [currentUrl, playKey])

  const [showControls, setShowControls] = useState(true)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [isDragging, setIsDragging] = useState(false)
  const [isActualFullscreen, setIsActualFullscreen] = useState(false)
  const [miniTransitionStyle, setMiniTransitionStyle] = useState<CSSProperties | null>(null)
  const [streamStats, setStreamStats] = useState<StreamStats>(emptyStreamStats)

  // ==================== 换源：触发失败事件 ====================
  // 稳定的 ref 函数，不依赖外部 state 变化
  const reportPlayFailureRef = useRef((reason: string) => {
    if (failureReportedRef.current) return
    failureReportedRef.current = true
    const siteKey = currentSiteKeyRef.current
    const vodId = currentVodIdRef.current
    const store = usePlayerStore.getState()
    const elapsedMs = store.playbackStartedAt ? Math.max(0, Date.now() - store.playbackStartedAt) : undefined
    const protocol = inferProtocol(store.currentUrl)
    const lowerReason = reason.toLowerCase()
    const stage = reason.includes('清单') || reason.includes('MANIFEST') || lowerReason.includes('manifest')
      ? 'manifest'
      : reason.includes('超时') || lowerReason.includes('timeout')
        ? 'connect'
        : reason.includes('媒体') || reason.includes('视频')
          ? 'media'
          : reason.includes('网络') || lowerReason.includes('network')
            ? 'network'
            : protocol === 'hls'
              ? 'manifest'
              : 'unknown'
    const errorKind = reason.includes('超时') || lowerReason.includes('timeout')
      ? 'timeout'
      : protocol === 'hls' || lowerReason.includes('hls')
        ? 'hls'
        : reason.includes('媒体') || reason.includes('视频')
          ? 'media'
          : 'unknown'
    console.error('[VideoPlayer] 播放失败:', reason, 'siteKey:', siteKey, 'vodId:', vodId)
    store.setPlaybackError(reason, {
      stage,
      errorKind,
      protocol,
      elapsedMs,
      sourceId: siteKey && vodId ? `${siteKey}::${vodId}` : undefined,
      nextAction: store.autoSwitchSource ? '自动尝试下一条可用线路' : '可手动重试或切换线路'
    })
    recordPlaybackMetric({
      type: 'failure',
      at: Date.now(),
      elapsedMs,
      phase: store.playbackPhase,
      stage,
      errorKind,
      protocol,
      sourceId: siteKey && vodId ? `${siteKey}::${vodId}` : undefined
    })
    const detail = { siteKey, vodId, reason, autoSwitch: true, diagnostic: usePlayerStore.getState().playbackDiagnostic }
    window.dispatchEvent(new CustomEvent(siteKey || vodId ? 'vod:playFailed' : 'live:playFailed', { detail }))
  })

  // 清除加载超时的工具函数
  const clearLoadTimeout = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current)
      loadTimeoutRef.current = 0
    }
  }, [])

  const clearStalledTimer = useCallback(() => {
    if (stalledTimerRef.current) {
      clearTimeout(stalledTimerRef.current)
      stalledTimerRef.current = 0
    }
  }, [])
  const resetPlaybackPhase = useCallback(() => {
    setPlaybackPhase('playing', '')
  }, [setPlaybackPhase])

  const markPlaybackStarted = useCallback(() => {
    if (hasPlaybackStartedRef.current) return
    hasPlaybackStartedRef.current = true
    const video = videoRef.current
    console.log(
      '[VideoPlayer] 首帧播放成功:',
      `time=${video?.currentTime.toFixed(2) || '0.00'}`,
      `size=${video?.videoWidth || 0}x${video?.videoHeight || 0}`
    )
    markPlaybackFirstFrame()
    const store = usePlayerStore.getState()
    const elapsedMs = store.playbackStartedAt ? Math.max(0, Date.now() - store.playbackStartedAt) : undefined
    recordPlaybackMetric({
      type: 'first_frame',
      at: Date.now(),
      elapsedMs,
      phase: store.playbackPhase,
      protocol: inferProtocol(store.currentUrl),
      sourceId: store.currentSiteKey && store.currentVod ? `${store.currentSiteKey}::${store.currentVod.vod_id}` : undefined
    })
    clearLoadTimeout()
    clearStalledTimer()
  }, [clearLoadTimeout, clearStalledTimer, markPlaybackFirstFrame])

  const applyPendingSeek = useCallback(() => {
    const video = videoRef.current
    const target = pendingSeekRef.current
    if (!video || target <= 3) return
    // 直接 seek 到目标位置。浏览器/HLS 会在数据加载后自动处理 seek。
    // 不检查 duration 是因为 HLS 的 duration 可能为 Infinity 或 0（尚未解析完毕）。
    video.currentTime = target
    pendingSeekRef.current = 0
  }, [])

  const savePlaybackHistory = useCallback((force = false, completedOverride?: boolean) => {
    const video = videoRef.current
    const store = usePlayerStore.getState()
    const vod = store.currentVod
    if (!vod || !store.currentSiteKey || !store.currentUrl || store.currentUrl === '__resolving__') return

    const now = Date.now()
    if (!force && now - lastHistorySaveAtRef.current < HISTORY_SAVE_INTERVAL_MS) return

    const rawDuration = video?.duration || store.duration || 0
    const durationSeconds = Number.isFinite(rawDuration) ? Math.max(0, Math.round(rawDuration)) : 0
    const rawPosition = video?.currentTime ?? store.currentTime
    const positionSeconds = Number.isFinite(rawPosition) ? Math.max(0, Math.round(rawPosition)) : 0
    if (!force && positionSeconds < 5) return

    const completed = completedOverride ?? (durationSeconds > 0 && positionSeconds / durationSeconds >= 0.95)
    const savedPosition = completed ? 0 : positionSeconds
    const progress = durationSeconds > 0
      ? Math.max(0, Math.min(100, Math.round((positionSeconds / durationSeconds) * 100)))
      : 0
    const episode = store.episodes[store.currentEpisodeIndex]
    const sourceName = store.currentSourceName || `线路 ${store.currentSourceIndex + 1}`
    const episodeName = episode?.name || `第 ${store.currentEpisodeIndex + 1} 集`

    lastHistorySaveAtRef.current = now
    historyApi.add({
      siteKey: store.currentSiteKey,
      vodId: vod.vod_id,
      vodName: vod.vod_name,
      vodPic: vod.vod_pic,
      vodRemarks: vod.vod_remarks,
      source: `${sourceName} · ${episodeName}`,
      progress: completed ? 100 : progress,
      episodeId: String(store.currentEpisodeIndex),
      episodeName,
      episodeIndex: store.currentEpisodeIndex,
      sourceIndex: store.currentSourceIndex,
      sourceName,
      urlIdentifier: formatUrlIdentifier(store.currentUrl),
      duration: durationSeconds,
      positionSeconds: savedPosition,
      completed
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const handleFlushHistory = () => savePlaybackHistory(true)
    window.addEventListener('player:flushHistory', handleFlushHistory)
    return () => window.removeEventListener('player:flushHistory', handleFlushHistory)
  }, [savePlaybackHistory])

  useEffect(() => {
    return () => savePlaybackHistory(true)
  }, [savePlaybackHistory])

  // 进入精简模式
  const handleEnterMiniMode = useCallback(async () => {
    if (!currentUrl) return
    if (miniTransitionStyle) return
    const video = videoRef.current
    const container = containerRef.current
    const savedTime = video?.currentTime || currentTime
    const rect = container?.getBoundingClientRect()

    if (rect) {
      const targetWidth = Math.min(480, Math.max(320, window.innerWidth - 48))
      const targetHeight = 300
      const targetLeft = Math.max(16, window.innerWidth - targetWidth - 24)
      const targetTop = Math.max(16, window.innerHeight - targetHeight - 24)
      const scaleX = targetWidth / rect.width
      const scaleY = targetHeight / rect.height

      setMiniTransitionStyle({
        position: 'fixed',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        zIndex: 9999,
        overflow: 'hidden',
        transform: 'translate3d(0, 0, 0) scale(1)',
        transformOrigin: 'top left',
        transition: 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), border-radius 220ms ease, box-shadow 220ms ease',
        borderRadius: 0,
        boxShadow: '0 0 0 rgba(0, 0, 0, 0)'
      })

      requestAnimationFrame(() => {
        setMiniTransitionStyle((style) => style
          ? {
              ...style,
              transform: `translate3d(${targetLeft - rect.left}px, ${targetTop - rect.top}px, 0) scale(${scaleX}, ${scaleY})`,
              borderRadius: 10,
              boxShadow: '0 18px 60px rgba(0, 0, 0, 0.45)'
            }
          : style)
      })
    }

    try {
      await Promise.all([
        windowApi.savePlayerState({ url: currentUrl, header: playHeader || undefined, currentTime: savedTime }),
        new Promise((resolve) => window.setTimeout(resolve, rect ? 230 : 0))
      ])
      await windowApi.enterMiniMode()
      const url = new URL(window.location.href)
      url.searchParams.set('mode', 'mini')
      window.history.replaceState(null, '', url.toString())
      window.dispatchEvent(new CustomEvent('app:miniModeChanged', { detail: true }))
    } catch (err) {
      console.error('[VideoPlayer] 进入精简模式失败:', err)
      setMiniTransitionStyle(null)
    }
  }, [currentUrl, playHeader, currentTime, miniTransitionStyle])

  // 初始化播放器 - 仅在 URL/header 变化时重跑
  useEffect(() => {
    const video = videoRef.current
    if (!video || !currentUrl) return
    const currentProtocol = inferProtocol(currentUrl)
    window.__alphaPlaybackDebug = {
      protocol: currentProtocol,
      url: currentUrl,
      events: []
    }

    // 清理旧实例
    hlsRef.current?.destroy()
    dashRef.current?.reset()
    hlsRef.current = null
    dashRef.current = null
    video.pause()
    video.removeAttribute('src')
    video.muted = volume <= 0
    video.volume = volume
    video.playbackRate = speed
    video.load()

    // 重置失败标记和播放标记
    failureReportedRef.current = false
    hasPlaybackStartedRef.current = false
    lastFragLoadedAtRef.current = 0
    setStreamStats(emptyStreamStats)
    loadStartTimeRef.current = Date.now()
    setPlaybackPhase('connecting', '正在连接播放地址...')
    clearLoadTimeout()

    // 关键修复：重置 loadedUrlRef，确保新的播放会话能被正确处理
    // 之前这里不重置导致同 URL 切换频道时无法触发重新加载
    loadedUrlRef.current = currentUrl

    // 启动加载超时检测（25秒无任何播放进度视为失败）
    loadTimeoutRef.current = window.setTimeout(() => {
      if (!failureReportedRef.current && !hasPlaybackStartedRef.current) {
        console.error('[VideoPlayer] 加载超时（25秒）')
        reportPlayFailureRef.current('加载超时（25秒）')
      }
    }, LOAD_TIMEOUT_MS)

    let hlsRecoveryTimer = 0

    if (currentProtocol === 'dash') {
      // DASH
      const player = dashjs.MediaPlayer().create()
      player.initialize(video, currentUrl, true)
      dashRef.current = player
    } else if (currentProtocol === 'hls' && Hls.isSupported()) {
      let networkRecoveryAttempts = 0
      let mediaRecoveryAttempts = 0

      // 优先使用 HLS.js
      const hls = new Hls({
        // 桌面 WebView 的 CSP 不允许 blob worker；主线程解析可避免创建失败导致黑屏。
        enableWorker: false,
        testBandwidth: false,
        startFragPrefetch: true,
        startLevel: 0,
        maxBufferLength: 10,
        maxMaxBufferLength: 30,
        xhrSetup: (xhr, _url) => {
          if (playHeader) {
            for (const [key, value] of Object.entries(playHeader)) {
              xhr.setRequestHeader(key, value)
            }
          }
        }
      })
      hls.loadSource(currentUrl)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_LOADED, (_event, data) => {
        appendHlsDebugEvent({
          event: 'manifest_loaded',
          levels: data.levels?.length,
          audioTracks: data.audioTracks?.length,
          subtitles: data.subtitles?.length
        })
      })
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('[VideoPlayer] HLS manifest 解析成功')
        appendHlsDebugEvent({ event: 'manifest_parsed', levels: hls.levels.length })
        setPlaybackPhase('buffering', '清单已加载，正在缓冲...')
        video.play().catch(() => {})
      })
      hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
        appendHlsDebugEvent({
          event: 'level_loaded',
          level: data.level,
          fragments: data.details?.fragments?.length,
          live: data.details?.live,
          targetduration: data.details?.targetduration
        })
      })
      hls.on(Hls.Events.FRAG_LOADING, (_event, data) => {
        appendHlsDebugEvent({
          event: 'frag_loading',
          sn: data.frag?.sn,
          level: data.frag?.level,
          type: data.frag?.type,
          duration: data.frag?.duration
        })
      })
      hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
        appendHlsDebugEvent({
          event: 'frag_loaded',
          sn: data.frag?.sn,
          level: data.frag?.level,
          type: data.frag?.type,
          payloadBytes: data.payload?.byteLength || 0
        })
        networkRecoveryAttempts = 0
        const now = performance.now()
        const payloadBytes = data.payload?.byteLength || 0
        const elapsedMs = lastFragLoadedAtRef.current ? now - lastFragLoadedAtRef.current : 0
        const fragmentDuration = data.part?.duration || data.frag?.duration || 0
        const currentLevel = hls.levels[hls.currentLevel]
        const levelBitrateKbps = currentLevel?.bitrate ? currentLevel.bitrate / 1000 : null
        const fragmentBitrateKbps = payloadBytes && fragmentDuration > 0
          ? (payloadBytes * 8) / fragmentDuration / 1000
          : null
        const hlsBandwidthKbps = hls.bandwidthEstimate ? hls.bandwidthEstimate / 1000 : null
        const linkSpeedKbps = payloadBytes && elapsedMs > 100
          ? (payloadBytes * 8) / (elapsedMs / 1000) / 1000
          : null

        lastFragLoadedAtRef.current = now
        setStreamStats((prev) => ({
          bitrateKbps: levelBitrateKbps || fragmentBitrateKbps || prev.bitrateKbps,
          linkSpeedKbps: hlsBandwidthKbps || linkSpeedKbps || prev.linkSpeedKbps,
          updatedAt: Date.now()
        }))
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.error('[VideoPlayer] HLS错误:', data.type, data.details, data.fatal)
        appendHlsDebugEvent({
          event: 'hls_error',
          type: data.type,
          details: data.details,
          fatal: data.fatal,
          responseCode: data.response?.code,
          responseText: data.response?.text,
          reason: data.error?.message
        })
        if (failureReportedRef.current) return

        if (
          !data.fatal &&
          video.currentTime <= 0 &&
          (
            data.details === Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT ||
            data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR
          )
        ) {
          hls.stopLoad()
          reportPlayFailureRef.current(`HLS首帧加载失败: ${data.details}`)
          return
        }

        if (!data.fatal) return

        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR: {
            if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR) {
              hls.stopLoad()
              reportPlayFailureRef.current('HLS主清单加载失败')
              return
            }
            networkRecoveryAttempts++
            if (networkRecoveryAttempts > MAX_HLS_NETWORK_RECOVERY_ATTEMPTS) {
              hls.stopLoad()
              reportPlayFailureRef.current(`HLS网络错误重试${MAX_HLS_NETWORK_RECOVERY_ATTEMPTS}次仍失败`)
              return
            }
            if (hlsRecoveryTimer) return
            const delay = networkRecoveryAttempts * 750
            console.warn(`[VideoPlayer] HLS网络错误，第${networkRecoveryAttempts}次恢复，${delay}ms 后重试`)
            setPlaybackPhase('recovering', `网络波动，正在第 ${networkRecoveryAttempts} 次恢复...`)
            hlsRecoveryTimer = window.setTimeout(() => {
              hlsRecoveryTimer = 0
              if (!failureReportedRef.current) hls.startLoad()
            }, delay)
            break
          }
          case Hls.ErrorTypes.MEDIA_ERROR:
            mediaRecoveryAttempts++
            if (mediaRecoveryAttempts > MAX_HLS_MEDIA_RECOVERY_ATTEMPTS) {
              hls.stopLoad()
              reportPlayFailureRef.current(`HLS媒体错误重试${MAX_HLS_MEDIA_RECOVERY_ATTEMPTS}次仍失败`)
              return
            }
            console.warn(`[VideoPlayer] HLS媒体错误，第${mediaRecoveryAttempts}次恢复`)
            setPlaybackPhase('recovering', `媒体错误，正在第 ${mediaRecoveryAttempts} 次恢复...`)
            hls.recoverMediaError()
            break
          default:
            hls.stopLoad()
            reportPlayFailureRef.current(`HLS无法恢复: ${data.details}`)
        }
      })
      hlsRef.current = hls
    } else if (currentProtocol === 'hls' && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari 原生 HLS
      video.src = currentUrl
      video.play().catch(() => {})
    } else {
      // 原生播放
      video.src = currentUrl
      video.play().catch(() => {})
    }

    // 视频错误处理
    const onError = () => {
      const error = video.error
      console.error('[VideoPlayer] 视频播放错误:', error?.code, error?.message)
      // 关键修复：3 秒后再次检查，如果视频已经成功播放（currentTime > 0 且未暂停），说明 HLS 已恢复，不应触发失败
      setTimeout(() => {
        if (failureReportedRef.current) return
        if (hasPlaybackStartedRef.current) {
          console.log('[VideoPlayer] video error 但已实际播放（HLS 恢复成功），忽略')
          return
        }
        if (video.currentTime > 0 && !video.paused) {
          console.log('[VideoPlayer] video error 但视频在播放，忽略')
          markPlaybackStarted()
          return
        }
        if (video.error) {
          reportPlayFailureRef.current(`视频错误: code=${error?.code}`)
        }
      }, 3000)
      // 如果 HLS.js 正在使用但视频报错，尝试回退到原生播放
      if (hlsRef.current && error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        console.log('[VideoPlayer] 回退到原生播放')
        hlsRef.current.destroy()
        hlsRef.current = null
        video.src = currentUrl
        video.play().catch(() => {})
      }
    }
    video.addEventListener('error', onError)

    const onWaiting = () => {
      if (!failureReportedRef.current && !hasPlaybackStartedRef.current) {
        setPlaybackPhase('buffering', '正在缓冲...')
      }
    }
    const onCanPlay = () => {
      if (!failureReportedRef.current && !hasPlaybackStartedRef.current) {
        setPlaybackPhase('buffering', '已获取媒体数据，准备播放...')
      }
    }
    const onStalled = () => {
      // 防抖：停滞超过 2.5 秒才显示覆盖层
      clearStalledTimer()
      stalledTimerRef.current = window.setTimeout(() => {
        if (!failureReportedRef.current && !hasPlaybackStartedRef.current) {
          setPlaybackPhase('recovering', '媒体加载停滞，正在等待恢复...')
        }
      }, 2500)
    }
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('stalled', onStalled)

    return () => {
      video.removeEventListener('error', onError)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('stalled', onStalled)
      hlsRef.current?.destroy()
      dashRef.current?.reset()
      hlsRef.current = null
      dashRef.current = null
      if (hlsRecoveryTimer) clearTimeout(hlsRecoveryTimer)
      clearLoadTimeout()
      clearStalledTimer()
    }
  // 关键修复：依赖只有 currentUrl 和 playHeader，不再依赖 hasPlaybackStarted/reportPlayFailure
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUrl, playHeader, playKey])

  // 同步播放状态
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (isPlaying) video.play().catch(() => {})
    else video.pause()
  }, [isPlaying])

  // 同步音量/倍速
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = volume <= 0
    video.playbackRate = speed
  }, [volume, speed])

  // 视频事件
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime)
      if (video.currentTime > 0) markPlaybackStarted()
      savePlaybackHistory(false)
    }
    const onDurationChange = () => {
      setDuration(video.duration || 0)
      applyPendingSeek()
    }
    const onPlay = () => {
      setIsPlaying(true)
      // 用户恢复播放时继续执行未完成的 seek（从 MiniPlayer 退出后场景）
      applyPendingSeek()
    }
    const onPause = () => {
      setIsPlaying(false)
      savePlaybackHistory(true)
    }
    const onLoadedMetadata = () => applyPendingSeek()
    const onLoadedData = () => {
      applyPendingSeek()
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        markPlaybackStarted()
      }
    }
    const onPlaying = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA || video.currentTime > 0) {
        markPlaybackStarted()
        // 已开始播放时隐藏 stalled/buffering 覆盖层
        clearStalledTimer()
        if (playbackPhase === 'recovering' || playbackPhase === 'buffering') {
          resetPlaybackPhase()
        }
      }
    }
    const onEnded = () => {
      savePlaybackHistory(true, true)
      if (currentEpisodeIndex < episodes.length - 1) nextEpisode()
      else setIsPlaying(false)
    }

    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('durationchange', onDurationChange)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('loadedmetadata', onLoadedMetadata)
    video.addEventListener('loadeddata', onLoadedData)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('ended', onEnded)

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('durationchange', onDurationChange)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.removeEventListener('loadeddata', onLoadedData)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('ended', onEnded)
    }
  }, [
    applyPendingSeek,
    currentEpisodeIndex,
    episodes.length,
    markPlaybackStarted,
    nextEpisode,
    savePlaybackHistory,
    setDuration,
    setCurrentTime,
    setIsPlaying
  ])

  // 控制栏自动隐藏
  const resetHideTimer = useCallback(() => {
    setShowControls(true)
    clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => {
      if (isPlaying) setShowControls(false)
    }, 3000)
  }, [isPlaying])

  // 全屏切换
  const handleToggleFullscreen = useCallback(async () => {
    const container = containerRef.current
    if (!container) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        setIsActualFullscreen(false)
      } else {
        await container.requestFullscreen()
        setIsActualFullscreen(true)
      }
    } catch {
      const nextFullscreen = !isActualFullscreen
      await windowApi.setFullscreen(nextFullscreen).catch(() => {})
      setIsActualFullscreen(nextFullscreen)
    }
  }, [isActualFullscreen])

  const handleDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button,input,select,textarea')) return
    void handleToggleFullscreen()
  }, [handleToggleFullscreen])

  // 监听全屏变化
  useEffect(() => {
    const handler = () => setIsActualFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // 关键修复：监听页面可见性变化，切回时自动恢复播放
  // 即使 backgroundThrottling=false，macOS 系统级切换仍可能让 video 暂停
  useEffect(() => {
    const handleVisibilityChange = () => {
      const video = videoRef.current
      if (!video) return
      if (document.visibilityState === 'visible') {
        // 切回前台：如果应该播放却暂停了，自动恢复
        if (isPlaying && video.paused && hasPlaybackStartedRef.current) {
          console.log('[VideoPlayer] 切回前台，恢复播放')
          video.play().catch((err) => {
            console.warn('[VideoPlayer] 自动恢复播放失败:', err)
          })
        } else if (isPlaying && video.paused && currentUrl) {
          // 还未开始播放但已加载 URL - 尝试重新触发 HLS 加载
          console.log('[VideoPlayer] 切回前台，重新开始加载')
          if (hlsRef.current) {
            try { hlsRef.current.startLoad() } catch {}
          } else {
            // 没有 HLS 实例（可能用原生 video），尝试直接 play
            video.play().catch(() => {})
          }
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleVisibilityChange)
    }
  }, [isPlaying, currentUrl])

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const video = videoRef.current
      if (!video) return
      switch (e.key) {
        case ' ':
          e.preventDefault()
          setIsPlaying(!isPlaying)
          break
        case 'ArrowLeft':
          video.currentTime = Math.max(0, video.currentTime - 10)
          break
        case 'ArrowRight':
          video.currentTime = Math.min(video.duration, video.currentTime + 10)
          break
        case 'ArrowUp':
          e.preventDefault()
          setVolume(Math.min(1, volume + 0.1))
          break
        case 'ArrowDown':
          e.preventDefault()
          setVolume(Math.max(0, volume - 0.1))
          break
        case 'f':
          handleToggleFullscreen()
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isPlaying, volume, handleToggleFullscreen, setIsPlaying, setVolume])

  // 进度条拖动
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current
    if (!video || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    video.currentTime = ratio * duration
  }

  const formatTime = (s: number) => {
    if (!s || isNaN(s)) return '00:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const showPlaybackOverlay = playbackPhase !== 'idle' && playbackPhase !== 'playing'
  const overlayText = playbackPhase === 'failed'
    ? playbackError || playbackMessage || '播放失败'
    : playbackMessage || (currentUrl === '__resolving__' ? '解析播放地址中...' : '加载中...')
  const firstFrameMs = playbackStartedAt && playbackFirstFrameAt
    ? Math.max(0, playbackFirstFrameAt - playbackStartedAt)
    : null
  const elapsedMs = playbackStartedAt ? Math.max(0, Date.now() - playbackStartedAt) : 0
  const redactedUrl = currentUrl ? redactText(currentUrl) : ''
  const redactedHeaders = redactHeaders(playHeader)
  const bitrateText = formatThroughput(streamStats.bitrateKbps)
  const linkSpeedText = formatThroughput(streamStats.linkSpeedKbps)

  const buildDiagnosticsText = async () => {
    const metricSummary = await getPlaybackMetricSummary()
    const lines = [
      'IPTV Mac 播放诊断',
      `阶段: ${playbackPhase}`,
      `状态: ${playbackMessage || '-'}`,
      `错误: ${playbackError || '-'}`,
      `错误阶段: ${playbackDiagnostic?.stage || '-'}`,
      `错误类型: ${playbackDiagnostic?.errorKind || '-'}`,
      `协议: ${playbackDiagnostic?.protocol || inferProtocol(currentUrl)}`,
      `站点: ${currentSiteKey || '-'}`,
      `影片: ${currentVod?.vod_name || '-'}`,
      `集数: ${episodes[currentEpisodeIndex]?.name || currentEpisodeIndex + 1 || '-'}`,
      `线路索引: ${currentSourceIndex + 1}`,
      `已失败源: ${brokenSources.length}`,
      `备选源: ${alternativeSources.length}`,
      `首帧耗时: ${firstFrameMs == null ? '-' : `${firstFrameMs}ms`}`,
      `当前耗时: ${elapsedMs}ms`,
      `失败时间: ${playbackLastErrorAt ? new Date(playbackLastErrorAt).toISOString() : '-'}`,
      `换源状态: ${sourceSwitchState}${sourceSwitchMessage ? ` - ${sourceSwitchMessage}` : ''}`,
      `下一步: ${playbackDiagnostic?.nextAction || (autoSwitchSource ? '自动换源开启' : '等待手动操作')}`,
      `首帧样本数: ${metricSummary.totalFirstFrameSamples}`,
      `首帧P50: ${metricSummary.p50FirstFrameMs == null ? '-' : `${metricSummary.p50FirstFrameMs}ms`}`,
      `首帧P90: ${metricSummary.p90FirstFrameMs == null ? '-' : `${metricSummary.p90FirstFrameMs}ms`}`,
      `失败样本数: ${metricSummary.totalFailures}`,
      `URL: ${redactedUrl || '-'}`,
      `Headers: ${Object.keys(redactedHeaders).length ? JSON.stringify(redactedHeaders) : '-'}`
    ]
    return lines.join('\n')
  }

  const handleCopyDiagnostics = async () => {
    try {
      const text = await buildDiagnosticsText()
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1800)
    } catch {
      setCopyState('failed')
      window.setTimeout(() => setCopyState('idle'), 1800)
    }
  }

  const handleRetryPlayback = () => {
    window.dispatchEvent(new CustomEvent('player:retry'))
  }

  const handleNextSource = () => {
    window.dispatchEvent(new CustomEvent('player:nextSource'))
  }

  return (
    <div
      ref={containerRef}
      className={`bg-black group ${
        miniTransitionStyle
          ? ''
          : isActualFullscreen
          ? 'fixed inset-0 z-[9999] h-screen w-screen'
          : 'relative h-full w-full'
      }`}
      style={miniTransitionStyle || undefined}
      onMouseMove={resetHideTimer}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      onDoubleClick={handleDoubleClick}
    >
      <video ref={videoRef} className="w-full h-full object-contain" playsInline muted={volume <= 0} x-webkit-airplay="allow" />

      {currentUrl && (
        <div className="pointer-events-none absolute right-3 top-3 z-20 min-w-[132px] rounded-lg border border-white/10 bg-black/55 px-3 py-2 text-[11px] leading-4 text-white/80 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <span className="text-white/45">码率</span>
            <span className="font-mono text-white">{bitrateText}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-3">
            <span className="text-white/45">速度</span>
            <span className="font-mono text-white">{linkSpeedText}</span>
          </div>
        </div>
      )}

      {currentUrl && (
        <button
          onClick={handleEnterMiniMode}
          className="absolute right-3 top-[4.75rem] z-30 rounded-md border border-white/10 bg-black/55 p-2 text-white/80 shadow-lg backdrop-blur transition hover:bg-black/75 hover:text-white"
          title="精简模式"
        >
          <PictureInPicture2 className="h-4 w-4" />
        </button>
      )}

      {/* 播放状态 */}
      {showPlaybackOverlay && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
          {playbackPhase === 'failed' ? (
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-red-400/40 text-red-400">
              !
            </div>
          ) : (
            <Loader2 className="w-8 h-8 animate-spin text-accent" />
          )}
          <span className="text-sm text-white/80">{overlayText}</span>
          {playbackPhase === 'failed' && (
            <span className="max-w-md text-xs leading-5 text-white/50">
              应用会尝试自动换源；也可以切换线路或重试当前集。
            </span>
          )}
        </div>
      )}

      {/* 弹幕层 */}
      {isDanmakuOn && <DanmakuLayer />}

      {/* 字幕层 */}
      <SubtitleLayer />

      {/* 控制栏 */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-10 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* 进度条 */}
        <div className="mb-2 cursor-pointer group/progress" onClick={handleProgressClick}>
          <div className="h-1 group-hover/progress:h-2 bg-white/20 rounded-full transition-all relative">
            <div
              className="h-full bg-accent rounded-full relative"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-accent rounded-full opacity-0 group-hover/progress:opacity-100 transition-opacity" />
            </div>
          </div>
        </div>

        {/* 控制按钮 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={prevEpisode} className="p-1 text-white/80 hover:text-white">
              <SkipBack className="w-4 h-4" />
            </button>
            <button onClick={() => setIsPlaying(!isPlaying)} className="p-1 text-white hover:text-accent">
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>
            <button onClick={nextEpisode} className="p-1 text-white/80 hover:text-white">
              <SkipForward className="w-4 h-4" />
            </button>
            <span className="text-xs text-white/70 ml-2">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* 音量 */}
            <button onClick={() => setVolume(volume > 0 ? 0 : 1)} className="p-1 text-white/80 hover:text-white">
              {volume > 0 ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-16 h-1 accent-accent"
            />

            {/* 倍速 */}
            <div className="relative">
              <button
                onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                className="px-2 py-0.5 text-xs text-white/80 hover:text-white rounded border border-white/20"
              >
                {speed}x
              </button>
              {showSpeedMenu && (
                <div className="absolute bottom-full right-0 mb-2 bg-bg-secondary rounded-lg shadow-xl border border-[#2a2a2a] py-1 min-w-[80px]">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => { setSpeed(s); setShowSpeedMenu(false) }}
                      className={`w-full px-3 py-1.5 text-xs text-left hover:bg-bg-hover ${
                        speed === s ? 'text-accent' : 'text-text-secondary'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 弹幕开关 */}
            <button onClick={toggleDanmaku} className={`p-1 ${isDanmakuOn ? 'text-accent' : 'text-white/40 hover:text-white/70'}`}>
              <MessageSquare className="w-4 h-4" />
            </button>

            {/* 诊断 */}
            <button
              onClick={() => setShowDiagnostics(true)}
              className={`p-1 ${playbackPhase === 'failed' ? 'text-red-400' : 'text-white/80 hover:text-white'}`}
              title="播放诊断"
            >
              <ClipboardList className="w-4 h-4" />
            </button>

            {/* 投屏（AirPlay） */}
            <button
              onClick={() => {
                const video = videoRef.current
                if (video && 'webkitShowPlaybackTargetPicker' in video) {
                  (video as any).webkitShowPlaybackTargetPicker()
                }
              }}
              className="p-1 text-white/80 hover:text-white"
              title="投屏到电视"
            >
              <Monitor className="w-4 h-4" />
            </button>

            {/* 精简模式 */}
            <button onClick={handleEnterMiniMode} className="p-1 text-white/80 hover:text-white" title="精简模式">
              <PictureInPicture2 className="w-4 h-4" />
            </button>

            {/* 全屏 */}
            <button onClick={handleToggleFullscreen} className="p-1 text-white/80 hover:text-white">
              {isActualFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {showDiagnostics && (
        <div className="absolute inset-y-0 right-0 z-40 w-full max-w-sm border-l border-white/10 bg-[#111]/95 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-medium text-white">播放诊断</h3>
            </div>
            <button
              onClick={() => setShowDiagnostics(false)}
              className="p-1 text-white/60 hover:text-white"
              title="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4 overflow-y-auto px-4 py-4 text-xs text-white/70 scrollbar-dark h-[calc(100%-49px)]">
            <div className="grid grid-cols-2 gap-2">
              <DiagnosticMetric label="阶段" value={playbackPhase} />
              <DiagnosticMetric label="首帧耗时" value={firstFrameMs == null ? '-' : `${firstFrameMs}ms`} />
              <DiagnosticMetric label="当前耗时" value={`${elapsedMs}ms`} />
              <DiagnosticMetric label="音量/倍速" value={`${Math.round(volume * 100)}% / ${speed}x`} />
            </div>

            <DiagnosticSection title="状态">
              <p>{playbackMessage || '-'}</p>
              {playbackError && <p className="mt-2 text-red-300">{playbackError}</p>}
              {playbackDiagnostic && (
                <div className="mt-3 border-t border-white/10 pt-3">
                  <DiagnosticRow label="错误阶段" value={playbackDiagnostic.stage} />
                  <DiagnosticRow label="错误类型" value={playbackDiagnostic.errorKind} />
                  <DiagnosticRow label="下一步" value={playbackDiagnostic.nextAction || '-'} />
                </div>
              )}
              <label className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
                <span className="text-white/60">自动换源</span>
                <input
                  type="checkbox"
                  checked={autoSwitchSource}
                  onChange={(event) => setAutoSwitchSource(event.target.checked)}
                  className="h-4 w-4 accent-accent"
                />
              </label>
            </DiagnosticSection>

            <DiagnosticSection title="内容">
              <DiagnosticRow label="站点" value={currentSiteKey || '-'} />
              <DiagnosticRow label="影片" value={currentVod?.vod_name || '-'} />
              <DiagnosticRow label="集数" value={episodes[currentEpisodeIndex]?.name || String(currentEpisodeIndex + 1)} />
              <DiagnosticRow label="线路" value={String(currentSourceIndex + 1)} />
              <DiagnosticRow label="换源" value={`${sourceSwitchState}${sourceSwitchMessage ? ` - ${sourceSwitchMessage}` : ''}`} />
              <DiagnosticRow label="已失败/备选" value={`${brokenSources.length}/${alternativeSources.length}`} />
            </DiagnosticSection>

            <DiagnosticSection title="线路">
              <p className="break-all font-mono text-[11px] leading-5 text-white/60">{redactedUrl || '-'}</p>
            </DiagnosticSection>

            <DiagnosticSection title="请求头">
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-white/60">
                {Object.keys(redactedHeaders).length ? JSON.stringify(redactedHeaders, null, 2) : '-'}
              </pre>
            </DiagnosticSection>

            <button
              onClick={handleCopyDiagnostics}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg-primary hover:bg-accent-hover"
            >
              <Copy className="w-4 h-4" />
              {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制诊断信息'}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleRetryPlayback}
                className="flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm font-medium text-white/80 hover:bg-white/10"
              >
                <RotateCw className="w-4 h-4" />
                重试当前
              </button>
              <button
                onClick={handleNextSource}
                className="flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm font-medium text-white/80 hover:bg-white/10"
              >
                <Shuffle className="w-4 h-4" />
                切换线路
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DiagnosticMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <p className="text-[11px] text-white/40">{label}</p>
      <p className="mt-1 truncate text-sm text-white">{value}</p>
    </div>
  )
}

function DiagnosticSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 text-[11px] font-medium text-white/40">{title}</h4>
      <div className="rounded-lg border border-white/10 bg-white/5 p-3">{children}</div>
    </section>
  )
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="shrink-0 text-white/40">{label}</span>
      <span className="min-w-0 break-all text-right text-white/70">{value}</span>
    </div>
  )
}
