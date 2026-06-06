import { RefreshCw, Settings } from 'lucide-react'

interface LiveRefreshBarProps {
  isRefreshing: boolean
  refreshProgress: {
    phase: string
    current: number
    total: number
    message: string
  } | null
  lastRefreshTime: number
  refreshInterval: number
  onRefresh: () => void
  onSettings: () => void
}

export default function LiveRefreshBar({
  isRefreshing,
  refreshProgress,
  lastRefreshTime,
  refreshInterval,
  onRefresh,
  onSettings
}: LiveRefreshBarProps) {
  // 计算进度百分比
  const progressPercent = refreshProgress && refreshProgress.total > 0
    ? Math.round((refreshProgress.current / refreshProgress.total) * 100)
    : 0

  // 格式化时间
  const formatTime = (timestamp: number) => {
    if (!timestamp) return '未刷新'
    const date = new Date(timestamp * 1000)
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }

  return (
    <div className="border-b border-[#2a2a2a] px-3 py-2 bg-bg-secondary">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
              isRefreshing
                ? 'bg-accent-muted text-text-muted cursor-not-allowed'
                : 'bg-accent text-white hover:bg-accent-hover'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? '刷新中' : '刷新'}
          </button>
          <button
            onClick={onSettings}
            className="p-1 text-text-muted hover:text-accent transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="text-[10px] text-text-muted">
          上次刷新: {formatTime(lastRefreshTime)} · 间隔: {refreshInterval}分钟
        </div>
      </div>

      {/* 进度条 */}
      {isRefreshing && refreshProgress && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-text-muted">
            <span>{refreshProgress.message}</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="h-1 bg-bg-tertiary rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
