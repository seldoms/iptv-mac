import { useState, useEffect, useCallback } from 'react'
import {
  Settings as SettingsIcon,
  Plus,
  Trash2,
  RefreshCw,
  Globe,
  Monitor,
  Info,
  ChevronRight,
  Link,
  Check,
  AlertCircle,
  Edit3,
  Save,
  X,
  Tv
} from 'lucide-react'
import { configApi, invoke, localApi, on } from '@/utils/ipc'
import { useConfigStore } from '@/stores/useConfigStore'
import type { ConfigInspection } from '@shared/types'
 import { useNavigate } from 'react-router-dom'

interface ConfigItem {
  url: string
  name: string
  addTime: number
  updateTime: number
}

export default function Settings() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('config')
  const [configs, setConfigs] = useState<ConfigItem[]>([])
  const [currentUrl, setCurrentUrl] = useState('')
  const [newConfigUrl, setNewConfigUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [inspectLoading, setInspectLoading] = useState(false)
  const [inspection, setInspection] = useState<ConfigInspection | null>(null)
  const [editingConfigUrl, setEditingConfigUrl] = useState('')
  const [editingConfigName, setEditingConfigName] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [version, setVersion] = useState('1.0.0')
  const [localServer, setLocalServer] = useState<{ url: string; token: string }>({ url: '', token: '' })
  const { loadConfig } = useConfigStore()

  useEffect(() => {
    localApi.getServerInfo().then(setLocalServer).catch(() => {})
  }, [])

  // Live refresh state
  const [liveRefreshInterval, setLiveRefreshInterval] = useState(30)
  const [liveRefreshing, setLiveRefreshing] = useState(false)
  const [liveRefreshProgress, setLiveRefreshProgress] = useState<{
    phase: string; current: number; total: number; message: string
  } | null>(null)
  const [liveStats, setLiveStats] = useState<{ lastRefreshTime: number; totalChannels: number; aliveChannels: number } | null>(null)

  // Load live refresh status
  useEffect(() => {
    const handleProgress = (progress: any) => {
      setLiveRefreshProgress(progress)
      setLiveRefreshing(progress.phase !== 'done' && progress.phase !== 'error')
      if (progress.phase === 'done') {
        loadLiveStatus()
      }
    }

    const cleanup = on('live:refreshProgress', handleProgress)
    loadLiveStatus()

    return cleanup as () => void
  }, [])

  const loadLiveStatus = async () => {
    try {
      const status = await invoke('live:getRefreshStatus') as any
      if (status) {
        setLiveRefreshInterval(status.interval || 30)
        setLiveStats({
          lastRefreshTime: status.lastRefreshTime || 0,
          totalChannels: 0,
          aliveChannels: 0
        })
      }
    } catch (e) {
      // ignore
    }
  }

  const handleLiveRefresh = useCallback(async () => {
    if (liveRefreshing) return
    setLiveRefreshing(true)
    try {
      await invoke('live:refresh')
    } catch (e) {
      setLiveRefreshing(false)
    }
  }, [liveRefreshing])

  const handleLiveIntervalSave = async () => {
    try {
      const res = await invoke('live:setRefreshInterval', liveRefreshInterval) as { success: boolean; error?: string }
      if (res.success) {
        showMessage('success', `刷新间隔已设置为 ${liveRefreshInterval} 分钟`)
        await loadLiveStatus()
      } else {
        showMessage('error', res.error || '设置失败')
      }
    } catch (e: any) {
      showMessage('error', '设置失败: ' + (e.message || '未知错误'))
    }
  }

  // 加载配置列表和当前配置
  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [list, url] = await Promise.all([
        configApi.list(),
        configApi.getCurrentUrl()
      ])
      setConfigs(list || [])
      setCurrentUrl(url || '')
    } catch (err) {
      console.error('加载配置失败:', err)
    }
  }

  // 显示消息
  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 3000)
  }

  const inspectConfigUrl = async (url: string, options?: { silent?: boolean }): Promise<ConfigInspection | null> => {
    if (!url) return null
    setInspectLoading(true)
    setInspection(null)
    try {
      const result = await configApi.inspect(url) as { success: boolean; error?: string; data?: ConfigInspection }
      if (result?.success && result.data) {
        setInspection(result.data)
        if (!options?.silent) showMessage('success', '配置预检通过')
        return result.data
      }
      if (!options?.silent) showMessage('error', result?.error || '配置预检失败')
      return null
    } catch (err) {
      if (!options?.silent) showMessage('error', '配置预检失败: ' + String(err))
      return null
    } finally {
      setInspectLoading(false)
    }
  }

  const handleInspectConfig = async (): Promise<ConfigInspection | null> => {
    return inspectConfigUrl(newConfigUrl.trim())
  }

  // 添加配置
  const handleAddConfig = async () => {
    if (!newConfigUrl.trim()) return
    setLoading(true)
    try {
      const url = newConfigUrl.trim()
      const currentInspection = inspection?.url === url ? inspection : await handleInspectConfig()
      if (!currentInspection) return

      const result = await configApi.load(url) as { success: boolean; error?: string; data?: any }
      if (result?.success) {
        setNewConfigUrl('')
        setInspection(null)
        setCurrentUrl(url)
        // 刷新首页内容
        await loadConfig(url)
        await loadData()
        showMessage('success', `配置添加成功：${currentInspection.visibleSiteCount} 个点播站点，${currentInspection.liveCount} 个直播源`)
      } else {
        showMessage('error', '加载配置失败: ' + (result?.error || '未知错误'))
      }
    } catch (err) {
      showMessage('error', '加载配置失败: ' + String(err))
    } finally {
      setLoading(false)
    }
  }

  // 删除配置
 const handleDeleteConfig = async (config: ConfigItem) => {
   const confirmed = window.confirm(`确定删除配置「${config.name}」吗？`)
   if (!confirmed) return
   const url = config.url
   try {
     const result = await configApi.remove(url) as { success: boolean; error?: string }
     if (!result.success) {
       showMessage('error', result.error || '删除失败')
       return
     }
   } catch (err) {
      showMessage('error', '后端删除失败: ' + String(err))
     return
   }
   if (url === currentUrl) {
     setCurrentUrl('')
      useConfigStore.getState().reset()
      useConfigStore.setState({
        sites: [],
        currentSiteKey: '',
        categories: [],
        filters: {},
        homeVideos: [],
        categoryVideos: [],
        currentPage: 1,
        hasMore: false,
        isLoading: false,
        error: null,
      })
   }
   if (editingConfigUrl === url) {
     setEditingConfigUrl('')
     setEditingConfigName('')
   }
    const freshList = await configApi.list()
    const freshUrl = await configApi.getCurrentUrl()
    setConfigs(freshList || [])
    setCurrentUrl(freshUrl || '')
    showMessage('success', '配置已删除')
  }

  const handleStartRename = (config: ConfigItem) => {
    setEditingConfigUrl(config.url)
    setEditingConfigName(config.name)
  }

  const handleCancelRename = () => {
    setEditingConfigUrl('')
    setEditingConfigName('')
  }

  const handleSaveRename = async (url: string) => {
    const name = editingConfigName.trim()
    if (!name) {
      showMessage('error', '配置名称不能为空')
      return
    }
    try {
      const result = await configApi.rename(url, name) as { success: boolean; error?: string }
      if (result.success) {
        setEditingConfigUrl('')
        setEditingConfigName('')
        await loadData()
        showMessage('success', '配置名称已更新')
      } else {
        showMessage('error', result.error || '重命名失败')
      }
    } catch (err) {
      showMessage('error', '重命名失败: ' + String(err))
    }
  }

  const handleInspectSavedConfig = async (config: ConfigItem) => {
    const result = await inspectConfigUrl(config.url)
    if (result) {
      setNewConfigUrl(config.url)
    }
  }

  // 切换配置
  const handleSwitchConfig = async (url: string) => {
    setLoading(true)
    try {
      const result = await configApi.load(url) as { success: boolean; error?: string }
      if (result?.success) {
        setCurrentUrl(url)
        // 刷新首页内容
        await loadConfig(url)
        await loadData()
        showMessage('success', '配置切换成功')
      } else {
        showMessage('error', '切换配置失败: ' + (result?.error || '未知错误'))
      }
    } catch (err) {
      showMessage('error', '切换配置失败: ' + String(err))
    } finally {
      setLoading(false)
    }
  }

  const tabs = [
    { key: 'config', label: '配置管理', icon: Link },
    { key: 'live', label: '直播设置', icon: Tv },
    { key: 'network', label: '网络设置', icon: Globe },
    { key: 'player', label: '播放设置', icon: Monitor },
    { key: 'about', label: '关于', icon: Info }
  ]

  return (
    <div className="h-full flex">
      {/* 左侧标签 */}
      <div className="w-48 shrink-0 border-r border-[#2a2a2a] py-4 px-3">
        <div className="flex items-center gap-2 px-3 mb-4">
          <SettingsIcon className="w-5 h-5 text-accent" />
          <h2 className="text-base font-medium text-text-primary">设置</h2>
        </div>
        <nav className="space-y-1">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  activeTab === tab.key
                    ? 'bg-accent-muted text-accent'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            )
          })}
        </nav>
      </div>

      {/* 右侧内容 */}
      <div className="flex-1 overflow-y-auto scrollbar-dark p-6">
        {/* 消息提示 */}
        {message && (
          <div className={`mb-4 flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
              : 'bg-red-500/10 text-red-400 border border-red-500/20'
          }`}>
            {message.type === 'success' ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            {message.text}
          </div>
        )}

        {/* 配置管理 */}
        {activeTab === 'config' && (
          <div className="space-y-6 max-w-2xl">
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-3">添加配置</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newConfigUrl}
                  onChange={(e) => {
                    setNewConfigUrl(e.target.value)
                    setInspection(null)
                  }}
                  placeholder="输入配置地址（JSON URL）..."
                  className="flex-1 px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddConfig()}
                  disabled={loading || inspectLoading}
                />
                <button
                  onClick={handleInspectConfig}
                  disabled={!newConfigUrl.trim() || loading || inspectLoading}
                  className="flex items-center gap-1.5 px-4 py-2 border border-[#2a2a2a] hover:bg-bg-hover disabled:opacity-50 text-text-secondary text-sm font-medium rounded-lg transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${inspectLoading ? 'animate-spin' : ''}`} />
                  {inspectLoading ? '预检中...' : '预检'}
                </button>
                <button
                  onClick={handleAddConfig}
                  disabled={!newConfigUrl.trim() || loading || inspectLoading}
                  className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-bg-primary text-sm font-medium rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" /> {loading ? '加载中...' : '添加'}
                </button>
              </div>
              <p className="text-xs text-text-muted mt-2">
                输入 FongMi/TV 兼容的配置 JSON 地址，加载后即可浏览内容
              </p>
              {inspection && (
                <div className="mt-3 rounded-lg border border-[#2a2a2a] bg-bg-secondary p-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{inspection.name}</p>
                      <p className="text-xs text-text-muted truncate mt-0.5">{inspection.url}</p>
                    </div>
                    <span className="shrink-0 text-xs text-green-400">可导入</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                    <div className="rounded-md bg-bg-tertiary px-3 py-2">
                      <p className="text-[11px] text-text-muted">点播站点</p>
                      <p className="text-sm text-text-primary mt-1">{inspection.visibleSiteCount}/{inspection.siteCount}</p>
                    </div>
                    <div className="rounded-md bg-bg-tertiary px-3 py-2">
                      <p className="text-[11px] text-text-muted">可搜索</p>
                      <p className="text-sm text-text-primary mt-1">{inspection.searchableSiteCount}</p>
                    </div>
                    <div className="rounded-md bg-bg-tertiary px-3 py-2">
                      <p className="text-[11px] text-text-muted">直播源</p>
                      <p className="text-sm text-text-primary mt-1">{inspection.liveCount}</p>
                    </div>
                    <div className="rounded-md bg-bg-tertiary px-3 py-2">
                      <p className="text-[11px] text-text-muted">解析器</p>
                      <p className="text-sm text-text-primary mt-1">{inspection.parseCount}</p>
                    </div>
                  </div>
                  {inspection.warnings.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {inspection.warnings.map((warning) => (
                        <div key={warning} className="flex items-start gap-2 text-xs text-yellow-300">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{warning}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-medium text-text-primary mb-3">配置列表</h3>
              {configs.length === 0 ? (
                <div className="py-8 text-center">
                  <Link className="w-10 h-10 text-text-muted mx-auto mb-3" />
                  <p className="text-sm text-text-muted">暂无配置</p>
                  <p className="text-xs text-text-muted mt-1">在上方输入配置地址添加</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {configs.map((config) => {
                    const isActive = config.url === currentUrl
                    return (
                      <div
                        key={config.url}
                        className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${
                          isActive
                            ? 'border-accent/30 bg-accent-muted'
                            : 'border-[#2a2a2a] bg-bg-secondary hover:bg-bg-hover'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          {editingConfigUrl === config.url ? (
                            <input
                              value={editingConfigName}
                              onChange={(e) => setEditingConfigName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveRename(config.url)
                                if (e.key === 'Escape') handleCancelRename()
                              }}
                              className="w-full px-2 py-1 bg-bg-tertiary rounded-md text-sm text-text-primary outline-none focus:ring-1 focus:ring-accent"
                              autoFocus
                            />
                          ) : (
                            <p className={`text-sm truncate ${isActive ? 'text-accent' : 'text-text-primary'}`}>
                              {config.name}
                            </p>
                          )}
                          <p className="text-xs text-text-muted truncate mt-0.5">{config.url}</p>
                        </div>
                        {editingConfigUrl === config.url ? (
                          <>
                            <button
                              onClick={() => handleSaveRename(config.url)}
                              className="shrink-0 p-1.5 text-text-muted hover:text-green-400 transition-colors"
                              title="保存名称"
                            >
                              <Save className="w-4 h-4" />
                            </button>
                            <button
                              onClick={handleCancelRename}
                              className="shrink-0 p-1.5 text-text-muted hover:text-red-400 transition-colors"
                              title="取消编辑"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleStartRename(config)}
                            className="shrink-0 p-1.5 text-text-muted hover:text-accent transition-colors"
                            title="重命名"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleInspectSavedConfig(config)}
                          disabled={inspectLoading || loading}
                          className="shrink-0 p-1.5 text-text-muted hover:text-accent disabled:opacity-50 transition-colors"
                          title="重新预检"
                        >
                          <AlertCircle className="w-4 h-4" />
                        </button>
                        {!isActive && (
                          <button
                            onClick={() => handleSwitchConfig(config.url)}
                            className="shrink-0 p-1.5 text-text-muted hover:text-accent transition-colors"
                            title="切换到此配置"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                        )}
                        {isActive && (
                          <span className="shrink-0 text-xs text-accent font-medium">当前</span>
                        )}
                        <button
                          onClick={() => handleDeleteConfig(config)}
                          className="shrink-0 p-1.5 text-text-muted hover:text-red-400 transition-colors"
                          title="删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 直播设置 */}
        {activeTab === 'live' && (
          <div className="space-y-6 max-w-2xl">
            {/* 手动刷新 */}
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-3">频道刷新</h3>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleLiveRefresh}
                  disabled={liveRefreshing}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    liveRefreshing
                      ? 'bg-accent-muted text-text-muted cursor-not-allowed'
                      : 'bg-accent text-white hover:bg-accent-hover'
                  }`}
                >
                  <RefreshCw className={`w-4 h-4 ${liveRefreshing ? 'animate-spin' : ''}`} />
                  {liveRefreshing ? '刷新中...' : '立即刷新'}
                </button>
                <span className="text-xs text-text-muted">
                  刷新将测试所有直播源的 URL 连通性，去重选优后按 国家-类别-频道 分类
                </span>
              </div>

              {/* 刷新进度 */}
              {liveRefreshing && liveRefreshProgress && (
                <div className="mt-3 space-y-1">
                  <div className="flex items-center justify-between text-xs text-text-muted">
                    <span>{liveRefreshProgress.message}</span>
                    <span>
                      {liveRefreshProgress.total > 0
                        ? Math.round((liveRefreshProgress.current / liveRefreshProgress.total) * 100)
                        : 0}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent transition-all duration-300"
                      style={{
                        width: `${
                          liveRefreshProgress.total > 0
                            ? Math.round((liveRefreshProgress.current / liveRefreshProgress.total) * 100)
                            : 0
                        }%`
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 刷新间隔 */}
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-3">自动刷新间隔</h3>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={liveRefreshInterval}
                  onChange={(e) => setLiveRefreshInterval(parseInt(e.target.value) || 30)}
                  min={1}
                  max={1440}
                  className="w-20 px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary text-center outline-none focus:ring-1 focus:ring-accent border border-[#2a2a2a]"
                />
                <span className="text-sm text-text-secondary">分钟</span>
                <button
                  onClick={handleLiveIntervalSave}
                  className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors"
                >
                  保存
                </button>
              </div>
              <p className="text-xs text-text-muted mt-2">
                后台将自动定时刷新直播源，测试 URL 连通性并更新频道列表
              </p>
            </div>

            {/* 刷新状态 */}
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-3">刷新状态</h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between py-2 px-3 bg-bg-secondary rounded-lg border border-[#2a2a2a]">
                  <span className="text-text-secondary">上次刷新时间</span>
                  <span className="text-text-primary">
                    {liveStats?.lastRefreshTime
                      ? new Date(liveStats.lastRefreshTime * 1000).toLocaleString('zh-CN')
                      : '尚未刷新'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 px-3 bg-bg-secondary rounded-lg border border-[#2a2a2a]">
                  <span className="text-text-secondary">当前状态</span>
                  <span className={liveRefreshing ? 'text-accent' : 'text-green-400'}>
                    {liveRefreshing ? '刷新中' : '空闲'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 网络设置 */}
        {activeTab === 'network' && (
          <div className="space-y-6 max-w-2xl">
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-3">DNS over HTTPS</h3>
              <select className="w-full px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary outline-none">
                <option value="">关闭</option>
                <option value="https://dns.alidns.com/dns-query">阿里 DNS</option>
                <option value="https://doh.pub/dns-query">腾讯 DNS</option>
                <option value="https://dns.google/dns-query">Google DNS</option>
              </select>
            </div>
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-3">代理设置</h3>
              <input
                type="text"
                placeholder="代理地址，如 http://127.0.0.1:7890"
                className="w-full px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent"
              />
              <p className="text-xs text-text-muted mt-1.5">支持 HTTP / HTTPS / SOCKS4 / SOCKS5 代理</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-3">Hosts 覆盖</h3>
              <textarea
                placeholder="每行一条，格式：原始域名=目标域名或IP&#10;例：old.cdn.example.com=new.cdn.example.com"
                rows={4}
                className="w-full px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent resize-none"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-text-primary">广告拦截</h3>
                <p className="text-xs text-text-muted mt-0.5">拦截配置中 ads 域名列表的请求</p>
              </div>
              <button className="w-10 h-6 rounded-full bg-bg-tertiary relative transition-colors">
                <div className="w-4 h-4 rounded-full bg-text-muted absolute top-1 left-1 transition-all" />
              </button>
            </div>
          </div>
        )}

        {/* 播放设置 */}
        {activeTab === 'player' && (
          <div className="space-y-6 max-w-2xl">
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-3">默认解析器</h3>
              <select className="w-full px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary outline-none">
                <option value="">系统默认</option>
              </select>
            </div>
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-3">默认倍速</h3>
              <select className="w-full px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary outline-none">
                <option value="0.5">0.5x</option>
                <option value="0.75">0.75x</option>
                <option value="1">1x（默认）</option>
                <option value="1.25">1.25x</option>
                <option value="1.5">1.5x</option>
                <option value="2">2x</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-text-primary">弹幕默认开启</h3>
                <p className="text-xs text-text-muted mt-0.5">播放时自动显示弹幕</p>
              </div>
              <button className="w-10 h-6 rounded-full bg-accent relative">
                <div className="w-4 h-4 rounded-full bg-white absolute top-1 right-1 transition-all" />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-text-primary">硬件加速</h3>
                <p className="text-xs text-text-muted mt-0.5">使用 GPU 加速视频解码</p>
              </div>
              <button className="w-10 h-6 rounded-full bg-accent relative">
                <div className="w-4 h-4 rounded-full bg-white absolute top-1 right-1 transition-all" />
              </button>
            </div>
          </div>
        )}

        {/* 关于 */}
        {activeTab === 'about' && (
          <div className="space-y-6 max-w-2xl">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-accent flex items-center justify-center">
                <Monitor className="w-8 h-8 text-bg-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-text-primary">IPTV Mac</h3>
                <p className="text-sm text-text-muted">版本 {version}</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-text-secondary">当前版本</span>
                <span className="text-sm text-text-primary">{version}</span>
              </div>
              <button className="flex items-center justify-between w-full py-2 group">
                <span className="text-sm text-text-secondary">检查更新</span>
                <ChevronRight className="w-4 h-4 text-text-muted group-hover:text-accent transition-colors" />
              </button>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-text-secondary">基于</span>
                <span className="text-sm text-accent">FongMi/TV</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-text-secondary">本地服务</span>
                <span className="text-sm text-text-primary">{localServer.url || '未启动'}</span>
              </div>
              <div className="flex items-start justify-between gap-6 py-2">
                <span className="text-sm text-text-secondary">API Token</span>
                <span className="text-xs text-text-primary font-mono break-all text-right">
                  {localServer.token}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
