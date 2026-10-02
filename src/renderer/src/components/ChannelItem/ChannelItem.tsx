import { Play } from 'lucide-react'
import { Channel } from '@/stores/useLiveStore'

interface ChannelItemProps {
  channel: Channel
  isActive: boolean
  onClick: (channel: Channel) => void
}

/**
 * 将延时（毫秒）转为颜色类和标签。
 * 注意：巡检用 -1 表示"不可达"，它不是毫秒数——以前 `-1 < 80` 会渲染成绿色的 "-1ms"。
 */
/** 悬浮提示：这条结果是什么时候测的（增量刷新下很关键） */
function lastTestHint(channel: Channel): string {
  const testedAt = channel.lines?.find((line) => (line.tested_at ?? 0) > 0)?.tested_at
  if (!testedAt) return '尚未探测（后台巡检会逐步补齐）'
  const minutes = Math.max(0, Math.round((Date.now() / 1000 - testedAt) / 60))
  return minutes < 1 ? '刚刚探测过' : `${minutes} 分钟前探测过`
}

export function latencyIndicator(ms: number | undefined): { className: string; label: string } {
  if (ms === undefined || ms === null) return { className: '', label: '' }
  // -2 = 还没探测过：明确显示「未验证」，既不能说可用也不能说不可用
  if (ms === -2) return { className: 'text-text-muted/70', label: '未验证' }
  if (ms < 0) return { className: 'text-red-400/80', label: '不可用' }
  if (ms < 80) return { className: 'text-green-400', label: `${ms}ms` }
  if (ms < 200) return { className: 'text-yellow-400', label: `${ms}ms` }
  return { className: 'text-red-400', label: `${ms}ms` }
}

export default function ChannelItem({ channel, isActive, onClick }: ChannelItemProps) {
  const latency = latencyIndicator(channel.latency)
  const lines = channel.lines ?? []
  const aliveLines = lines.filter((line) => line.alive).length
  const play = () => onClick(channel)
  const hasMeta = Boolean(latency.label) || lines.length > 0

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={play}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          play()
        }
      }}
      className={`group w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all duration-150 text-left cursor-pointer ${
        isActive
          ? 'bg-accent-muted text-accent'
          : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
      }`}
    >
      {/* 频道号 */}
      {channel.number && (
        <span className={`text-[11px] font-mono w-7 text-right shrink-0 ${
          isActive ? 'text-accent' : 'text-text-muted'
        }`}>
          {channel.number}
        </span>
      )}

      {/* 有 logo 才占位；没有就直接显示频道名，别用「首字方块」挤掉名字 */}
      {channel.logo && (
        <img
          src={channel.logo}
          alt=""
          className="w-7 h-7 rounded object-cover bg-bg-tertiary shrink-0"
          onError={(e) => {
            ;(e.target as HTMLImageElement).style.display = 'none'
          }}
        />
      )}

      {/* 频道名独占第一行；「不可用」「N/M 线路」放第二行，绝不压住名字 */}
      <div className="flex-1 min-w-0">
        <p className={`text-[13px] leading-5 truncate ${isActive ? 'font-medium' : ''}`} title={channel.name}>
          {channel.name}
        </p>
        {hasMeta && (
          <div
            className="mt-0.5 flex items-center gap-2 text-[10px] text-text-muted"
            title={lastTestHint(channel)}
          >
            {latency.label && (
              <span className={`shrink-0 font-mono ${latency.className}`}>{latency.label}</span>
            )}
            {lines.length > 0 && (
              <span className="shrink-0" title={`巡检结果：${aliveLines}/${lines.length} 条线路可达`}>
                {aliveLines}/{lines.length} 线路
              </span>
            )}
          </div>
        )}
      </div>

      {/* 活跃指示器 */}
      {isActive && <div className="w-1.5 h-1.5 rounded-full bg-accent shrink-0 animate-pulse" />}

      {/* 播放：只留图标，避免文字挤占频道名 */}
      <button
        type="button"
        title={`播放 ${channel.name}`}
        aria-label={`播放 ${channel.name}`}
        onClick={(event) => {
          event.stopPropagation()
          play()
        }}
        className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md border border-[#3a3a3a] text-text-secondary transition-colors hover:border-accent hover:text-accent"
      >
        <Play className="h-3 w-3" />
      </button>
    </div>
  )
}
