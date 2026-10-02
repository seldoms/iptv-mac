import { useEffect, useRef, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import Sidebar from './components/Sidebar/Sidebar'
import SubscriptionBar from './components/SubscriptionBar/SubscriptionBar'
import WindowResizeHandles from './components/WindowResizeHandles/WindowResizeHandles'
import MiniChrome from './components/MiniChrome/MiniChrome'
import MiniPlayer from './components/MiniPlayer/MiniPlayer'
import Downloads from './pages/Downloads/Downloads'
import Home from './pages/Home/Home'
import VodDetail from './pages/VodDetail/VodDetail'
import Live from './pages/Live/Live'
import Search from './pages/Search/Search'
import History from './pages/History/History'
import Keep from './pages/Keep/Keep'
import Settings from './pages/Settings/Settings'
import Onboarding from './pages/Onboarding/Onboarding'
import AlphaPlaybackSmoke from './components/AlphaPlaybackSmoke/AlphaPlaybackSmoke'
import type { AlphaPlaybackSmokeConfig } from './components/AlphaPlaybackSmoke/AlphaPlaybackSmoke'
import BetaContinueSmoke from './components/BetaContinueSmoke/BetaContinueSmoke'
import type { BetaContinueSmokeConfig } from './components/BetaContinueSmoke/BetaContinueSmoke'
import { useConfigStore } from './stores/useConfigStore'
import { useUiStore } from './stores/useUiStore'
import { usePlayerStore } from './stores/usePlayerStore'
import { configApi, settingsApi, windowApi } from './utils/ipc'
import { resolveStartupConfigUrl } from './startupConfig'

export default function App() {
  const { loadConfig, setStartupReady } = useConfigStore()
  const didAutoLoad = useRef(false)
  const miniMode = useUiStore((state) => state.miniMode)
  // 有活着的播放器时，小窗沿用这个实例（只换布局），绝不重建播放器
  const hasLivePlayer = usePlayerStore((state) => Boolean(state.currentUrl))
  const [smokeConfig, setSmokeConfig] = useState<AlphaPlaybackSmokeConfig | null>(null)
  const [betaContinueSmokeConfig, setBetaContinueSmokeConfig] = useState<BetaContinueSmokeConfig | null>(null)


  // 让窗口装饰状态与 UI 模式一致：错位时会出现「完整界面 + 无边框小窗口」，拖不动也缩放不了
  useEffect(() => {
    void windowApi.applyMode(miniMode).catch((error) => {
      console.warn('[App] 同步窗口模式失败:', error)
    })
  }, [miniMode])

  // 启动时自动加载上次使用的配置
  useEffect(() => {
    if (miniMode) return
    if (didAutoLoad.current) return
    didAutoLoad.current = true

    console.log('[App] useEffect 启动, 开始自动加载配置')
    const autoLoad = async () => {
      try {
        const savedUrl = (await configApi.getCurrentUrl()) as string
        const startupUrl = resolveStartupConfigUrl(savedUrl)
        console.log('[App] getCurrentUrl:', savedUrl || '(empty)', 'startupUrl:', startupUrl)
        const first = await loadConfig(startupUrl)
        if (first.success) {
          console.log('[App] loadConfig 完成')
          return
        }

        // 上次订阅加载失败时**不再静默切换**到别的订阅：
        // 播放记录/收藏都按 siteKey 关联，悄悄换订阅会让用户看到「记录不是之前那个版本」。
        // 这里保留用户的选择，由用户手动重试或切换（顶栏订阅列表就在手边）。
        console.warn('[App] 上次订阅加载失败，保留用户选择，等待手动重试或切换:', startupUrl)
      } catch (err) {
        console.error('[App] 自动加载配置失败:', err)
      } finally {
        setStartupReady(true)
      }
    }
    autoLoad()
  }, [loadConfig, setStartupReady, miniMode])

  useEffect(() => {
    let cancelled = false
    const loadSmokeConfig = async () => {
      const value = await settingsApi.get('__alphaPlaybackSmoke') as AlphaPlaybackSmokeConfig | null
      if (!cancelled && value?.enabled) {
        setSmokeConfig(value)
      }
      const betaValue = await settingsApi.get('__betaContinueSmoke') as BetaContinueSmokeConfig | null
      if (!cancelled && betaValue?.enabled) {
        setBetaContinueSmokeConfig(betaValue)
      }
    }
    void loadSmokeConfig().catch(console.error)
    return () => {
      cancelled = true
    }
  }, [])

  if (smokeConfig?.enabled) {
    return <AlphaPlaybackSmoke config={smokeConfig} />
  }

  if (betaContinueSmokeConfig?.enabled) {
    return <BetaContinueSmoke config={betaContinueSmokeConfig} />
  }

  // 精简模式（小窗）：
  // - 从播放页切进来时，**保持整页挂载**，画面由仍活着的 VideoPlayer 铺满小窗
  //   （它自己会 `fixed inset-0 z-[9001]` 盖在黑遮罩上）。这样 HLS 实例、缓冲、
  //   播放位置全都不动，不会出现"切小窗画面中断"。
  // - 冷启动直接以 `?mode=mini` 打开（没有活着的播放器）时，才用 MiniPlayer
  //   从保存的播放状态恢复，作为兜底。
  if (miniMode && !hasLivePlayer) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-black">
        <WindowResizeHandles />
        <MiniPlayer />
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-primary">
      {/* 小窗模式：用黑遮罩盖住整页布局，画面由挂载中的 VideoPlayer 以更高层级铺满 */}
      {miniMode && (
        <>
          <div className="fixed inset-0 z-[9000] bg-black" />
          <WindowResizeHandles />
          <MiniChrome />
        </>
      )}
      {/* 宽窗口：左侧栏（窄于 900px 换成底部导航） */}
      <Sidebar className="hidden nav:flex" />
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部拖动条：只保留可拖动区域，去掉「IPTV」文字并压到最薄，给内容让出纵向空间 */}
        <div className="shrink-0 h-4 bg-bg-secondary" data-tauri-drag-region="deep" />
        <SubscriptionBar />
        <div className="flex-1 overflow-hidden">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/vod/:siteKey/:vodId" element={<VodDetail />} />
              <Route path="/live" element={<Live />} />
              <Route path="/search" element={<Search />} />
              <Route path="/history" element={<History />} />
              <Route path="/keep" element={<Keep />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/downloads" element={<Downloads />} />
              <Route path="/onboarding" element={<Onboarding />} />
            </Routes>
          </ErrorBoundary>
        </div>
        {/* 窄窗口：导航改为底部横条 */}
        <Sidebar variant="bottom" className="nav:hidden" />
      </main>
    </div>
  )
}
