import { Channel } from '@/stores/useLiveStore'

interface ChannelItemProps {
  channel: Channel
  isActive: boolean
  onClick: (channel: Channel) => void
}

/** 将延时（毫秒）转为颜色类和标签 */
function latencyIndicator(ms: number | undefined): { className: string; label: string } {
  if (ms === undefined || ms === null) return { className: '', label: '' }
  if (ms < 80) return { className: 'text-green-400', label: `${ms}ms` }
  if (ms < 200) return { className: 'text-yellow-400', label: `${ms}ms` }
  return { className: 'text-red-400', label: `${ms}ms` }
}

export default function ChannelItem({ channel, isActive, onClick }: ChannelItemProps) {
  const latency = latencyIndicator(channel.latency)

  return (
    <button
      onClick={() => onClick(channel)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 text-left ${
        isActive
          ? 'bg-accent-muted text-accent'
          : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
      }`}
    >
      {/* 频道号 */}
      {channel.number && (
        <span className={`text-xs font-mono w-8 text-right shrink-0 ${
          isActive ? 'text-accent' : 'text-text-muted'
        }`}>
          {channel.number}
        </span>
      )}

      {/* Logo */}
      {channel.logo ? (
        <img
          src={channel.logo}
          alt=""
          className="w-8 h-8 rounded object-cover bg-bg-tertiary shrink-0"
          onError={(e) => {
            ;(e.target as HTMLImageElement).style.display = 'none'
          }}
        />
      ) : (
        <div className="w-8 h-8 rounded bg-bg-tertiary flex items-center justify-center shrink-0">
          <span className="text-xs text-text-muted">{channel.name[0]}</span>
        </div>
      )}

      {/* 名称 + 延时 */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <p className={`text-sm truncate ${isActive ? 'font-medium' : ''}`}>
          {channel.name}
        </p>
        {latency.label && (
          <span className={`shrink-0 text-[10px] font-mono ${latency.className}`}>
            {latency.label}
          </span>
        )}
      </div>

      {/* 活跃指示器 */}
      {isActive && (
        <div className="w-1.5 h-1.5 rounded-full bg-accent shrink-0 animate-pulse" />
      )}
    </button>
  )
}