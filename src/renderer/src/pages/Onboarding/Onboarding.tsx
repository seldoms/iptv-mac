import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Check, Link, Loader2, Radio, Search, Star } from 'lucide-react'
import { configApi } from '@/utils/ipc'
import { useConfigStore } from '@/stores/useConfigStore'
import AppLogo from '@/components/AppLogo/AppLogo'
import type { ConfigInspection } from '@shared/types'

// ==================== 内置推荐源 ====================
// 来自 docs/TEST_SOURCES.md 中经 tvbox_probe 验证可用的源
const DEFAULT_SOURCES = [
  {
    name: '多多影音',
    url: 'https://gitlab.com/duomv/dzhipy/-/raw/main/index.json',
    sites: 435,
    lives: 1,
    desc: '435 个点播站点 + 直播',
  },
  {
    name: '心魔在线',
    url: 'https://gh-proxy.com/raw.githubusercontent.com/yw88075/tvbox/main/yw.json',
    sites: 151,
    lives: 1,
    desc: '151 个点播站点',
  },
  {
    name: '高天流云',
    url: 'https://gh-proxy.com/https://raw.githubusercontent.com/gaotianliuyun/gao/master/js.json',
    sites: 298,
    lives: 2,
    desc: '298 个点播站点 + 直播',
  },
  {
    name: '宝盒备用',
    url: 'https://gh-proxy.com/https://raw.githubusercontent.com/guot55/yg/main/pg/bh.json',
    sites: 77,
    lives: 1,
    desc: '77 个点播站点 + 直播',
  },
  {
    name: 'D佬线路',
    url: 'http://rihou.cc:555/nzk/nzk0722.json',
    sites: 37,
    lives: 20,
    desc: '37 个点播站点 + 20 直播源',
  },
  {
    name: '小盒子单仓',
    url: 'http://xhztv.top/xhz',
    sites: 54,
    lives: 1,
    desc: '54 个点播站点 + 直播',
  },
  {
    name: '香雅晴线',
    url: 'https://gh-proxy.com/https://raw.githubusercontent.com/xyq254245/xyqonlinerule/main/XYQTVBox.json',
    sites: 48,
    lives: 3,
    desc: '48 个点播站点 + 直播',
  },
  {
    name: '多多内置',
    url: 'https://iduo.us.ci/gt/leevi0709/one/main/config.bin',
    sites: 91,
    lives: 10,
    desc: '91 个点播站点 + 10 直播源',
  },
]

function compatibilityBadgeClass(compatibility: ConfigInspection['compatibility']) {
  if (compatibility === 'ready') return 'text-green-400'
  if (compatibility === 'live') return 'text-sky-300'
  if (compatibility === 'unsupported') return 'text-yellow-300'
  return 'text-red-300'
}

function hasUsableVodSites(inspection: ConfigInspection) {
  if (inspection.probeInspectedSiteCount > 0) return inspection.probePassedSiteCount > 0
  return inspection.visibleSiteCount > 0
}

function probeMetric(inspection: ConfigInspection) {
  if (inspection.probeInspectedSiteCount === 0) return '未抽样'
  return `${inspection.probePassedSiteCount}/${inspection.probeInspectedSiteCount}`
}

