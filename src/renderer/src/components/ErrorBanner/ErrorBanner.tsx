import { AlertCircle, X } from 'lucide-react'

interface ErrorBannerProps {
  message: string
  onDismiss?: () => void
}

/**
 * 错误提示条 — FongMi TV 风格
 */
export default function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <div
      className="flex items-center gap-2 px-4 py-2 text-xs"
      style={{
        background: 'rgba(229, 57, 53, 0.15)',
        borderTop: '1px solid rgba(229, 57, 53, 0.3)',
        color: '#ef9a9a'
      }}
    >
      <AlertCircle className="w-3.5 h-3.5 shrink-0" style={{ color: '#ef5350' }} />
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="p-0.5 hover:opacity-70 transition-opacity">
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}