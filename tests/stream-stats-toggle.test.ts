import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(resolve(here, '..', relative), 'utf8')

describe('码率/速度面板：能显示（含原生播放路径）+ 有开关按钮', () => {
  const player = read('src/renderer/src/components/VideoPlayer/VideoPlayer.tsx')

  it('macOS 原生 HLS 路径也能拿到数字（不能只依赖 HLS.js 分片事件）', () => {
    expect(player).toContain("invoke('proxy:throughput')")
    expect(player).toContain('webkitVideoDecodedByteCount')
    expect(player).toContain('nativeStats')
  })

  it('显示时优先声明码率、优先代理实测速度', () => {
    expect(player).toContain('formatThroughput(streamStats.bitrateKbps ?? nativeStats.bitrateKbps)')
    expect(player).toContain('formatThroughput(nativeStats.linkSpeedKbps ?? streamStats.linkSpeedKbps)')
  })

  it('底部控制栏有显隐开关，且状态持久化', () => {
    expect(player).toContain('setShowStreamStats')
    expect(player).toContain("localStorage.getItem('iptv.showStreamStats')")
    expect(player).toContain("localStorage.setItem('iptv.showStreamStats'")
    expect(player).toContain("'隐藏码率/速度'")
    expect(player).toContain('aria-pressed={showStreamStats}')
  })

  it('面板渲染受开关控制', () => {
    expect(player).toContain('{showStreamStats && currentUrl && (')
  })
})
