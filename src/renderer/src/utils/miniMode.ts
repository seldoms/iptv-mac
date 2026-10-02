import { windowApi } from './ipc'
import { useUiStore } from '@/stores/useUiStore'

/**
 * 退出精简模式（小窗）：窗口装饰/尺寸还原 + 清掉 `?mode=mini` + store 状态归位。
 *
 * 三处都要用（小窗顶部「返回」、播放器控制栏的同一个按钮、MiniPlayer 兜底），
 * 抽出来避免各写一份、行为不一致。
 */
export async function leaveMiniMode(): Promise<void> {
  await windowApi.exitMiniMode().catch(() => {})
  const url = new URL(window.location.href)
  url.searchParams.delete('mode')
  window.history.replaceState(null, '', url.toString())
  useUiStore.getState().setMiniMode(false)
}
