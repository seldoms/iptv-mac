import { useRef, useEffect, useCallback, useState } from 'react'

interface Danmaku {
  id: number
  text: string
  color: string
  speed: number
  x: number
  y: number
  fontSize: number
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
      danmakuListRef.current.push({
        id: idCounter.current++,
        text,
        color,
        speed: speed + Math.random() * 0.5,
        x: canvas.width,
        y,
        fontSize
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
        if (d.x < -ctx.measureText(d.text).width * 2) return false

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

  // 监听弹幕事件
  useEffect(() => {
    const handleDanmaku = (e: CustomEvent) => {
      addDanmaku(e.detail.text, e.detail.color)
    }
    window.addEventListener('danmaku:add' as any, handleDanmaku)
    return () => window.removeEventListener('danmaku:add' as any, handleDanmaku)
  }, [addDanmaku])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-10"
      style={{ display: enabled ? 'block' : 'none' }}
    />
  )
}

/**
 * 发送弹幕的辅助函数
 */
export function sendDanmaku(text: string, color = '#ffffff') {
  window.dispatchEvent(new CustomEvent('danmaku:add', { detail: { text, color } }))
}
