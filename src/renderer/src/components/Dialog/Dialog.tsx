import { useEffect, useRef, useCallback, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface DialogProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  width?: string
  showCloseButton?: boolean
}

/** 统一的模态对话框容器 */
export default function Dialog({
  open,
  onClose,
  title,
  children,
  width = 'max-w-lg',
  showCloseButton = true
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)

  // 焦点陷阱
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    },
    [onClose]
  )

  useEffect(() => {
    if (open) {
      previousActiveElement.current = document.activeElement as HTMLElement
      document.body.style.overflow = 'hidden'
      // 聚焦到第一个可聚焦元素
      requestAnimationFrame(() => {
        if (dialogRef.current) {
          const first = dialogRef.current.querySelector<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
          first?.focus()
        }
      })
      document.addEventListener('keydown', handleKeyDown)
    } else {
      document.body.style.overflow = ''
      previousActiveElement.current?.focus()
    }
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, handleKeyDown])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      {/* Dialog panel — FongMi: 半透明 glass 风格 */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative w-full ${width} mx-4 rounded-2xl shadow-2xl animate-scale-in max-h-[85vh] flex flex-col backdrop-blur-xl`}
        style={{ background: 'rgba(26, 26, 26, 0.92)', border: '1px solid rgba(255,255,255,0.08)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between shrink-0 px-5 pt-4 pb-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <h2 className="text-base font-semibold text-white">{title}</h2>
            {showCloseButton && (
              <button
                onClick={onClose}
                className="p-1 text-white/50 hover:text-white/80 transition-colors rounded-full hover:bg-white/10"
                aria-label="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-dark">
          {children}
        </div>
      </div>

      {/* Global animation keyframes — injected once */}
      <style>{`
        @keyframes dialog-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes dialog-scale-in {
          from { opacity: 0; transform: scale(0.95) translateY(4px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .animate-fade-in { animation: dialog-fade-in 150ms ease-out; }
        .animate-scale-in { animation: dialog-scale-in 200ms ease-out; }
      `}</style>
    </div>
  )
}

/** 对话框操作按钮栏 */
export function DialogFooter({ children, align = 'end' }: { children: ReactNode; align?: 'start' | 'end' | 'center' }) {
  const alignClass = align === 'end' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'
  return (
    <div className={`flex items-center gap-3 shrink-0 px-5 pt-3 pb-4 border-t border-[#2a2a2a] ${alignClass}`}>
      {children}
    </div>
  )
}