import { useEffect, useCallback } from 'react'

type KeyHandler = (e: KeyboardEvent) => void

interface KeyboardNavOptions {
  /** 监听 Escape 键 */
  onEscape?: () => void
  /** 左右方向键 */
  onArrowLeft?: () => void
  onArrowRight?: () => void
  /** 上下方向键 */
  onArrowUp?: () => void
  onArrowDown?: () => void
  /** Enter 键 */
  onEnter?: () => void
  /** 刷新键（F5 / Ctrl+R） */
  onRefresh?: () => void
  /** 启用条件 */
  enabled?: boolean
}

const REFRESH_COOLDOWN_MS = 3000

/**
 * 键盘导航 Hook
 * 参考：FongMi TV 的 dispatchKeyEvent + CustomTitleView 方向键切换站点
 */
export function useKeyboardNav({
  onEscape,
  onArrowLeft,
  onArrowRight,
  onArrowUp,
  onArrowDown,
  onEnter,
  onRefresh,
  enabled = true
}: KeyboardNavOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return

      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          onEscape?.()
          break
        case 'ArrowLeft':
          e.preventDefault()
          onArrowLeft?.()
          break
        case 'ArrowRight':
          e.preventDefault()
          onArrowRight?.()
          break
        case 'ArrowUp':
          e.preventDefault()
          onArrowUp?.()
          break
        case 'ArrowDown':
          e.preventDefault()
          onArrowDown?.()
          break
        case 'Enter':
          e.preventDefault()
          onEnter?.()
          break
        case 'F5':
          if (onRefresh) {
            e.preventDefault()
            onRefresh()
          }
          break
      }

      // Ctrl+R / Cmd+R
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        if (onRefresh) {
          e.preventDefault()
          onRefresh()
        }
      }
    },
    [enabled, onEscape, onArrowLeft, onArrowRight, onArrowUp, onArrowDown, onEnter, onRefresh]
  )

  useEffect(() => {
    if (!enabled) return
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [enabled, handleKeyDown])
}

/**
 * 创建一个冷却刷新函数，FongMi 的 refresh cooldown 模式
 * CustomTitleView.java: App.post(() -> coolDown = false, 3000)
 */
export function useRefreshCooldown(onRefresh: () => void) {
  const refresh = useCallback(() => {
    const key = '__refresh_cooldown'
    const lastTime = Number(sessionStorage.getItem(key) || '0')
    const now = Date.now()
    if (now - lastTime < REFRESH_COOLDOWN_MS) return
    sessionStorage.setItem(key, String(now))
    onRefresh()
  }, [onRefresh])
  return refresh
}