export default function Onboarding() {
  const navigate = useNavigate()
  const { loadConfig } = useConfigStore()
  const [url, setUrl] = useState('')
  const [inspection, setInspection] = useState<ConfigInspection | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [isInspecting, setIsInspecting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [defaultIndex, setDefaultIndex] = useState<number | null>(null)
  const importLockRef = useRef(false)

  const normalizedUrl = url.trim()

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
  }

  const inspect = async (targetUrl?: string): Promise<ConfigInspection | null> => {
    const inspectUrl = targetUrl || normalizedUrl
    if (!inspectUrl) return null
    setIsInspecting(true)
    setInspection(null)
    try {
      const result = await configApi.inspect(inspectUrl) as { success: boolean; data?: ConfigInspection; error?: string }
      if (result.success && result.data) {
        setInspection(result.data)
        showMessage('success', '配置预检通过')
        return result.data
      }
      showMessage('error', result.error || '配置预检失败')
      return null
    } catch (err) {
      showMessage('error', '配置预检失败: ' + String(err))
      return null
    } finally {
      setIsInspecting(false)
    }
  }

  const importConfig = async (targetUrl?: string) => {
    if (importLockRef.current) return
    importLockRef.current = true
    try {
      await doImport(targetUrl)
    } finally {
      importLockRef.current = false
    }
  }

  const doImport = async (targetUrl?: string) => {
    const importUrl = targetUrl || normalizedUrl
    if (!importUrl) return
    setIsImporting(true)
    try {
      const currentInspection = inspection?.url === importUrl ? inspection : await inspect(importUrl)
      if (!currentInspection) return
      if (!currentInspection.canImport) {
        showMessage('error', '该配置暂不兼容：没有可用的 HTTP API 点播站点或直播源')
        return
      }

      const result = await configApi.load(importUrl) as { success: boolean; error?: string }
      if (!result.success) {
        showMessage('error', result.error || '配置导入失败')
        return
      }

      await loadConfig(importUrl)
      showMessage('success', '配置导入成功')

      if (hasUsableVodSites(currentInspection)) {
        navigate('/', { replace: true })
      } else if (currentInspection.liveCount > 0) {
        navigate('/live', { replace: true })
      } else {
        navigate('/settings', { replace: true })
      }
    } catch (err) {
      showMessage('error', '配置导入失败: ' + String(err))
    } finally {
      setIsImporting(false)
    }
  }

  const handleDefaultClick = async (index: number) => {
    setDefaultIndex(index)
    const source = DEFAULT_SOURCES[index]
    setUrl(source.url)
    setInspection(null)
    setMessage(null)
    // 自动预检
    const insp = await inspect(source.url)
    // 如果预检通过就自动导入
    if (insp?.canImport) {
      await importConfig(source.url)
    }
    setDefaultIndex(null)
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').trim()
    if (pasted) {
      e.preventDefault()
      setUrl(pasted)
      setInspection(null)
      setMessage(null)
      // 粘贴的是 URL 时自动触发预检
      if (/^https?:\/\//i.test(pasted)) {
        setTimeout(() => inspect(pasted), 100)
      }
    }
  }

  const loading = isInspecting || isImporting

  return (
    <div className="h-full overflow-y-auto scrollbar-dark bg-bg-primary">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-8 py-10">
        <div className="mb-8">
          <AppLogo className="mb-4 h-14 w-14" />
          <h1 className="text-2xl font-semibold text-text-primary">开始使用 IPTV Mac</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">
            选择一个推荐源，或粘贴 TVBox/CatVod 配置地址快速开始。
          </p>
        </div>

        {/* 推荐源卡片 */}
        <div className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <Star className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-medium text-text-primary">推荐订阅源</h2>
            <span className="text-xs text-text-muted">点击即可使用</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {DEFAULT_SOURCES.map((source, index) => (
              <button
                key={source.url}
                onClick={() => handleDefaultClick(index)}
                disabled={loading}
                className={`group rounded-lg border border-[#2a2a2a] bg-bg-secondary p-3 text-left transition-all hover:border-accent/40 hover:bg-bg-hover disabled:opacity-60 ${
                  defaultIndex === index ? 'border-accent/50 ring-1 ring-accent/30' : ''
                }`}
              >
                <p className="truncate text-sm font-medium text-text-primary group-hover:text-accent transition-colors">
                  {source.name}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                  {source.desc}
                </p>
                {defaultIndex === index && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-accent">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    加载中...
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 手动输入 */}
        <div className="rounded-lg border border-[#2a2a2a] bg-bg-secondary p-4">
          <div className="mb-3 flex items-center gap-2">
            <Link className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-medium text-text-primary">或粘贴配置地址</h2>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value.trim())
                setInspection(null)
                setMessage(null)
              }}
              onPaste={handlePaste}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !loading) void importConfig()
              }}
              placeholder="https://example.com/config.json"
              className="min-w-0 flex-1 rounded-lg bg-bg-tertiary px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:ring-1 focus:ring-accent"
              disabled={loading}
              autoFocus
            />
            <button
              onClick={() => inspect()}
              disabled={!normalizedUrl || loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#2a2a2a] px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-hover disabled:opacity-50"
            >
              {isInspecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              预检
            </button>
            <button
              onClick={() => importConfig()}
              disabled={!normalizedUrl || loading || (inspection?.url === normalizedUrl && !inspection.canImport)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              导入
            </button>
          </div>

          {message && (
            <div className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
              message.type === 'success'
                ? 'border-green-500/20 bg-green-500/10 text-green-400'
                : 'border-red-500/20 bg-red-500/10 text-red-400'
            }`}>
              {message.type === 'success' ? <Check className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
              <span>{message.text}</span>
            </div>
          )}

          {inspection && (
            <div className="mt-4 rounded-lg border border-[#2a2a2a] bg-bg-primary p-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text-primary">{inspection.name}</p>
                  <p className="mt-0.5 truncate text-xs text-text-muted">{inspection.url}</p>
                </div>
                <span className={`shrink-0 text-xs ${compatibilityBadgeClass(inspection.compatibility)}`}>
                  {inspection.compatibilityLabel}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="点播站点" value={`${inspection.visibleSiteCount}/${inspection.siteCount}`} />
                <Metric label="抽样通过" value={probeMetric(inspection)} />
                <Metric label="直播源" value={inspection.liveChannelCount > 0 ? `${inspection.liveCount}/${inspection.liveChannelCount}` : String(inspection.liveCount)} />
                <Metric label="解析器" value={String(inspection.parseCount)} />
              </div>
              {inspection.warnings.length > 0 && (
                <div className="mt-3 space-y-1">
                  {inspection.warnings.map((warning) => (
                    <div key={warning} className="flex items-start gap-2 text-xs text-yellow-300">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[#2a2a2a] bg-bg-secondary p-4">
            <Radio className="mb-3 h-5 w-5 text-accent" />
            <h3 className="text-sm font-medium text-text-primary">直播配置</h3>
            <p className="mt-1 text-xs leading-5 text-text-muted">包含 lives 字段的配置会自动加载频道，并在直播页展示可用频道。</p>
          </div>
          <div className="rounded-lg border border-[#2a2a2a] bg-bg-secondary p-4">
            <Search className="mb-3 h-5 w-5 text-accent" />
            <h3 className="text-sm font-medium text-text-primary">点播站点</h3>
            <p className="mt-1 text-xs leading-5 text-text-muted">type=0/1/4 的站点会进入首页和搜索，暂不支持 type=3 Jar 插件站点。</p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-[#2a2a2a] pt-4">
          <button
            onClick={() => navigate('/settings')}
            className="text-sm text-text-muted transition-colors hover:text-text-primary"
          >
            稍后在设置中导入
          </button>
          <button
            onClick={() => navigate('/')}
            className="text-sm text-text-muted transition-colors hover:text-text-primary"
          >
            先进入应用
          </button>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-bg-tertiary px-3 py-2">
      <p className="text-[11px] text-text-muted">{label}</p>
      <p className="mt-1 text-sm text-text-primary">{value}</p>
    </div>
  )
}