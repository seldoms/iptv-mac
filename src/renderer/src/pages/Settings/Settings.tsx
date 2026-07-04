import { useState, useEffect } from 'react'
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
  Loader2,
  Save,
  X,
  Tv
} from 'lucide-react'
import { configApi, invoke, localApi, on, settingsApi } from '@/utils/ipc'
import { useConfigStore } from '@/stores/useConfigStore'
import type { ConfigInspection } from '@shared/types'
import { useNavigate } from 'react-router-dom'

// ==================== 内置推荐源 ====================
const DEFAULT_SOURCES = [
  { name: '多多影音', url: 'https://gitlab.com/duomv/dzhipy/-/raw/main/index.json', sites: 435, lives: 1, desc: '435 个点播站点 + 直播' },
  { name: '心魔在线', url: 'https://gh-proxy.com/raw.githubusercontent.com/yw88075/tvbox/main/yw.json', sites: 151, lives: 1, desc: '151 个点播站点' },
  { name: '高天流云', url: 'https://gh-proxy.com/https://raw.githubusercontent.com/gaotianliuyun/gao/master/js.json', sites: 298, lives: 2, desc: '298 个点播站点 + 直播' },
  { name: '宝盒备用', url: 'https://gh-proxy.com/https://raw.githubusercontent.com/guot55/yg/main/pg/bh.json', sites: 77, lives: 1, desc: '77 个点播站点 + 直播' },
  { name: 'D佬线路', url: 'http://rihou.cc:555/nzk/nzk0722.json', sites: 37, lives: 20, desc: '37 个点播站点 + 20 直播源' },
  { name: '小盒子单仓', url: 'http://xhztv.top/xhz', sites: 54, lives: 1, desc: '54 个点播站点 + 直播' },
  { name: '香雅晴线', url: 'https://gh-proxy.com/https://raw.githubusercontent.com/xyq254245/xyqonlinerule/main/XYQTVBox.json', sites: 48, lives: 3, desc: '48 个点播站点 + 直播' },
  { name: '多多内置', url: 'https://iduo.us.ci/gt/leevi0709/one/main/config.bin', sites: 91, lives: 10, desc: '91 个点播站点 + 10 直播源' },
]

interface ConfigItem {
  url: string
  name: string
  addTime: number
  updateTime: number
}

function compatibilityBadgeClass(compatibility: ConfigInspection['compatibility']) {
  if (compatibility === 'ready') return 'text-green-400'
  if (compatibility === 'live') return 'text-sky-300'
  if (compatibility === 'unsupported') return 'text-yellow-300'
  return 'text-red-300'
}

function usableVodSiteCount(inspection: ConfigInspection) {
  if (inspection.probeInspectedSiteCount > 0) return inspection.probePassedSiteCount
  return inspection.visibleSiteCount
}

