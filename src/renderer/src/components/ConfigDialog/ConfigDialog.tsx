import { useState, useRef, useEffect, useCallback } from 'react'
import { AlertCircle, Check } from 'lucide-react'
import Dialog, { DialogFooter } from '@/components/Dialog/Dialog'
import { configApi } from '@/utils/ipc'
import type { ConfigInspection } from '@shared/types'

interface ConfigDialogProps {
  open: boolean
  onClose: () => void
  initialUrl?: string
  onConfigSubmit: (url: string, name?: string) => Promise<{ success: boolean; error?: string }>
}

/**
 * 配置地址输入弹窗
 * 参考：FongMi TV ConfigDialog.java（smart prefix detection + QR code + choose/positive/negative）
 *
 * macOS 适配：无 QR 码扫描，改为显示本地服务器地址提示
 */
export default function ConfigDialog({
  open,
  onClose,
  initialUrl = '',
  onConfigSubmit
}: ConfigDialogProps) {
  const [url, setUrl] = useState(initialUrl)
  const [name, setName] = useState('')
  const [append, setAppend] = useState(true)
  const [isInspecting, setIsInspecting] = useState(false)
  const [inspection, setInspection] = useState<ConfigInspection | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setUrl(initialUrl)
      setName('')
      setAppend(true)
      setInspection(null)
      setIsInspecting(false)
      setSubmitting(false)
    }
  }, [open, initialUrl])

  // Focus input on open
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  /** FongMi-style smart prefix detection */
  const detectPrefix = useCallback(
    (s: string) => {
      if (!append) return
      if ('h' === s.toLowerCase()) {
        setAppend(false)
        setUrl('http://')
      } else if ('f' === s.toLowerCase()) {
        setAppend(false)
        setUrl('file://')
      } else if ('a' === s.toLowerCase()) {
        setAppend(false)
        setUrl('assets://')
      } else if (s.length > 1) {
        setAppend(false)
      } else if (s.length === 0) {
        setAppend(true)
      }
    },
    [append]
  )

  const handleUrlChange = (value: string) => {
    setUrl(value)
    detectPrefix(value)
    // Reset inspection when URL changes
    setInspection(null)
  }

  const handleInspect = async () => {
    if (!url.trim()) return
    setIsInspecting(true)
    setInspection(null)
    try {
      const result = await configApi.inspect(url.trim()) as { success: boolean; data?: ConfigInspection }
      if (result?.success && result.data) {
        setInspection(result.data)
      }
    } catch {
      // ignore
    } finally {
      setIsInspecting(false)
    }
  }

  const handleSubmit = async () => {
    if (!url.trim() || submitting) return
    setSubmitting(true)
    try {
      const result = await onConfigSubmit(url.trim(), name.trim() || undefined)
      if (result.success) {
        onClose()
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (inspection) {
        handleSubmit()
      } else {
        handleInspect()
      }
    }
  }

  const inspectionStats = (insp: ConfigInspection) => {
    const readySites = insp.probeInspectedSiteCount > 0 ? insp.probePassedSiteCount : insp.visibleSiteCount
    const parts: string[] = []
    if (readySites > 0) parts.push(`${readySites} 个点播站点`)
    if (insp.liveCount > 0) parts.push(`${insp.liveCount} 个直播源`)
    return parts.join('，') || '无可消费内容'
  }

  return (
    <Dialog open={open} onClose={onClose} title="添加配置地址" width="max-w-lg">
      <div className="space-y-3">
        {/* Smart prefix hint */}
        <p className="text-xs text-text-muted leading-5">
          支持 TVBox JSON 配置地址或 M3U/TXT 直播源直链。
          输入 <kbd className="px-1 py-0.5 rounded bg-bg-tertiary text-[11px] font-mono">h</kbd>{' '}
          自动补全 <kbd className="px-1 py-0.5 rounded bg-bg-tertiary text-[11px] font-mono">http://</kbd>，
          <kbd className="px-1 py-0.5 rounded bg-bg-tertiary text-[11px] font-mono">f</kbd> →{' '}
          <kbd className="px-1 py-0.5 rounded bg-bg-tertiary text-[11px] font-mono">file://</kbd>
        </p>

        {/* URL input */}
        <input
          ref={inputRef}
          type="text"
          value={url}
          onChange={(e) => handleUrlChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入配置地址（JSON URL）..."
          className="w-full px-3 py-2 text-sm bg-bg-primary border border-[#2a2a2a] rounded-lg text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-accent/50 transition-colors"
        />

        {/* Optional name */}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="自定义名称（可选）"
          className="w-full px-3 py-2 text-sm bg-bg-primary border border-[#2a2a2a] rounded-lg text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-accent/50 transition-colors"
        />

        {/* Inspection result */}
        {isInspecting && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <div className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
            预检中...
          </div>
        )}

        {inspection && !isInspecting && (
          <div className="rounded-lg border border-[#2a2a2a] bg-bg-primary p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-green-400" />
              <span className="text-xs text-text-primary font-medium">
                配置预检通过
              </span>
            </div>
            <p className="text-xs text-text-muted">{inspectionStats(inspection)}</p>

            {/* Warnings */}
            {inspection.warnings && inspection.warnings.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-[#2a2a2a]">
                {inspection.warnings.map((w, i) => (
                  <p key={i} className="flex items-start gap-1.5 text-[11px] text-yellow-400">
                    <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                    {w}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        {!inspection && !isInspecting && (
          <button
            onClick={handleInspect}
            disabled={!url.trim()}
            className="w-full py-2 text-sm rounded-lg bg-bg-tertiary text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-40"
          >
            预检配置
          </button>
        )}
      </div>

      <DialogFooter align="end">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-sm rounded-lg border border-[#2a2a2a] text-text-secondary hover:text-text-primary transition-colors"
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          disabled={!url.trim() || submitting || (inspection !== null && !inspection.canImport)}
          className="px-4 py-1.5 text-sm rounded-lg bg-accent text-bg-primary font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
        >
          {submitting ? '添加中...' : '添加配置'}
        </button>
      </DialogFooter>
    </Dialog>
  )
}