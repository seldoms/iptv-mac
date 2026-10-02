import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(resolve(here, '..', relative), 'utf8')

describe('回到界面：出口足够显眼', () => {
  const chrome = read('src/renderer/src/components/MiniChrome/MiniChrome.tsx')
  const player = read('src/renderer/src/components/VideoPlayer/VideoPlayer.tsx')

  it('小窗顶部有一个显眼的「返回界面」按钮（不是只有一个小图标）', () => {
    expect(chrome).toContain('返回界面')
    expect(chrome).toContain('border-accent/70')
    expect(chrome).toContain('h-9') // 顶部条加高
  })

  it('进入小窗/全屏后会弹出操作提示并自动消失', () => {
    expect(player).toContain('已进入小窗：拖动画面可移动')
    expect(player).toContain('已进入全屏：按 ESC 或双击画面退出')
    expect(player).toContain('modeHint')
    expect(player).toContain('setTimeout(() => setModeHint')
  })

  it('三个出口都在：按钮 / ESC / 播放器控制栏切换', () => {
    expect(chrome).toContain("event.key !== 'Escape'")
    expect(player).toContain('leaveMiniMode')
    expect(player).toContain('exitFullscreenIfNeeded')
  })
})
