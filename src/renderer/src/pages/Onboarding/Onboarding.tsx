import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Check, Link, Loader2, Radio, Search } from 'lucide-react'
import { configApi } from '@/utils/ipc'
import { useConfigStore } from '@/stores/useConfigStore'
import AppLogo from '@/components/AppLogo/AppLogo'
import type { ConfigInspection } from '@shared/types'

export default function Onboarding() {
  const navigate = useNavigate()
  const { loadConfig } = useConfigStore()
  const [url, setUrl] = useState('')
  const [inspection, setInspection] = useState<ConfigInspection | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [isInspecting, setIsInspecting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)

  const normalizedUrl = url.trim()

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
  }

  const inspect = async (): Promise<ConfigInspection | null> => {
    if (!normalizedUrl) return null
    setIsInspecting(true)
    setInspection(null)
    try {
      const result = await configApi.inspect(normalizedUrl) as { success: boolean; data?: ConfigInspection; error?: string }
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

  const importConfig = async () => {
    if (!normalizedUrl) return
    setIsImporting(true)
    try {
      const currentInspection = inspection?.url === normalizedUrl ? inspection : await inspect()
      if (!currentInspection) return

      const result = await configApi.load(normalizedUrl) as { success: boolean; error?: string }
      if (!result.success) {
        showMessage('error', result.error || '配置导入失败')
        return
      }

      await loadConfig(normalizedUrl)
      showMessage('success', '配置导入成功')

      if (currentInspection.visibleSiteCount > 0) {
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

  return (
    <div className="h-full overflow-y-auto scrollbar-dark bg-bg-primary">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-8 py-10">
        <div className="mb-8">
          <AppLogo className="mb-4 h-14 w-14" />
          <h1 className="text-2xl font-semibold text-text-primary">开始使用 IPTV Mac</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">
            已内置一组可测试的点播和直播源，打开即可使用。也可以在这里导入自己的 TVBox/CatVod 配置或直播源直链。
          </p>
        </div>

        <div className="rounded-lg border border-[#2a2a2a] bg-bg-secondary p-4">
          <div className="mb-3 flex items-center gap-2">
            <Link className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-medium text-text-primary">导入配置地址</h2>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value)
                setInspection(null)
                setMessage(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void importConfig()
              }}
              placeholder="https://example.com/config.json"
              className="min-w-0 flex-1 rounded-lg bg-bg-tertiary px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:ring-1 focus:ring-accent"
              disabled={isInspecting || isImporting}
              autoFocus
            />
            <button
              onClick={inspect}
              disabled={!normalizedUrl || isInspecting || isImporting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#2a2a2a] px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-hover disabled:opacity-50"
            >
              {isInspecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              预检
            </button>
            <button
              onClick={importConfig}
              disabled={!normalizedUrl || isInspecting || isImporting}
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
                <span className="shrink-0 text-xs text-green-400">可导入</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="点播站点" value={`${inspection.visibleSiteCount}/${inspection.siteCount}`} />
                <Metric label="可搜索" value={String(inspection.searchableSiteCount)} />
                <Metric label="直播源" value={String(inspection.liveCount)} />
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
