import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(resolve(here, '..', relative), 'utf8')

describe('直播频道列表布局契约', () => {
  it('频道名独占第一行，状态文字另起一行，不会压住名字', () => {
    const item = read('src/renderer/src/components/ChannelItem/ChannelItem.tsx')
    // 名字所在容器必须能收缩 + 截断
    expect(item).toContain('flex-1 min-w-0')
    expect(item).toContain('truncate')
    // 「不可用」「N/M 线路」放在第二行（mt-0.5 的 meta 行），且不是 shrink-0 抢宽度的同级
    expect(item).toContain('mt-0.5 flex items-center gap-2')
    // 不再用首字方块占位
    expect(item).not.toContain('channel.name[0]')
  })

  it('播放按钮只用图标，避免文字挤占频道名', () => {
    const item = read('src/renderer/src/components/ChannelItem/ChannelItem.tsx')
    expect(item).toContain('aria-label={`播放 ${channel.name}`}')
    expect(item).not.toContain('>\n        播放\n      </button>')
  })

  it('频道列表宽度可拖动调整并记忆', () => {
    const live = read('src/renderer/src/pages/Live/Live.tsx')
    expect(live).toContain('cursor-col-resize')
    expect(live).toContain('iptv.liveListWidth')
    expect(live).toContain('role="separator"')
    // 宽度有夹取范围，避免拖没了
    expect(live).toContain('Math.max(200, Math.min(600')
  })
})
