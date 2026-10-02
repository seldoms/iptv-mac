import { useRef, useEffect } from 'react'
import type { ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'

interface EmptyStateProps {
  icon: ComponentType<LucideProps>
  title: string
  description: string
  primaryLabel?: string
  onPrimaryClick?: () => void
  secondaryLabel?: string
  onSecondaryClick?: () => void
  /** 紧凑模式，用于 Dialog 等容器内部 */
  compact?: boolean
  /** 启用淡入动画 */
  animating?: boolean
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  primaryLabel,
  onPrimaryClick,
  secondaryLabel,
  onSecondaryClick,
  compact = false,
  animating = false
}: EmptyStateProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (animating && ref.current) {
      ref.current.style.opacity = '0'
      const raf = requestAnimationFrame(() => {
        if (ref.current) ref.current.style.opacity = '1'
      })
      return () => cancelAnimationFrame(raf)
    }
  }, [animating])

  return (
    <div
      ref={ref}
      className={`flex flex-col items-center justify-center text-center transition-opacity duration-200 ${
        compact ? 'p-4' : 'h-full p-8'
      }`}
    >
      <Icon className={`text-text-muted mb-4 ${compact ? 'w-6 h-6' : 'w-12 h-12'}`} />
      <h2 className={`font-semibold text-text-primary mb-2 ${compact ? 'text-sm' : 'text-lg'}`}>
        {title}
      </h2>
      <p className={`text-text-muted mb-6 leading-6 ${compact ? 'text-xs max-w-xs' : 'text-sm max-w-md'}`}>
        {description}
      </p>
      {(primaryLabel || secondaryLabel) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {primaryLabel && onPrimaryClick && (
            <button
              onClick={onPrimaryClick}
              className="px-4 py-2 bg-accent text-bg-primary rounded-lg font-medium hover:bg-accent-hover transition-colors text-sm"
            >
              {primaryLabel}
            </button>
          )}
          {secondaryLabel && onSecondaryClick && (
            <button
              onClick={onSecondaryClick}
              className="px-4 py-2 border border-[#2a2a2a] text-text-secondary rounded-lg hover:bg-bg-hover transition-colors text-sm"
            >
              {secondaryLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}