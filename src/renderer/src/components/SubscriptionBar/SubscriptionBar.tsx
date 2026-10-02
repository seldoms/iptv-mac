import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ListPlus, Loader2, RefreshCw } from 'lucide-react'
import { configApi, invoke, liveApi, on } from '@/utils/ipc'
import { useConfigStore } from '@/stores/useConfigStore'

export default function SubscriptionBar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const switchRequestRef = useRef(0)
  const { configUrl, isLoading, loadConfig, subscriptions, subscriptionsError, reloadSubscriptions } =
    useConfigStore()
  const live = pathname === '/live'
  const loading = !live && isLoading

  // 订阅列表来自 store；路由或当前配置变化时重新读取（不再依赖 window 事件）
  useEffect(() => {
    void reloadSubscriptions()
  }, [pathname, configUrl, reloadSubscriptions])

  useEffect(() => {
    if (subscriptionsError) setError(subscriptionsError)
  }, [subscriptionsError])

  useEffect(() => {
    if (!live) return
    let cancelled = false
    let receivedProgress = false
    const cleanup = on('live:refreshProgress', (progress: any) => {
      receivedProgress = true
      setRefreshing(progress.phase !== 'done' && progress.phase !== 'error')
      if (progress.phase === 'error') setError(progress.message || '直播巡检失败')
      else setError('')
    })
    void liveApi.getRefreshStatus().then((status: any) => {
      if (!cancelled && !receivedProgress) setRefreshing(Boolean(status?.isRefreshing))
    }).catch(() => {})
    return () => { cancelled = true; cleanup() }
  }, [live])

  const refreshLive = async () => {
    setRefreshing(true)
    setError('')
    try { await invoke('live:refresh') }
    catch (error) { setError(error instanceof Error ? error.message : String(error || '直播巡检失败')); setRefreshing(false) }
  }

  const switchSubscription = async (url: string) => {
    const requestId = ++switchRequestRef.current
    setError('')
    navigate('/')
    const result = await loadConfig(url)
    if (requestId !== switchRequestRef.current) return
    if (!result.success) setError(result.error || '订阅加载失败')
  }

  useEffect(() => () => { switchRequestRef.current += 1 }, [])

  return (
    <div className="shrink-0 border-b border-[#2a2a2a] bg-bg-secondary px-4 py-2">
      <div className="flex items-center gap-3">
        {live ? <span className="min-w-0 flex-1 text-sm text-text-primary">全部直播订阅<span className="ml-3 text-xs text-text-muted">{refreshing ? '巡检中' : '已缓存频道'}</span></span> : <>
        <label htmlFor="subscription" className="shrink-0 text-xs text-text-muted">点播订阅</label>
        <select id="subscription" value={configUrl} onChange={(event) => void switchSubscription(event.target.value)}
          className="min-w-0 flex-1 rounded border border-[#3a3a3a] bg-bg-primary px-2 py-1 text-sm text-text-primary">
          <option value="" disabled>选择订阅</option>
          {subscriptions.map((item) => <option key={item.url} value={item.url}>{item.name || item.url}</option>)}
        </select>
        </>}
        {live && <button onClick={() => void refreshLive()} disabled={refreshing} title="立即巡检" aria-label="立即巡检" className="p-1 text-text-secondary hover:text-accent disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /></button>}
        {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-label="正在加载订阅" />}
        <button onClick={() => navigate('/settings')} title="管理订阅" aria-label="管理订阅" className="p-1 text-text-secondary hover:text-accent"><ListPlus className="h-4 w-4" /></button>
      </div>
      {error && <p role="alert" className="mt-1 break-words text-xs text-red-400">{error}</p>}
    </div>
  )
}
