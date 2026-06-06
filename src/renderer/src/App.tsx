import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar/Sidebar'
import MiniPlayer from './components/MiniPlayer/MiniPlayer'
import Home from './pages/Home/Home'
import VodDetail from './pages/VodDetail/VodDetail'
import Live from './pages/Live/Live'
import Search from './pages/Search/Search'
import History from './pages/History/History'
import Keep from './pages/Keep/Keep'
import Settings from './pages/Settings/Settings'
import { useConfigStore } from './stores/useConfigStore'
import { configApi } from './utils/ipc'

/** 检测是否为精简模式 */
function isMiniMode(): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.get('mode') === 'mini'
}

export default function App() {
  const { loadConfig, sites } = useConfigStore()

  // 精简模式：只渲染 MiniPlayer
  if (isMiniMode()) {
    return <MiniPlayer />
  }

  // 启动时自动加载上次使用的配置
  useEffect(() => {
    console.log('[App] useEffect 启动, 开始自动加载配置')
    const autoLoad = async () => {
      try {
        let url = await configApi.getCurrentUrl() as string
        console.log('[App] getCurrentUrl:', url)
        // 如果主进程还没初始化完成，使用默认 URL
        if (!url) {
          url = 'http://xhztv.top/4k.json'
          console.log('[App] 使用默认URL:', url)
        }
        await loadConfig(url)
        console.log('[App] loadConfig 完成')
      } catch (err) {
        console.error('[App] 自动加载配置失败:', err)
      }
    }
    autoLoad()
  }, [])

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
          </Routes>
        </div>
      </main>
    </div>
  )
}
