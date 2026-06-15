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
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  primaryLabel,
  onPrimaryClick,
  secondaryLabel,
  onSecondaryClick
}: EmptyStateProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-8 text-center">
      <Icon className="w-12 h-12 text-text-muted mb-4" />
      <h2 className="text-lg font-semibold text-text-primary mb-2">{title}</h2>
      <p className="text-sm text-text-muted mb-6 max-w-md leading-6">{description}</p>
      {(primaryLabel || secondaryLabel) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {primaryLabel && onPrimaryClick && (
            <button
              onClick={onPrimaryClick}
              className="px-4 py-2 bg-accent text-bg-primary rounded-lg font-medium hover:bg-accent-hover transition-colors"
            >
              {primaryLabel}
            </button>
          )}
          {secondaryLabel && onSecondaryClick && (
            <button
              onClick={onSecondaryClick}
              className="px-4 py-2 border border-[#2a2a2a] text-text-secondary rounded-lg hover:bg-bg-hover transition-colors"
            >
              {secondaryLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
