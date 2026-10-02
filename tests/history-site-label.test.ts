import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(resolve(here, '..', relative), 'utf8')

describe('历史记录与精简模式契约', () => {
  it('历史行显示站点名，且不在当前订阅时明确标注', () => {
    const history = read('src/renderer/src/pages/History/History.tsx')
    expect(history).toContain('siteLabel')
    expect(history).toContain('不在当前订阅')
    expect(history).toContain("useConfigStore((state) => state.sites)")
  })

  it('进入精简模式前必须确认播放状态已保存，避免黑屏小窗', () => {
    const player = read('src/renderer/src/components/VideoPlayer/VideoPlayer.tsx')
    const guard = player.indexOf('播放状态未保存成功，放弃进入精简模式')
    const enter = player.indexOf('await windowApi.enterMiniMode()')
    expect(guard).toBeGreaterThan(-1)
    expect(enter).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(enter)
  })

  it('小窗拿不到播放状态时给出出路，而不是纯黑', () => {
    const mini = read('src/renderer/src/components/MiniPlayer/MiniPlayer.tsx')
    expect(mini).toContain('未取到播放状态')
    expect(mini).toContain('未能恢复播放（播放状态为空）')
  })
})
