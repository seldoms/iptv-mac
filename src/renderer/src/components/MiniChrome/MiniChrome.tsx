import { useCallback, useEffect } from 'react'
import { ArrowLeftRight, GripHorizontal } from 'lucide-react'
import { leaveMiniMode } from '@/utils/miniMode'

/**
 * 精简模式（小窗）的窗口控件层。
 *
 * 关键点：这里**不渲染播放器**。小窗里的画面来自仍然挂载着的 VideoPlayer
 * （它以 `fixed inset-0 z-[9001]` 铺满小窗，盖在下方的黑色遮罩上）。
 * 早期实现是「卸载主播放器 + 新建 MiniPlayer」，等于换了一个播放器实例，
 * 必然要重新拉流、重新缓冲——用户看到的就是"切到小窗画面中断"。
 */
export default function MiniChrome() {
  const exitMiniMode = useCallback(async () => {
    await leaveMiniMode()
  }, [])

  // ESC 退出小窗（控制栏被隐藏时也有保底出路）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      void exitMiniMode()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [exitMiniMode])

  return (
    <div
      className="fixed inset-x-0 top-0 z-[9002] flex h-7 items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-2 select-none"
      data-tauri-drag-region="deep"
      title="拖动此处可移动小窗"
    >
      <span className="flex items-center gap-1 text-[10px] text-white/50" data-tauri-drag-region="deep">
        <GripHorizontal className="h-3 w-3" />
        精简模式
      </span>
      <button
        onClick={() => void exitMiniMode()}
        className="flex items-center gap-1 rounded border border-white/20 px-2 py-0.5 text-[10px] text-white/80 transition-colors hover:border-accent hover:text-accent"
        title="返回完整界面（ESC）"
      >
        <ArrowLeftRight className="h-3 w-3" />
        返回
      </button>
    </div>
  )
}
