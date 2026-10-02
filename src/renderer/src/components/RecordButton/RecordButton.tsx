import { Circle } from 'lucide-react'
import { useRecordingStore } from '@/stores/useRecordingStore'

interface RecordButtonProps {
  onStart: () => void | Promise<void>
  onStop: () => void | Promise<void>
  /** 只显示图标（播放器控制栏用，窄屏不被文字挤占） */
  compact?: boolean
  className?: string
}

/**
 * 直播录制按钮：红色圆点，**录制中闪烁**、未录制（含录完）**常亮**。
 *
 * 直播页与播放器控制栏共用，状态来自 `useRecordingStore`，两边永远一致。
 */
export default function RecordButton({ onStart, onStop, compact = false, className = '' }: RecordButtonProps) {
  const status = useRecordingStore((state) => state.status)
  const recording = status === 'recording'

  const handleClick = () => {
    if (recording) {
      void onStop()
      return
    }
    void onStart()
  }

  const title = recording ? '停止录制（已录制部分会保留）' : status === 'recorded' ? '再次录制当前直播' : '开始录制当前直播'

  return (
    <button
      onClick={handleClick}
      title={title}
      aria-label={recording ? '停止录制' : '录制'}
      aria-pressed={recording}
      data-recording={recording ? 'true' : 'false'}
      className={`shrink-0 inline-flex items-center gap-1 text-red-500 transition-colors hover:text-red-400 ${
        compact ? 'p-1' : 'rounded-md border border-red-400/60 px-2 py-1 text-xs'
      } ${className}`}
    >
      <Circle className={`h-2.5 w-2.5 fill-current ${recording ? 'animate-pulse' : ''}`} />
      {compact ? (
        // 播放器控制栏：宽屏带上「录制/停止」字样，窄屏（含小窗）只留红点不挤占
        <span className="ml-1 hidden text-[11px] sm:inline">{recording ? '停止' : '录制'}</span>
      ) : (
        <span>{recording ? '停止录制' : '录制'}</span>
      )}
    </button>
  )
}
