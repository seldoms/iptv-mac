import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Trash2, Play } from 'lucide-react'
import { historyApi } from '@/utils/ipc'

interface HistoryItem {
  vod_id: string
  site_key: string
  vod_name: string
  vod_pic: string
  source_name: string
  episode_name: string
  episode_url: string
  position: number
  duration: number
  updated_at: number
}

export default function History() {
  const navigate = useNavigate()
  const [list, setList] = useState<HistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadHistory = async () => {
    setIsLoading(true)
    try {
      const data = (await historyApi.list()) as HistoryItem[]
      setList(data.sort((a, b) => b.updated_at - a.updated_at))
    } catch {
      setList([])
    }
    setIsLoading(false)
  }

  useEffect(() => {
    loadHistory()
  }, [])

  const handleDelete = async (vodId: string) => {
    await historyApi.delete(vodId)
    setList((prev) => prev.filter((item) => item.vod_id !== vodId))
  }

  const handleClearAll = async () => {
    for (const item of list) {
      await historyApi.delete(item.vod_id)
    }
    setList([])
  }

  const handleClick = (item: HistoryItem) => {
    navigate(`/vod/${item.site_key}/${item.vod_id}`)
  }

  const formatProgress = (position: number, duration: number) => {
    if (!duration) return 0
    return Math.min(100, (position / duration) * 100)
  }

  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
    return d.toLocaleDateString('zh-CN')
  }

  return (
    <div className="h-full flex flex-col">
      {/* 标题栏 */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-accent" />
          <h2 className="text-lg font-medium text-text-primary">观看历史</h2>
          <span className="text-xs text-text-muted">({list.length})</span>
        </div>
        {list.length > 0 && (
          <button
            onClick={handleClearAll}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted hover:text-red-400 rounded-md hover:bg-bg-hover transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> 清空全部
          </button>
        )}
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto scrollbar-dark p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-text-muted text-sm">
            加载中...
          </div>
        ) : list.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-text-muted text-sm">
            暂无观看记录
          </div>
        ) : (
          <div className="space-y-3">
            {list.map((item) => (
              <div
                key={item.vod_id}
                className="flex items-center gap-4 p-3 rounded-lg bg-bg-secondary hover:bg-bg-hover cursor-pointer transition-colors group"
                onClick={() => handleClick(item)}
              >
                {/* 封面 */}
                <div className="shrink-0 w-16 h-22 rounded overflow-hidden bg-bg-tertiary">
                  <img
                    src={item.vod_pic}
                    alt={item.vod_name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                </div>

                {/* 信息 */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-text-primary truncate group-hover:text-accent transition-colors">
                    {item.vod_name}
                  </h3>
                  <p className="text-xs text-text-muted mt-1">
                    {item.source_name} · {item.episode_name || '未知集数'}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    {/* 进度条 */}
                    <div className="flex-1 h-1 bg-bg-tertiary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all"
                        style={{ width: `${formatProgress(item.position, item.duration)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-text-muted shrink-0">
                      {formatProgress(item.position, item.duration).toFixed(0)}%
                    </span>
                  </div>
                </div>

                {/* 时间和操作 */}
                <div className="shrink-0 flex flex-col items-end gap-2">
                  <span className="text-[10px] text-text-muted">{formatDate(item.updated_at)}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(item.vod_id)
                    }}
                    className="p-1 text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
