import { useRef, useEffect, useCallback, useState } from 'react'
import Hls from 'hls.js'
import dashjs from 'dashjs'
import { windowApi } from '@/utils/ipc'
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  X,
  Maximize2,
  GripHorizontal
} from 'lucide-react'

export default function MiniPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const dashRef = useRef<dashjs.MediaPlayerClass | null>(null)
  const hideTimerRef = useRef<number>(0)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentUrl, setCurrentUrl] = useState('')
  const [playHeader, setPlayHeader] = useState<Record<string, string> | null>(null)
  const [volume, setVolume] = useState(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [showControls, setShowControls] = useState(true)
  const [isLoaded, setIsLoaded] = useState(false)
  /** 需要恢复的播放进度 */
  const restoreTimeRef = useRef<number | null>(null)

  // 从主进程获取播放状态
  useEffect(() => {
    const loadPlayerState = async () => {
      try {
        const state = await windowApi.getPlayerState() as { url: string; header?: Record<string, string>; currentTime?: number } | null
        if (state?.url) {
          setCurrentUrl(state.url)
          setPlayHeader(state.header || null)
          if (state.currentTime && state.currentTime > 0) {
            restoreTimeRef.current = state.currentTime
          }
        }
      } catch (err) {
        console.error('[MiniPlayer] 获取播放状态失败:', err)
      }
    }
    loadPlayerState()
  }, [])

  // 初始化播放器
  useEffect(() => {
    const video = videoRef.current
    if (!video || !currentUrl) return

    hlsRef.current?.destroy()
    dashRef.current?.reset()
    hlsRef.current = null
    dashRef.current = null

    console.log('[MiniPlayer] 播放URL:', currentUrl)

    if (currentUrl.includes('.mpd')) {
      const player = dashjs.MediaPlayer().create()
      player.initialize(video, currentUrl, true)
      dashRef.current = player
    } else if (Hls.isSupported()) {
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
        video.play().catch(() => {})
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad()
              break
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError()
              break
            default:
              hls.destroy()
              hlsRef.current = null
              video.src = currentUrl
              video.play().catch(() => {})
              break
          }
        }
      })
      hlsRef.current = hls
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = currentUrl
      video.play().catch(() => {})
    } else {
      video.src = currentUrl
      video.play().catch(() => {})
    }

    setIsLoaded(true)

    return () => {
      hlsRef.current?.destroy()
      dashRef.current?.reset()
    }
  }, [currentUrl, playHeader])

  // 恢复播放进度
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onCanPlay = () => {
      if (restoreTimeRef.current !== null && restoreTimeRef.current > 0) {
        const targetTime = restoreTimeRef.current
        restoreTimeRef.current = null
        // 等待 duration 可用后再 seek
        if (video.duration && !isNaN(video.duration)) {
          video.currentTime = Math.min(targetTime, video.duration)
          console.log('[MiniPlayer] 恢复播放进度:', video.currentTime)
        } else {
          const onDurationChange = () => {
            video.currentTime = Math.min(targetTime, video.duration)
            console.log('[MiniPlayer] 恢复播放进度:', video.currentTime)
            video.removeEventListener('durationchange', onDurationChange)
          }
          video.addEventListener('durationchange', onDurationChange)
        }
      }
    }
    video.addEventListener('canplay', onCanPlay)
    return () => {
      video.removeEventListener('canplay', onCanPlay)
    }
  }, [])

  // 同步音量
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = volume
  }, [volume])

  // 视频事件
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onTimeUpdate = () => setCurrentTime(video.currentTime)
    const onDurationChange = () => setDuration(video.duration || 0)
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => setIsPlaying(false)

    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('durationchange', onDurationChange)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('durationchange', onDurationChange)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
    }
  }, [])

  // 控制栏自动隐藏
  const resetHideTimer = useCallback(() => {
    setShowControls(true)
    clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => {
      if (isPlaying) setShowControls(false)
    }, 3000)
  }, [isPlaying])

  // 退出精简模式
  const handleExitMiniMode = useCallback(() => {
    windowApi.exitMiniMode()
  }, [])

  // 进度条点击
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current
    if (!video) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    // 如果有 duration 就直接跳转，否则 HLS 流会自动根据比率计算
    if (video.duration && !isNaN(video.duration) && isFinite(video.duration)) {
      video.currentTime = ratio * video.duration
    } else {
      // HLS 流可能没有 duration，尝试直接设置
      // 如果视频已加载但 duration 为 Infinity（直播流），不执行 seek
      if (video.readyState > 0) {
        const estimatedDuration = video.currentTime / ratio || 0
        if (estimatedDuration > 0 && isFinite(estimatedDuration)) {
          video.currentTime = ratio * estimatedDuration
        }
      }
    }
  }

  const formatTime = (s: number) => {
    if (!s || isNaN(s)) return '00:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  if (!currentUrl) {
    return (
      <div className="w-full h-full bg-black flex items-center justify-center">
        <p className="text-white/50 text-sm">无播放内容</p>
      </div>
    )
  }

  return (
    <div
      className="relative w-full h-full bg-black group"
      onMouseMove={resetHideTimer}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      <video ref={videoRef} className="w-full h-full object-contain" />

      {/* 顶部拖动区域 + 关闭按钮 */}
      <div
        className={`absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent px-2 pt-1 pb-6 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center justify-between" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <GripHorizontal className="w-4 h-4 text-white/40" />
          </div>
          <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <button
              onClick={handleExitMiniMode}
              className="p-1 text-white/70 hover:text-white rounded hover:bg-white/10 transition-colors"
              title="返回完整模式"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleExitMiniMode}
              className="p-1 text-white/70 hover:text-white rounded hover:bg-white/10 transition-colors"
              title="关闭精简模式"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 底部控制栏 */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-8 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* 进度条 */}
        <div className="mb-1.5 cursor-pointer group/progress" onClick={handleProgressClick}>
          <div className="h-1 group-hover/progress:h-1.5 bg-white/20 rounded-full transition-all relative">
            <div
              className="h-full bg-accent rounded-full relative"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-accent rounded-full opacity-0 group-hover/progress:opacity-100 transition-opacity" />
            </div>
          </div>
        </div>

        {/* 控制按钮 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const video = videoRef.current
                if (!video) return
                if (video.paused) video.play().catch(() => {})
                else video.pause()
              }}
              className="p-1 text-white hover:text-accent"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <span className="text-[10px] text-white/60 ml-1">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* 音量 */}
            <button
              onClick={() => setVolume(volume > 0 ? 0 : 1)}
              className="p-1 text-white/70 hover:text-white"
            >
              {volume > 0 ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-12 h-0.5 accent-accent"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
