import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(resolve(here, '..', relative), 'utf8')

describe('小窗播放不中断（同一播放器实例）', () => {
  const player = read('src/renderer/src/components/VideoPlayer/VideoPlayer.tsx')
  const app = read('src/renderer/src/App.tsx')

  it('HLS 初始化不依赖小窗状态，切小窗不会重建播放器', () => {
    const initDeps = player.match(/\}, \[currentUrl, playHeader, playKey\]\)/)
    expect(initDeps).toBeTruthy()
    // 依赖里出现小窗状态就意味着切换时会把流推翻重来
    const miniOnlyEffect = player.match(/\}, \[miniPlayerMode\]\)/g) ?? []
    expect(miniOnlyEffect.length).toBe(1) // 只允许"清过渡样式 + 打证据日志"这一个
    expect(player).toContain('if (!miniPlayerMode) return')
  })

  it('小窗模式下播放器铺满小窗且层级高于遮罩', () => {
    expect(player).toContain("'fixed inset-0 z-[9001] h-screen w-screen'")
    expect(app).toContain('z-[9000] bg-black')
  })

  it('有活着的播放器时不走「卸载整页 + 新建 MiniPlayer」的旧路径', () => {
    expect(app).toContain('if (miniMode && !hasLivePlayer)')
    expect(app).toContain('const hasLivePlayer = usePlayerStore')
  })

  it('小窗控件层自己不放 video（画面只能来自挂载中的播放器）', () => {
    const chrome = read('src/renderer/src/components/MiniChrome/MiniChrome.tsx')
    expect(chrome).not.toContain('<video')
    expect(chrome).toContain('data-tauri-drag-region="deep"')
    expect(chrome).toContain('exitMiniMode')
  })
})
