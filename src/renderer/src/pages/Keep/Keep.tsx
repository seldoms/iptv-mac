import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Heart, Trash2 } from 'lucide-react'
import { keepApi } from '@/utils/ipc'
import VodCard from '@/components/VodCard/VodCard'
import { Vod } from '@/stores/useConfigStore'
import type { Keep as KeepItem } from '@shared/types'

export default function Keep() {
  const navigate = useNavigate()
  const [list, setList] = useState<KeepItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadKeep = async () => {
    setIsLoading(true)
    try {
      const data = (await keepApi.list()) as KeepItem[]
      setList(data.sort((a, b) => (b.createTime || 0) - (a.createTime || 0)))
    } catch {
      setList([])
    }
    setIsLoading(false)
  }

  useEffect(() => {
    loadKeep()
  }, [])

  const handleRemove = async (siteKey: string, vodId: string) => {
    await keepApi.delete(siteKey, vodId)
    setList((prev) => prev.filter((item) => item.siteKey !== siteKey || item.vodId !== vodId))
  }

  const handleVodClick = (vod: Vod, item: KeepItem) => {
    navigate(`/vod/${item.siteKey}/${item.vodId}`)
  }

  return (
    <div className="h-full flex flex-col">
      {/* 标题栏 */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
        <div className="flex items-center gap-2">
          <Heart className="w-5 h-5 text-accent" />
          <h2 className="text-lg font-medium text-text-primary">我的收藏</h2>
          <span className="text-xs text-text-muted">({list.length})</span>
        </div>
      </div>

      {/* 收藏列表 */}
      <div className="flex-1 overflow-y-auto scrollbar-dark p-6">
        {isLoading ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <VodCard key={i} vod={{ vod_id: '', vod_name: '', vod_pic: '', vod_remarks: '' }} onClick={() => {}} loading />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-text-muted">
            <Heart className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">暂无收藏</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
            {list.map((item) => (
              <div key={`${item.siteKey}:${item.vodId}`} className="group relative">
                <VodCard
                  vod={{
                    vod_id: item.vodId,
                    vod_name: item.vodName,
                    vod_pic: item.vodPic || '',
                    vod_remarks: ''
                  }}
                  onClick={(vod) => handleVodClick(vod, item)}
                />
                {/* 删除按钮 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemove(item.siteKey, item.vodId)
                  }}
                  className="absolute top-1 right-1 p-1 bg-black/60 rounded-full text-white/60 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
