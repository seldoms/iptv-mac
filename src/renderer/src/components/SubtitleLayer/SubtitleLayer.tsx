import { useRef, useState, useEffect  } from 'react'
import { usePlayerStore } from '@/stores/usePlayerStore'

// 字幕解析缓存 keyed by URL，避免相同 URL 重复解析 SRT
const subtitleCache = new Map<string, SubtitleCue[]>()

interface SubtitleCue {
  start: number
  end: number
  text: string
}

interface SubtitleTrack {
  label: string
  language: string
  cues: SubtitleCue[]
}

interface SubtitleLayerProps {
  currentTime?: number
}

export default function SubtitleLayer({ currentTime = 0 }: SubtitleLayerProps) {
  const [tracks, setTracks] = useState<SubtitleTrack[]>([])
  const [activeTrackIndex, setActiveTrackIndex] = useState(0)
  const [currentCue, setCurrentCue] = useState<SubtitleCue | null>(null)

  // 解析 SRT 格式字幕
  const parseSRT = (content: string): SubtitleCue[] => {
    const cues: SubtitleCue[] = []
    const blocks = content.trim().split(/\n\n+/)
    for (const block of blocks) {
      const lines = block.split('\n')
      if (lines.length < 3) continue
      const timeMatch = lines[1].match(
        /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
      )
      if (!timeMatch) continue
      const start =
        +timeMatch[1] * 3600 + +timeMatch[2] * 60 + +timeMatch[3] + +timeMatch[4] / 1000
      const end =
        +timeMatch[5] * 3600 + +timeMatch[6] * 60 + +timeMatch[7] + +timeMatch[8] / 1000
      const text = lines.slice(2).join('\n')
      cues.push({ start, end, text })
    }
    return cues
  }

  // 加载字幕
  const loadSubtitle = async (url: string, label: string, language = 'zh') => {
    try {
      // 优先使用缓存，避免重复解析
      const cached = subtitleCache.get(url)
      if (cached) {
        setTracks((prev) => [...prev, { label, language, cues: cached }])
        return
      }
      const res = await fetch(url)
      const content = await res.text()
      const cues = parseSRT(content)
      // 限制缓存条目数，防止内存泄漏
      if (subtitleCache.size >= 50) {
        const firstKey = subtitleCache.keys().next().value
        if (firstKey) subtitleCache.delete(firstKey)
      }
      subtitleCache.set(url, cues)
      setTracks((prev) => [...prev, { label, language, cues }])
    } catch {
      // 字幕加载失败静默处理
    }
  }

  // 根据当前时间查找字幕
  useEffect(() => {
    if (tracks.length === 0) return
    const track = tracks[activeTrackIndex]
    if (!track) return
    const cue = track.cues.find((c) => currentTime >= c.start && currentTime <= c.end)
    setCurrentCue(cue || null)
  }, [currentTime, tracks, activeTrackIndex])

  // 字幕加载请求来自 player store（原先监听 `subtitle:load` window 事件）
  const subtitleRequest = usePlayerStore((state) => state.subtitleRequest)
  const subtitleToken = subtitleRequest?.token ?? 0
  const handledTokenRef = useRef(usePlayerStore.getState().subtitleRequest?.token ?? 0)
  useEffect(() => {
    if (subtitleToken === handledTokenRef.current) return
    handledTokenRef.current = subtitleToken
    if (!subtitleRequest) return
    loadSubtitle(subtitleRequest.url, subtitleRequest.label, subtitleRequest.language)
  }, [subtitleToken, subtitleRequest])

  if (!currentCue) return null

  return (
    <div className="absolute bottom-16 left-0 right-0 z-20 flex justify-center pointer-events-none">
      <div className="px-4 py-2 bg-black/70 rounded-lg max-w-[80%]">
        <p
          className="text-white text-center text-base leading-relaxed whitespace-pre-line"
          style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}
        >
          {currentCue.text}
        </p>
      </div>
    </div>
  )
}

// 需要加载字幕请调用 usePlayerStore.getState().loadSubtitle(url, label, language)
