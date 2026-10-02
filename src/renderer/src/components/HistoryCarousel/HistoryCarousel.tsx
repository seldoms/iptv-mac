import { useRef } from 'react'
import { Clock, Trash2 } from 'lucide-react'
import type { History } from '@shared/types'

interface HistoryCarouselProps {
  items: History[]
  onItemClick: (item: History) => void
  onItemDelete?: (item: History) => void
  deleteMode?: boolean
  onClearAll?: () => void
}

/**
 * 继续观看横向滚动列表 — FongMi TV 风格
 * 参考：HistoryPresenter + adapter_vod.xml
 */
export default function HistoryCarousel({
  items,
  onItemClick,
  onItemDelete,
  deleteMode = false,
  onClearAll
}: HistoryCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const formatResumeTime = (seconds = 0): string => {
    const safeSeconds = Math.max(0, Math.floor(seconds))
    const h = Math.floor(safeSeconds / 3600)
    const m = Math.floor((safeSeconds % 3600) / 60)
    const s = safeSeconds % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }

  if (items.length === 0) return null

  return (
    <section className="py-2">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-4 h-4 text-accent" />
        <h2 className="text-sm font-medium text-white">继续观看</h2>
        <div className="flex-1" />
        {items.length > 0 && onClearAll && (
          <button
            onClick={onClearAll}
            className="text-[11px] text-white/50 hover:text-white/80 transition-colors"
          >
            清除全部
          </button>
        )}
      </div>
      <div
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto scrollbar-dark pb-1 -mx-2 px-2 snap-x"
      >
        {items.map((item) => (
          <button
            key={`${item.siteKey}:${item.vodId}`}
            onClick={() => {
              if (deleteMode) {
                onItemDelete?.(item)
              } else {
                onItemClick(item)
              }
            }}
            className="flex gap-2.5 w-[280px] shrink-0 snap-start rounded-lg p-2.5 text-left transition-all duration-200 hover:ring-[1.5px] hover:ring-white/60"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          >
            {/* Poster */}
            <div className="relative w-12 h-16 shrink-0 overflow-hidden rounded bg-black/20">
              {item.vodPic && (
                <img
                  src={item.vodPic}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              )}
              {deleteMode && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <Trash2 className="w-4 h-4 text-red-400" />
                </div>
              )}
            </div>
            {/* Info */}
            <div className="min-w-0 flex-1 flex flex-col justify-center">
              <p className="text-sm text-white truncate">{item.vodName}</p>
              <p className="mt-0.5 text-[11px] text-white/50 truncate">
                {item.episodeName || item.sourceName || '上次观看'}
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.max(0, Math.min(100, item.progress || 0))}%` }}
                  />
                </div>
                <span className="shrink-0 text-[10px] text-white/50">
                  {(item.positionSeconds || 0) > 0
                    ? formatResumeTime(item.positionSeconds)
                    : `${item.progress || 0}%`}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}