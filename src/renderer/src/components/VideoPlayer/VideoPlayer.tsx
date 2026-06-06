import { useRef, useEffect, useCallback, useState } from 'react'
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
  PictureInPicture2
} from 'lucide-react'
import { windowApi } from '@/utils/ipc'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]

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

  // 用 ref 缓存 store 中的 siteKey/vodId，避免 reportPlayFailure 引用变化导致 effect 重跑
  const currentSiteKeyRef = useRef<string>('')
  const currentVodIdRef = useRef<string>('')

  const {
    isPlaying, currentUrl, playKey, currentTime, duration, speed, volume,
    isDanmakuOn, isFullscreen, episodes, currentEpisodeIndex,
    playHeader, currentSiteKey, currentVod,
    setIsPlaying, setCurrentTime, setDuration, setSpeed, setVolume,
    toggleDanmaku, toggleFullscreen, nextEpisode, prevEpisode
  } = usePlayerStore()

  // 同步 siteKey/vodId 到 ref（变化时不影响 effect）
  useEffect(() => {
    currentSiteKeyRef.current = currentSiteKey || ''
    currentVodIdRef.current = currentVod?.vod_id || ''
  }, [currentSiteKey, currentVod?.vod_id])

  const [showControls, setShowControls] = useState(true)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isActualFullscreen, setIsActualFullscreen] = useState(false)

  // ==================== 换源：触发失败事件 ====================
  // 稳定的 ref 函数，不依赖外部 state 变化
  const reportPlayFailureRef = useRef((reason: string) => {
    if (failureReportedRef.current) return
    failureReportedRef.current = true
    const siteKey = currentSiteKeyRef.current
    const vodId = currentVodIdRef.current
    console.error('[VideoPlayer] 播放失败:', reason, 'siteKey:', siteKey, 'vodId:', vodId)
    window.dispatchEvent(new CustomEvent('vod:playFailed', {
      detail: { siteKey, vodId, reason, autoSwitch: true }
    }))
  })

  // 清除加载超时的工具函数
  const clearLoadTimeout = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current)
      loadTimeoutRef.current = 0
    }
  }, [])

  // 标记已播放（取消超时）
  const markPlaybackStarted = useCallback(() => {
    if (hasPlaybackStartedRef.current) return
    hasPlaybackStartedRef.current = true
    clearLoadTimeout()
  }, [clearLoadTimeout])

  // 进入精简模式
  const handleEnterMiniMode = useCallback(async () => {
    if (!currentUrl) return
    const video = videoRef.current
    const savedTime = video?.currentTime || currentTime
    setIsPlaying(false)
    await windowApi.savePlayerState({ url: currentUrl, header: playHeader || undefined, currentTime: savedTime })
    await windowApi.enterMiniMode()
  }, [currentUrl, playHeader, currentTime, setIsPlaying])

  // 初始化播放器 - 仅在 URL/header 变化时重跑
  useEffect(() => {
    const video = videoRef.current
    if (!video || !currentUrl) return

    // 清理旧实例
    hlsRef.current?.destroy()
    dashRef.current?.reset()
    hlsRef.current = null
    dashRef.current = null

    // 重置失败标记和播放标记
    failureReportedRef.current = false
    hasPlaybackStartedRef.current = false
    loadStartTimeRef.current = Date.now()
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
    }, 25000)

    if (currentUrl.includes('.mpd')) {
      // DASH
      const player = dashjs.MediaPlayer().create()
      player.initialize(video, currentUrl, true)
      dashRef.current = player
    } else if (Hls.isSupported()) {
      // 优先使用 HLS.js
      const hls = new Hls({
        enableWorker: true,
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
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('[VideoPlayer] HLS manifest 解析成功')
        markPlaybackStarted()
        video.play().catch(() => {})
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.error('[VideoPlayer] HLS错误:', data.type, data.details, data.fatal)
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log('[VideoPlayer] HLS网络错误，尝试恢复...')
              hls.startLoad()
              setTimeout(() => {
                if (failureReportedRef.current) return
                if (hasPlaybackStartedRef.current) {
                  console.log('[VideoPlayer] HLS 恢复成功，忽略')
                  return
                }
                reportPlayFailureRef.current('HLS网络错误且无法恢复')
              }, 1500)
              break
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('[VideoPlayer] HLS媒体错误，尝试恢复...')
              hls.recoverMediaError()
              setTimeout(() => {
                if (failureReportedRef.current) return
                if (hasPlaybackStartedRef.current) {
                  console.log('[VideoPlayer] HLS 恢复成功，忽略')
                  return
                }
                reportPlayFailureRef.current('HLS媒体错误且无法恢复')
              }, 1500)
              break
            default:
              // 无法恢复，回退到原生播放
              console.log('[VideoPlayer] HLS无法恢复，回退到原生播放')
              hls.destroy()
              hlsRef.current = null
              video.src = currentUrl
              video.play().catch(() => {})
              setTimeout(() => {
                if (failureReportedRef.current) return
                if (hasPlaybackStartedRef.current) return
                reportPlayFailureRef.current('HLS无法恢复，源可能无效')
              }, 3000)
              break
          }
        }
      })
      hlsRef.current = hls
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
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

    return () => {
      video.removeEventListener('error', onError)
      hlsRef.current?.destroy()
      dashRef.current?.reset()
      hlsRef.current = null
      dashRef.current = null
      clearLoadTimeout()
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
    video.playbackRate = speed
  }, [volume, speed])

  // 视频事件
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onTimeUpdate = () => setCurrentTime(video.currentTime)
    const onDurationChange = () => setDuration(video.duration || 0)
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onPlaying = () => {
      // 实际开始播放（缓冲结束）
      markPlaybackStarted()
    }
    const onLoadedMetadata = () => {
      // metadata 加载完成也算"开始播放"
      markPlaybackStarted()
    }
    const onCanPlay = () => {
      markPlaybackStarted()
    }
    const onEnded = () => {
      if (currentEpisodeIndex < episodes.length - 1) nextEpisode()
      else setIsPlaying(false)
    }

    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('durationchange', onDurationChange)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('loadedmetadata', onLoadedMetadata)
    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('ended', onEnded)

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('durationchange', onDurationChange)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('ended', onEnded)
    }
  }, [currentEpisodeIndex, episodes.length, markPlaybackStarted, nextEpisode, setDuration, setCurrentTime, setIsPlaying])

  // 控制栏自动隐藏
  const resetHideTimer = useCallback(() => {
    setShowControls(true)
    clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => {
      if (isPlaying) setShowControls(false)
    }, 3000)
  }, [isPlaying])

  // 全屏切换
  const handleToggleFullscreen = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      container.requestFullscreen()
    }
  }, [])

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

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black group"
      onMouseMove={resetHideTimer}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      onDoubleClick={handleToggleFullscreen}
    >
      <video ref={videoRef} className="w-full h-full object-contain" playsInline />

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
    </div>
  )
}
