import { Trash2, Play } from 'lucide-react'
import type { Vod } from '@/stores/useConfigStore'

interface VodCardProps {
  vod: Vod
  onClick: (vod: Vod) => void
  loading?: boolean
  sourceName?: string
  /** 启用删除模式（覆盖层显示删除图标） */
  deleteMode?: boolean
  onDelete?: (vod: Vod) => void
}

/**
 * VOD 卡片
 * 参考：FongMi TV adapter_vod.xml year=蓝#2196F3 remark=绿#177535 site=红#F44336
 * hover: 白色边框1.5px + 深色背景，播放覆盖层居中
 */
export default function VodCard({ vod, onClick, loading, sourceName, deleteMode = false, onDelete }: VodCardProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2 animate-pulse">
        <div className="aspect-[2/3] rounded-lg bg-bg-tertiary" />
        <div className="h-4 w-3/4 rounded bg-bg-tertiary" />
      </div>
    )
  }

  return (
    <div
      className="group cursor-pointer flex flex-col rounded-lg overflow-hidden transition-colors"
      onClick={() => {
        if (!deleteMode) onClick(vod)
      }}
    >
      {/* 海报容器 — FongMi: 8dp圆角, hover: 白色边框 */}
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-bg-tertiary ring-0 group-hover:ring-[1.5px] group-hover:ring-white/60 transition-all duration-200">
        <img
          src={vod.vod_pic}
          alt={vod.vod_name}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => {
            ;(e.target as HTMLImageElement).src = ''
            ;(e.target as HTMLImageElement).classList.add('bg-bg-tertiary')
          }}
        />

        {/* 底部渐变遮罩 — FongMi: shape_vod_name 渐变背景 */}
        {/* Year badge（左上角）— FongMi: 蓝#2196F3 at 0.7 alpha, 左上右圆角 */}
        {vod.vod_year && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 text-[10px] font-medium text-white rounded-sm"
            style={{ background: 'rgba(33, 150, 243, 0.7)' }}>
            {vod.vod_year}
          </span>
        )}

        {/* Remarks badge（右上角）— FongMi: 绿#177535 at 0.7 alpha, 右上右圆角 */}
        {vod.vod_remarks && (
          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 text-[10px] font-medium text-white rounded-sm"
            style={{ background: 'rgba(23, 117, 53, 0.7)' }}>
            {vod.vod_remarks}
          </span>
        )}

        {/* Source badge（左下角）— FongMi: 红#F44336 at 0.7 alpha, 左上右圆角 */}
        {sourceName && (
          <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 text-[10px] text-white rounded-sm"
            style={{ background: 'rgba(244, 67, 54, 0.7)' }}>
            {sourceName}
          </span>
        )}

        {/* Hover play overlay — 居中播放按钮 */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-200 flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 w-9 h-9 rounded-full bg-accent/90 flex items-center justify-center shadow-lg">
            <Play className="w-[18px] h-[18px] text-white ml-0.5" />
          </div>
        </div>

        {/* Delete overlay（deleteMode 时） */}
        {deleteMode && (
          <div
            className="absolute inset-0 bg-black/60 flex items-center justify-center cursor-pointer z-10"
            onClick={(e) => {
              e.stopPropagation()
              onDelete?.(vod)
            }}
          >
            <Trash2 className="w-6 h-6 text-red-400" />
          </div>
        )}
      </div>

      {/* 标题 — FongMi: white 16sp, 居中 */}
      <h3 className="text-sm text-white line-clamp-1 leading-tight mt-1.5 px-0.5 group-hover:text-accent transition-colors">
        {vod.vod_name}
      </h3>

      {/* 分类/年份 */}
      {vod.type_name && (
        <p className="text-[11px] text-text-muted line-clamp-1 mt-0.5 px-0.5">{vod.type_name}</p>
      )}
    </div>
  )
}