import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(resolve(here, '..', relative), 'utf8')

describe('小窗：整个播放器都能拖动 + 面板可开关', () => {
  const player = read('src/renderer/src/components/VideoPlayer/VideoPlayer.tsx')
  const ipc = read('src/renderer/src/utils/ipc.ts')

  it('小窗模式下按画面任意位置即可拖窗口', () => {
    expect(ipc).toContain("tauriInvoke('plugin:window|start_dragging')")
    expect(player).toContain('handlePlayerPointerDown')
    expect(player).toContain('startDragging()')
    expect(player).toContain('onPointerDown={handlePlayerPointerDown}')
  })

  it('可交互元素与进度条不会被当作拖窗口', () => {
    expect(player).toContain("'button, input, select, textarea, a, label, [role=\"button\"], [data-no-window-drag]'")
    expect(player).toContain('data-no-window-drag')
  })

  it('码率/速度面板是开关控制（不是拖动）', () => {
    expect(player).toContain('showStreamStats && currentUrl')
    expect(player).toContain('setShowStreamStats')
    // 上轮误做的面板拖动必须已经撤干净
    expect(player).not.toContain('statsPanelPos')
    expect(player).not.toContain('handleStatsPointerDown')
  })
})
