import { create } from 'zustand'

/**
 * 应用级 UI 状态。
 *
 * 原先「精简模式」是在 VideoPlayer / MiniPlayer 之间用 `window` 自定义事件
 * （`app:miniModeChanged`）同步的；这类隐式事件胶水已经在下载入口、MiniPlayer
 * 渲染等问题上连续踩坑，改成显式 store 状态（见 docs/CODE_AUDIT.md P0）。
 */
interface UiState {
  miniMode: boolean
  setMiniMode: (miniMode: boolean) => void
}

/** 检测 URL 是否为精简模式（窗口以 `?mode=mini` 启动） */
function initialMiniMode(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('mode') === 'mini'
}

export const useUiStore = create<UiState>((set) => ({
  miniMode: initialMiniMode(),
  setMiniMode: (miniMode) => set({ miniMode })
}))
