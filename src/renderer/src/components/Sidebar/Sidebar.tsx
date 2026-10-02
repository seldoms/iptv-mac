import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Home, Tv, Search, Clock, Heart, Settings, Download, ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react'
import AppLogo from '@/components/AppLogo/AppLogo'

const navItems = [
  { icon: Home, label: '首页', path: '/' },
  { icon: Tv, label: '直播', path: '/live' },
  { icon: Search, label: '搜索', path: '/search' },
  { icon: Clock, label: '历史', path: '/history' },
  { icon: Heart, label: '收藏', path: '/keep' },
  { icon: Settings, label: '设置', path: '/settings' },
  { icon: Download, label: '下载', path: '/downloads' }
]

interface SidebarProps {
  /** side：宽窗口的左侧竖栏；bottom：窄窗口的底部横条 */
  variant?: 'side' | 'bottom'
  className?: string
}

export default function Sidebar({ variant = 'side', className = '' }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const isActive = (path?: string) => {
    if (!path) return false
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  // 是否显示返回按钮（非根页面时显示）
  const showBack = !['/', '/live', '/search', '/history', '/keep', '/settings'].includes(location.pathname)

  if (variant === 'bottom') {
    return (
      <nav
        className={`h-14 shrink-0 flex items-stretch justify-around border-t border-[#2a2a2a] bg-bg-secondary ${className}`}
      >
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.path)
          return (
            <button
              key={item.path}
              onClick={() => {
                if (item.path) navigate(item.path)
              }}
              title={item.label}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
                active ? 'text-accent' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
              {item.label}
            </button>
          )
        })}
        {showBack && (
          <button
            onClick={() => navigate(-1)}
            title="返回上一页"
            className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] text-text-muted transition-colors hover:text-text-primary"
          >
            <ArrowLeft className="w-5 h-5" />
            返回
          </button>
        )}
      </nav>
    )
  }

  return (
    <aside
      className={`flex flex-col h-full bg-bg-secondary border-r border-[#2a2a2a] transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-20'
      } ${className}`}
    >
      {/* macOS 红绿灯（titleBarStyle: Overlay）叠在窗口左上角，留出高度免得压住 logo */}
      <div className="h-7 shrink-0" data-tauri-drag-region="deep" />
      {/* Logo - 可拖动区域 */}
      <div className="flex items-center justify-center h-16 shrink-0 border-b border-[#2a2a2a]" data-tauri-drag-region="deep">
        <div>
          <AppLogo />
        </div>
      </div>

      {/* 导航项 */}
      <nav className="flex-1 flex flex-col items-center py-3 gap-1">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.path)
          return (
            <button
              key={item.path}
              onClick={() => {
                if (item.path) navigate(item.path)
              }}
              className={`group relative flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-all duration-200 ${
                active
                  ? 'text-accent bg-accent-muted'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
              }`}
              title={item.label}
            >
              <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
              {!collapsed && (
                <span className={`text-[10px] mt-1 ${active ? 'font-medium' : ''}`}>
                  {item.label}
                </span>
              )}
              {active && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-accent rounded-r-full" />
              )}
            </button>
          )
        })}
        {/* 全局返回按钮 */}
        {showBack && (
          <button
            onClick={() => navigate(-1)}
            className="group relative flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-all duration-200 text-text-muted hover:text-text-primary hover:bg-bg-hover"
            title="返回上一页"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
      </nav>

      {/* 折叠按钮 */}
      <div className="flex items-center justify-center py-2 shrink-0 border-t border-[#2a2a2a]">
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
