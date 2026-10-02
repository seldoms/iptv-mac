import { useRef, useEffect, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import EmptyState from '@/components/EmptyState/EmptyState'
import type { ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'

type LayoutState = 'loading' | 'empty' | 'content'

interface ProgressLayoutProps {
  state: LayoutState
  loadingMessage?: string
  emptyIcon?: ComponentType<LucideProps>
  emptyTitle?: string
  emptyDescription?: string
  onRetry?: () => void
  children: ReactNode
}

/**
 * 三态视图管理组件
 * 参考：FongMi TV ProgressLayout.java (showProgress / showEmpty / showContent)
 */
export default function ProgressLayout({
  state,
  loadingMessage = '加载中...',
  emptyIcon,
  emptyTitle = '暂无内容',
  emptyDescription = '',
  onRetry,
  children
}: ProgressLayoutProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const prevState = useRef<LayoutState>(state)

  useEffect(() => {
    // content 状态进入时做淡入动画
    if (state === 'content' && prevState.current !== 'content' && contentRef.current) {
      contentRef.current.style.opacity = '0'
      const raf = requestAnimationFrame(() => {
        if (contentRef.current) contentRef.current.style.opacity = '1'
      })
      return () => cancelAnimationFrame(raf)
    }
    prevState.current = state
  }, [state])

  if (state === 'loading') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
        <p className="text-sm text-text-muted">{loadingMessage}</p>
      </div>
    )
  }

  if (state === 'empty') {
    return (
      <EmptyState
        icon={emptyIcon || Loader2}
        title={emptyTitle}
        description={emptyDescription}
        primaryLabel={onRetry ? '重试' : undefined}
        onPrimaryClick={onRetry}
      />
    )
  }

  // content
  return (
    <div
      ref={contentRef}
      className="flex-1 min-h-0 flex flex-col transition-opacity duration-200"
      style={{ opacity: 1 }}
    >
      {children}
    </div>
  )
}
