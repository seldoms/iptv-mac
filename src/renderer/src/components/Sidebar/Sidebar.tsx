import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Home, Tv, Search, Clock, Heart, Settings, ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react'
import AppLogo from '@/components/AppLogo/AppLogo'

const navItems = [
  { icon: Home, label: '首页', path: '/' },
  { icon: Tv, label: '直播', path: '/live' },
  { icon: Search, label: '搜索', path: '/search' },
  { icon: Clock, label: '历史', path: '/history' },
  { icon: Heart, label: '收藏', path: '/keep' },
  { icon: Settings, label: '设置', path: '/settings' }
]

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  // 是否显示返回按钮（非根页面时显示）
  const showBack = !['/', '/live', '/search', '/history', '/keep', '/settings'].includes(location.pathname)

  return (
    <aside
      className={`flex flex-col h-full bg-bg-secondary border-r border-[#2a2a2a] transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-20'
      }`}
    >
      {/* Logo - 可拖动区域，用于移动窗口 */}
      <div className="flex items-center justify-center h-20 pt-6 border-b border-[#2a2a2a]" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <AppLogo />
        </div>
      </div>

      {/* 导航项 */}
      <nav className="flex-1 flex flex-col items-center py-4 gap-1">
        {/* 全局返回按钮 */}
        {showBack && (
          <button
            onClick={() => navigate(-1)}
            className="group relative flex flex-col items-center justify-center w-14 h-14 rounded-xl transition-all duration-200 text-text-muted hover:text-text-primary hover:bg-bg-hover"
            title="返回上一页"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-[10px] mt-1">返回</span>
          </button>
        )}

        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.path)
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`group relative flex flex-col items-center justify-center w-14 h-14 rounded-xl transition-all duration-200 ${
                active
                  ? 'text-accent bg-accent-muted'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
              }`}
              title={item.label}
            >
              <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
              <span className={`text-[10px] mt-1 ${active ? 'font-medium' : ''}`}>
                {item.label}
              </span>
              {active && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-accent rounded-r-full" />
              )}
            </button>
          )
        })}
      </nav>

      {/* 折叠按钮 */}
      <div className="flex items-center justify-center py-3 border-t border-[#2a2a2a]">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>
    </aside>
  )
}