function probeMetric(inspection: ConfigInspection) {
  if (inspection.probeInspectedSiteCount === 0) return '未抽样'
  return `${inspection.probePassedSiteCount}/${inspection.probeInspectedSiteCount}`
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
  const [deleteConfirmUrl, setDeleteConfirmUrl] = useState('')
  const [deletingConfigUrl, setDeletingConfigUrl] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [version, setVersion] = useState('1.0.0')
  const [localServer, setLocalServer] = useState<{ url: string; token: string }>({ url: '', token: '' })
  const { loadConfig } = useConfigStore()

  // 播放/网络设置状态
  const [dohUrl, setDohUrl] = useState('')
  const [proxyUrl, setProxyUrl] = useState('')
  const [hostsText, setHostsText] = useState('')
  const [adBlockEnabled, setAdBlockEnabled] = useState(false)
  const [defaultSpeed, setDefaultSpeed] = useState('1')
  const [danmakuEnabled, setDanmakuEnabled] = useState(true)
  const [playerEngine, setPlayerEngine] = useState<'auto' | 'native' | 'hlsjs'>('auto')
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  // 加载所有设置
  useEffect(() => {
    localApi.getServerInfo().then(setLocalServer).catch(() => {})
    Promise.all([
      settingsApi.get('dohUrl').catch(() => ''),
      settingsApi.get('proxyUrl').catch(() => ''),
      settingsApi.get('hostsText').catch(() => ''),
      settingsApi.get('adBlockEnabled').catch(() => false),
      settingsApi.get('defaultSpeed').catch(() => '1'),
      settingsApi.get('danmakuEnabled').catch(() => true),
      settingsApi.get('playerEngine').catch(() => 'auto'),
    ]).then(([doh, proxy, hosts, ad, speed, danmaku, engine]) => {
      setDohUrl(doh as string || '')
      setProxyUrl(proxy as string || '')
      setHostsText(hosts as string || '')
      setAdBlockEnabled(Boolean(ad))
      setDefaultSpeed(speed as string || '1')
      setDanmakuEnabled(Boolean(danmaku))
      setPlayerEngine((engine as string) as 'auto' | 'native' | 'hlsjs' || 'auto')
      setSettingsLoaded(true)
    })
  }, [])

  // 保存设置（防抖简易版）
  const saveSetting = (key: string, value: any) => {
    settingsApi.set(key, value).catch(() => {})
  }

  const [liveChecking, setLiveChecking] = useState(false)
  const [liveCheckProgress, setLiveCheckProgress] = useState<{
    phase: string; current: number; total: number; message: string
  } | null>(null)

  useEffect(() => {
    const cleanup = on('live:refreshProgress', (progress: any) => {
      setLiveCheckProgress(progress)
      setLiveChecking(progress.phase !== 'done' && progress.phase !== 'error')
    })
    return cleanup as () => void
  }, [])

  const handleLiveCheck = async () => {
    if (liveChecking) return
    setLiveChecking(true)
    setLiveCheckProgress({
      phase: 'loading',
      current: 0,
      total: 0,
      message: '正在批量测活...'
    })
    try {
      await invoke('live:refresh')
    } catch (e: any) {
      setLiveChecking(false)
      showMessage('error', '测活失败: ' + (e.message || '未知错误'))
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
      if (!currentInspection.canImport) {
        showMessage('error', '该配置暂不兼容：没有可用的 HTTP API 点播站点或直播源')
        return
      }

      const result = await configApi.load(url) as { success: boolean; error?: string; data?: any }
      if (result?.success) {
        setNewConfigUrl('')
        setInspection(null)
        setCurrentUrl(url)
        // 刷新首页内容
        await loadConfig(url)
        await loadData()
        showMessage('success', `配置添加成功：${usableVodSiteCount(currentInspection)} 个可用点播站点，${currentInspection.liveCount} 个直播源`)
      } else {
        showMessage('error', '加载配置失败: ' + (result?.error || '未知错误'))
      }
    } catch (err) {
      showMessage('error', '加载配置失败: ' + String(err))
    } finally {
      setLoading(false)
    }
  }

  const resetActiveConfig = () => {
    useConfigStore.getState().reset()
    useConfigStore.setState({
      sites: [],
      currentSiteKey: '',
      contentSiteKey: '',
      pendingSiteKey: '',
      categories: [],
      filters: {},
      homeVideos: [],
      categoryVideos: [],
      currentPage: 1,
      hasMore: false,
      isLoading: false,
      error: null
    })
  }

  const handleRequestDeleteConfig = (config: ConfigItem) => {
    if (deletingConfigUrl) return
    setDeleteConfirmUrl(config.url)
    if (editingConfigUrl === config.url) {
      setEditingConfigUrl('')
      setEditingConfigName('')
    }
  }

  // 删除配置
  const handleDeleteConfig = async (config: ConfigItem) => {
    const url = config.url
    const wasCurrent = url === currentUrl
    setDeletingConfigUrl(url)

    try {
      const result = await configApi.remove(url) as { success: boolean; error?: string }
      if (!result?.success) {
        showMessage('error', result?.error || '删除失败')
        return
      }

      const [freshList, freshUrl] = await Promise.all([
        configApi.list(),
        configApi.getCurrentUrl()
      ])
      const nextUrl = freshUrl || ''

      setConfigs(freshList || [])
      setCurrentUrl(nextUrl)
      setDeleteConfirmUrl('')

      if (wasCurrent) {
        if (nextUrl) {
          await loadConfig(nextUrl)
        } else {
          resetActiveConfig()
        }
      }

      showMessage('success', '配置已删除')
    } catch (err) {
      showMessage('error', '删除失败: ' + String(err))
    } finally {
      setDeletingConfigUrl('')
    }
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
    { key: 'live', label: '直播测活', icon: Tv },
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
                    setNewConfigUrl(e.target.value.trim())
                    setInspection(null)
                  }}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData('text').trim()
                    if (pasted) {
                      e.preventDefault()
                      setNewConfigUrl(pasted)
                      setInspection(null)
                    }
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
                  disabled={!newConfigUrl.trim() || loading || inspectLoading || (inspection?.url === newConfigUrl.trim() && !inspection.canImport)}
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
                    <span className={`shrink-0 text-xs ${compatibilityBadgeClass(inspection.compatibility)}`}>
                      {inspection.compatibilityLabel}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                    <div className="rounded-md bg-bg-tertiary px-3 py-2">
                      <p className="text-[11px] text-text-muted">点播站点</p>
                      <p className="text-sm text-text-primary mt-1">{inspection.visibleSiteCount}/{inspection.siteCount}</p>
                    </div>
                    <div className="rounded-md bg-bg-tertiary px-3 py-2">
                      <p className="text-[11px] text-text-muted">抽样通过</p>
                      <p className="text-sm text-text-primary mt-1">{probeMetric(inspection)}</p>
                    </div>
                    <div className="rounded-md bg-bg-tertiary px-3 py-2">
                      <p className="text-[11px] text-text-muted">直播源</p>
                      <p className="text-sm text-text-primary mt-1">{inspection.liveChannelCount > 0 ? `${inspection.liveCount}/${inspection.liveChannelCount}` : inspection.liveCount}</p>
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
                <div>
                  <div className="py-6 text-center">
                    <Link className="w-10 h-10 text-text-muted mx-auto mb-3" />
                    <p className="text-sm text-text-muted">暂无配置</p>
                    <p className="text-xs text-text-muted mt-1">推荐选一个内置源快速开始</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    {DEFAULT_SOURCES.map((src) => (
                      <button
                        key={src.url}
                        onClick={async () => {
                          setNewConfigUrl(src.url)
                          const insp = await inspectConfigUrl(src.url, { silent: true })
                          if (insp?.canImport) {
                            const result = await configApi.load(src.url) as { success: boolean; error?: string }
                            if (result.success) {
                              setNewConfigUrl('')
                              setInspection(null)
                              setCurrentUrl(src.url)
                              await loadConfig(src.url)
                              await loadData()
                              showMessage('success', `${src.name} 已添加`)
                            }
                          }
                        }}
                        className="rounded-lg border border-[#2a2a2a] bg-bg-secondary p-3 text-left transition-all hover:border-accent/40 hover:bg-bg-hover"
                      >
                        <p className="text-sm font-medium text-text-primary truncate">{src.name}</p>
                        <p className="text-[11px] text-text-muted mt-1">{src.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {configs.map((config) => {
                    const isActive = config.url === currentUrl
                    const isConfirmingDelete = deleteConfirmUrl === config.url
                    const isDeleting = deletingConfigUrl === config.url
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
                        {isConfirmingDelete ? (
                          <div className="shrink-0 flex items-center gap-1.5">
                            <span className="text-xs text-red-300">确认删除？</span>
                            <button
                              onClick={() => handleDeleteConfig(config)}
                              disabled={isDeleting}
                              className="shrink-0 p-1.5 text-red-300 hover:text-red-200 disabled:opacity-50 transition-colors"
                              title="确认删除"
                            >
                              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => setDeleteConfirmUrl('')}
                              disabled={isDeleting}
                              className="shrink-0 p-1.5 text-text-muted hover:text-text-primary disabled:opacity-50 transition-colors"
                              title="取消删除"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <>
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
                              onClick={() => handleRequestDeleteConfig(config)}
                              disabled={Boolean(deletingConfigUrl)}
                              className="shrink-0 p-1.5 text-text-muted hover:text-red-400 disabled:opacity-50 transition-colors"
                              title="删除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 直播测活 */}
        {activeTab === 'live' && (
          <div className="space-y-6 max-w-2xl">
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-3">批量测活</h3>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleLiveCheck}
                  disabled={liveChecking}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    liveChecking
                      ? 'bg-accent-muted text-text-muted cursor-not-allowed'
                      : 'bg-accent text-white hover:bg-accent-hover'
                  }`}
                >
                  <RefreshCw className={`w-4 h-4 ${liveChecking ? 'animate-spin' : ''}`} />
                  {liveChecking ? '测活中...' : '开始测活'}
                </button>
                <span className="text-xs text-text-muted">
                  手动测试直播线路连通性，不会自动切换当前选择的配置源。
                </span>
              </div>

              {liveCheckProgress && (
                <div className="mt-3 space-y-1">
                  <div className="flex items-center justify-between text-xs text-text-muted">
                    <span>{liveCheckProgress.message || '正在处理...'}</span>
                    <span>
                      {liveCheckProgress.total > 0
                        ? Math.round((liveCheckProgress.current / liveCheckProgress.total) * 100)
                        : 0}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent transition-all duration-300"
                      style={{
                        width: `${
                          liveCheckProgress.total > 0
                            ? Math.round((liveCheckProgress.current / liveCheckProgress.total) * 100)
                            : 0
                        }%`
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 网络设置 */}
        {activeTab === 'network' && (
          <div className="space-y-6 max-w-2xl">
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-3">DNS over HTTPS</h3>
              <select
                value={dohUrl}
                onChange={(e) => { setDohUrl(e.target.value); saveSetting('dohUrl', e.target.value) }}
                className="w-full px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary outline-none"
                disabled={!settingsLoaded}
              >
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
                value={proxyUrl}
                onChange={(e) => { setProxyUrl(e.target.value); saveSetting('proxyUrl', e.target.value) }}
                placeholder="代理地址，如 http://127.0.0.1:7890"
                className="w-full px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent"
                disabled={!settingsLoaded}
              />
              <p className="text-xs text-text-muted mt-1.5">支持 HTTP / HTTPS / SOCKS4 / SOCKS5 代理</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-3">Hosts 覆盖</h3>
              <textarea
                value={hostsText}
                onChange={(e) => { setHostsText(e.target.value); saveSetting('hostsText', e.target.value) }}
                placeholder="每行一条，格式：原始域名=目标域名或IP&#10;例：old.cdn.example.com=new.cdn.example.com"
                rows={4}
                className="w-full px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent resize-none"
                disabled={!settingsLoaded}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-text-primary">广告拦截</h3>
                <p className="text-xs text-text-muted mt-0.5">拦截配置中 ads 域名列表的请求</p>
              </div>
              <button
                onClick={() => { setAdBlockEnabled(!adBlockEnabled); saveSetting('adBlockEnabled', !adBlockEnabled) }}
                className={`w-10 h-6 rounded-full relative transition-colors ${adBlockEnabled ? 'bg-accent' : 'bg-bg-tertiary'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${adBlockEnabled ? 'right-1' : 'left-1'}`} />
              </button>
            </div>
          </div>
        )}

        {/* 播放设置 */}
        {activeTab === 'player' && (
          <div className="space-y-6 max-w-2xl">
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-3">HLS 播放引擎</h3>
              <select
                value={playerEngine}
                onChange={(e) => { setPlayerEngine(e.target.value as any); saveSetting('playerEngine', e.target.value) }}
                className="w-full px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary outline-none"
                disabled={!settingsLoaded}
              >
                <option value="auto">自动（优先原生）</option>
                <option value="native">原生（macOS 系统解码）</option>
                <option value="hlsjs">HLS.js（MSE 解码）</option>
              </select>
              <p className="text-xs text-text-muted mt-1.5">macOS 原生解码器兼容 HEVC/H.265；切换后需刷新页面生效</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-3">默认倍速</h3>
              <select
                value={defaultSpeed}
                onChange={(e) => { setDefaultSpeed(e.target.value); saveSetting('defaultSpeed', e.target.value) }}
                className="w-full px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary outline-none"
                disabled={!settingsLoaded}
              >
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
              <button
                onClick={() => { setDanmakuEnabled(!danmakuEnabled); saveSetting('danmakuEnabled', !danmakuEnabled) }}
                className={`w-10 h-6 rounded-full relative transition-colors ${danmakuEnabled ? 'bg-accent' : 'bg-bg-tertiary'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${danmakuEnabled ? 'right-1' : 'left-1'}`} />
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
