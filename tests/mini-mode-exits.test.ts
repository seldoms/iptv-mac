import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(resolve(here, '..', relative), 'utf8')

describe('回到页面中播放：出口按钮与快捷键', () => {
  const player = read('src/renderer/src/components/VideoPlayer/VideoPlayer.tsx')
  const chrome = read('src/renderer/src/components/MiniChrome/MiniChrome.tsx')

  it('小窗有明确的「返回」按钮与 ESC', () => {
    expect(chrome).toContain('返回界面')
    expect(chrome).toContain("event.key !== 'Escape'")
    expect(chrome).toContain('leaveMiniMode')
  })

  it('播放器控制栏的精简模式按钮在小窗状态下变成「退出」', () => {
    expect(player).toContain('miniPlayerMode ? void leaveMiniMode() : void handleEnterMiniMode()')
    expect(player).toContain('退出精简模式（回到页面里播放）')
  })

  it('全屏可以按 ESC 退出，并且状态会与系统同步', () => {
    expect(player).toContain("if (event.key !== 'Escape') return")
    expect(player).toContain('exitFullscreenIfNeeded()')
    expect(player).toContain("document.addEventListener('fullscreenchange'")
    expect(player).toContain('windowApi')
    expect(player).toContain('.isFullscreen()')
  })

  it('退出小窗的逻辑只有一份实现（三处共用）', () => {
    const helper = read('src/renderer/src/utils/miniMode.ts')
    expect(helper).toContain('export async function leaveMiniMode')
    expect(chrome).toContain("from '@/utils/miniMode'")
    expect(player).toContain("from '@/utils/miniMode'")
  })
})
