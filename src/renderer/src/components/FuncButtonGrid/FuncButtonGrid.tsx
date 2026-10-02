import { Tv, Search, Heart, MonitorUp, Settings, type LucideIcon } from 'lucide-react'

interface FuncItem {
  id: string
  label: string
  icon: LucideIcon
  route?: string
  action?: string
  condition?: (hasLive: boolean) => boolean
}

const FUNC_ITEMS: FuncItem[] = [
  // 「VOD浏览」指向首页自身，在首页里是冗余入口，已移除以节省空间。
  { id: 'live', label: '直播', icon: Tv, route: '/live', condition: (hasLive) => hasLive },
  { id: 'search', label: '搜索', icon: Search, route: '/search' },
  { id: 'keep', label: '收藏', icon: Heart, route: '/keep' },
  { id: 'push', label: '投屏', icon: MonitorUp, action: 'push' },
  { id: 'settings', label: '设置', icon: Settings, route: '/settings' },
]

interface FuncButtonGridProps {
  onNavigate: (route: string) => void
  onAction?: (action: string) => void
  hasLive?: boolean
}

/**
 * 功能按钮网格 — FongMi TV 风格
 * 参考：FuncPresenter.java + adapter_func.xml
 * 100x100dp 半透明底 + 36px 图标 + 18sp 标签，hover 白边框
 */
export default function FuncButtonGrid({ onNavigate, onAction, hasLive = false }: FuncButtonGridProps) {
  const visibleItems = FUNC_ITEMS.filter(
    (item) => !item.condition || item.condition(hasLive)
  )

  if (visibleItems.length === 0) return null

  return (
    <div className="flex items-center justify-center gap-3 py-3">
      {visibleItems.map((item) => (
        <button
          key={item.id}
          onClick={() => {
            if (item.route) onNavigate(item.route)
            else if (item.action) onAction?.(item.action)
          }}
          className="flex flex-col items-center justify-center w-[90px] h-[90px] rounded-xl transition-all duration-200 hover:ring-[1.5px] hover:ring-white/60 hover:bg-white/[0.08]"
          style={{ background: 'rgba(255,255,255,0.06)' }}
          title={item.label}
        >
          <item.icon className="w-7 h-7 text-white/70" />
          <span className="mt-2 text-xs text-white/60">
            {item.label}
          </span>
        </button>
      ))}
    </div>
  )
}