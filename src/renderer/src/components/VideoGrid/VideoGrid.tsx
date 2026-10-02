import { Loader2 } from 'lucide-react'
import VodCard from '@/components/VodCard/VodCard'
import type { Vod } from '@/stores/useConfigStore'

interface VideoGridProps {
  videos: Vod[]
  isLoading: boolean
  onVodClick: (vod: Vod) => void
  contentSiteKey?: string
}

/**
 * 视频网格（无限滚动）
 * 参考：FongMi TV addVideo() + VodPresenter
 */
export default function VideoGrid({
  videos,
  isLoading,
  onVodClick,
  contentSiteKey
}: VideoGridProps) {
  // 首次加载骨架屏
  if (isLoading && videos.length === 0 && !contentSiteKey) {
    return (
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <VodCard key={i} vod={{ vod_id: '', vod_name: '', vod_pic: '', vod_remarks: '' }} onClick={() => {}} loading />
        ))}
      </div>
    )
  }

  if (videos.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-text-muted text-sm">
        {isLoading ? '加载中...' : '暂无内容，请尝试切换站点或配置源'}
      </div>
    )
  }

  return (
    <div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
        {videos.map((vod) => (
          <VodCard key={vod.vod_id} vod={vod} onClick={onVodClick} />
        ))}
      </div>

      {/* 加载更多 */}
      {isLoading && videos.length > 0 && (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 text-accent animate-spin" />
        </div>
      )}
    </div>
  )
}
