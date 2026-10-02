import { useRef, useEffect, useCallback, useState } from 'react'
import { usePlayerStore } from '@/stores/usePlayerStore'

interface Danmaku {
  id: number
  text: string
  color: string
  speed: number
  x: number
  y: number
  fontSize: number
  /** 预计算的文本宽度，避免每帧调用 ctx.measureText */
  textWidth: number
}

interface DanmakuLayerProps {
  opacity?: number
  speed?: number
  fontSize?: number
}

export default function DanmakuLayer({ opacity = 0.8, speed = 2, fontSize = 20 }: DanmakuLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const danmakuListRef = useRef<Danmaku[]>([])
  const animFrameRef = useRef<number>(0)
  const idCounter = useRef(0)
  const [enabled, setEnabled] = useState(true)

  // 添加弹幕
  const addDanmaku = useCallback(
    (text: string, color = '#ffffff') => {
      const canvas = canvasRef.current
      if (!canvas || !enabled) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const y = Math.random() * (canvas.height - fontSize - 10) + 5
      ctx.font = `${fontSize}px "Noto Sans SC", sans-serif`
      const textWidth = ctx.measureText(text).width
      danmakuListRef.current.push({
        id: idCounter.current++,
        text,
        color,
        speed: speed + Math.random() * 0.5,
        x: canvas.width,
        y,
        fontSize,
        textWidth,
      })
    },
    [enabled, speed, fontSize]
  )

  // 渲染循环
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resizeCanvas = () => {
      const parent = canvas.parentElement
      if (parent) {
        canvas.width = parent.clientWidth
        canvas.height = parent.clientHeight
      }
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      danmakuListRef.current = danmakuListRef.current.filter((d) => {
        d.x -= d.speed
        // 使用预计算的文本宽度，避免每帧调用 measureText
        if (d.x < -d.textWidth * 2) return false

        ctx.font = `${d.fontSize}px "Noto Sans SC", sans-serif`
        ctx.fillStyle = d.color
        ctx.globalAlpha = opacity
        ctx.fillText(d.text, d.x, d.y)
        ctx.globalAlpha = 1

        return true
      })

      animFrameRef.current = requestAnimationFrame(render)
    }

    animFrameRef.current = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      window.removeEventListener('resize', resizeCanvas)
    }
  }, [opacity])

  // 弹幕请求来自 player store（原先监听 `danmaku:add` window 事件）
  const danmakuRequest = usePlayerStore((state) => state.danmakuRequest)
  const danmakuToken = danmakuRequest?.token ?? 0
  const handledTokenRef = useRef(usePlayerStore.getState().danmakuRequest?.token ?? 0)
  useEffect(() => {
    if (danmakuToken === handledTokenRef.current) return
    handledTokenRef.current = danmakuToken
    if (!danmakuRequest) return
    addDanmaku(danmakuRequest.text, danmakuRequest.color)
  }, [danmakuToken, danmakuRequest, addDanmaku])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-10"
      style={{ display: enabled ? 'block' : 'none' }}
    />
  )
}

// 需要发送弹幕请调用 usePlayerStore.getState().sendDanmaku(text, color)
