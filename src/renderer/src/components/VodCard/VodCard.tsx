import { Vod } from '@/stores/useConfigStore'

interface VodCardProps {
  vod: Vod
  onClick: (vod: Vod) => void
  loading?: boolean
}

export default function VodCard({ vod, onClick, loading }: VodCardProps) {
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
      className="group cursor-pointer flex flex-col gap-2"
      onClick={() => onClick(vod)}
    >
      {/* 海报 */}
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-bg-tertiary">
        <img
          src={vod.vod_pic}
          alt={vod.vod_name}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
          onError={(e) => {
            ;(e.target as HTMLImageElement).src = ''
            ;(e.target as HTMLImageElement).classList.add('bg-bg-tertiary')
          }}
        />
        {/* 备注角标 */}
        {vod.vod_remarks && (
          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 text-[10px] font-medium bg-accent/90 text-bg-primary rounded">
            {vod.vod_remarks}
          </span>
        )}
        {/* Hover 遮罩 */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300" />
      </div>

      {/* 标题 */}
      <h3 className="text-sm text-text-primary line-clamp-1 leading-tight group-hover:text-accent transition-colors">
        {vod.vod_name}
      </h3>

      {/* 分类 */}
      {vod.type_name && (
        <p className="text-[11px] text-text-muted line-clamp-1">{vod.type_name}</p>
      )}
    </div>
  )
}
