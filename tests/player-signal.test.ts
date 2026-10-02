import { beforeEach, describe, expect, it } from 'vitest'
import { usePlayerStore } from '../src/renderer/src/stores/usePlayerStore'

/** 只测新增的信号/推送 action —— 它们替代了原先的 window 自定义事件 */
describe('player store 信号通道', () => {
  beforeEach(() => {
    usePlayerStore.setState({ playerSignal: null, danmakuRequest: null, subtitleRequest: null })
  })

  it('sendPlayerSignal 自增 token 并携带作用域与类型', () => {
    const { sendPlayerSignal } = usePlayerStore.getState()
    sendPlayerSignal({ type: 'playFailed', scope: 'vod', siteKey: 's1', vodId: 'v1', autoSwitch: true })
    const first = usePlayerStore.getState().playerSignal
    expect(first?.type).toBe('playFailed')
    expect(first?.scope).toBe('vod')
    expect(first?.token).toBe(1)
    expect(first?.siteKey).toBe('s1')

    sendPlayerSignal({ type: 'nextSource', scope: 'live' })
    const second = usePlayerStore.getState().playerSignal
    expect(second?.token).toBe(2)
    expect(second?.scope).toBe('live')
  })

  it('clearPlayerSignal 清空信号', () => {
    const { sendPlayerSignal, clearPlayerSignal } = usePlayerStore.getState()
    sendPlayerSignal({ type: 'retry', scope: 'vod' })
    clearPlayerSignal()
    expect(usePlayerStore.getState().playerSignal).toBeNull()
  })

  it('弹幕与字幕推送各自自增 token 并保留负载', () => {
    const { sendDanmaku, loadSubtitle } = usePlayerStore.getState()
    sendDanmaku('第一条')
    sendDanmaku('第二条', '#ff0000')
    const danmaku = usePlayerStore.getState().danmakuRequest
    expect(danmaku?.token).toBe(2)
    expect(danmaku?.text).toBe('第二条')
    expect(danmaku?.color).toBe('#ff0000')

    loadSubtitle('https://x/sub.srt', '中文')
    const subtitle = usePlayerStore.getState().subtitleRequest
    expect(subtitle?.token).toBe(1)
    expect(subtitle?.language).toBe('zh')
    expect(subtitle?.url).toBe('https://x/sub.srt')
  })
})
