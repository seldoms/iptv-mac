import { useEffect, useRef } from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import Sidebar from './components/Sidebar/Sidebar'
import MiniPlayer from './components/MiniPlayer/MiniPlayer'
import Home from './pages/Home/Home'
import VodDetail from './pages/VodDetail/VodDetail'
import Live from './pages/Live/Live'
import Search from './pages/Search/Search'
import History from './pages/History/History'
import Keep from './pages/Keep/Keep'
import Settings from './pages/Settings/Settings'
import Onboarding from './pages/Onboarding/Onboarding'
import { useConfigStore } from './stores/useConfigStore'
import { configApi } from './utils/ipc'

/** 检测是否为精简模式 */
function isMiniMode(): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.get('mode') === 'mini'
}

export default function App() {
  const { loadConfig } = useConfigStore()
  const navigate = useNavigate()
  const location = useLocation()
  const didAutoLoad = useRef(false)

  // 精简模式：只渲染 MiniPlayer
  if (isMiniMode()) {
    return <MiniPlayer />
  }

  // 启动时自动加载上次使用的配置
  useEffect(() => {
    if (didAutoLoad.current) return
    didAutoLoad.current = true

    console.log('[App] useEffect 启动, 开始自动加载配置')
    const autoLoad = async () => {
      try {
        const url = await configApi.getCurrentUrl() as string
        console.log('[App] getCurrentUrl:', url)
        if (!url) {
          console.log('[App] 未找到已保存配置，等待用户导入')
          if (location.pathname === '/') {
            navigate('/onboarding', { replace: true })
          }
          return
        }
        await loadConfig(url)
        console.log('[App] loadConfig 完成')
      } catch (err) {
        console.error('[App] 自动加载配置失败:', err)
      }
    }
    autoLoad()
  }, [loadConfig, location.pathname, navigate])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-primary">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部拖动条 - 用于移动窗口 */}
        <div className="shrink-0 h-8 flex items-center px-4 bg-bg-secondary border-b border-[#2a2a2a]" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <span className="text-[10px] text-text-muted select-none">IPTV</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/vod/:siteKey/:vodId" element={<VodDetail />} />
            <Route path="/live" element={<Live />} />
            <Route path="/search" element={<Search />} />
            <Route path="/history" element={<History />} />
            <Route path="/keep" element={<Keep />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/onboarding" element={<Onboarding />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
