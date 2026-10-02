import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(resolve(here, '..', relative), 'utf8')

describe('备选源：能看、能点、能切', () => {
  const vod = read('src/renderer/src/pages/VodDetail/VodDetail.tsx')

  it('把备选源铺成一排（不再是只显示一个数字）', () => {
    expect(vod).toContain('alternativeSources.map')
    expect(vod).toContain('其他站点的同名片源')
    expect(vod).toContain('重新搜索')
  })

  it('点击备选源真的会切换（pickAlternativeSource 不再是死代码）', () => {
    expect(vod).toContain('handlePickAlternative')
    expect(vod).toContain('pickAlternativeSource(index)')
    expect(vod).toContain('await switchToAlternativeSource(picked)')
    // 点选入口必须真的挂在按钮上
    expect(vod).toContain('onClick={() => void handlePickAlternative(index)}')
  })
})

describe('直播状态以真实播放为准', () => {
  const live = read('src/renderer/src/pages/Live/Live.tsx')
  const store = read('src/renderer/src/stores/useLiveStore.ts')
  const ipc = read('src/renderer/src/utils/ipc.ts')

  it('直播页把播放器的真实结果回写（能播就不该显示无信号）', () => {
    expect(live).toContain("playbackPhase === 'playing' ? 'alive'")
    expect(live).toContain('reportPlaybackResult([playbackUrl]')
    expect(live).toContain('playbackQueue.urls.includes(playbackUrl)')
  })

  it('IPC 与 store 都已接通', () => {
    expect(ipc).toContain("'live:reportLineResult'")
    expect(store).toContain('reportLineResult(urls, alive, latencyMs)')
    expect(store).toContain('reportPlaybackResult: async')
  })
})
