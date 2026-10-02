import { describe, expect, it } from 'vitest'
import { latencyIndicator } from '../src/renderer/src/components/ChannelItem/ChannelItem'

describe('直播延时/可用性判定', () => {
  it('-2 是「还没探测」——显示为「未验证」，绝不能显示成不可用', () => {
    expect(latencyIndicator(-2).label).toBe('未验证')
    expect(latencyIndicator(-2).className).not.toContain('red')
  })

  it('-1 才是探测不通', () => {
    expect(latencyIndicator(-1).label).toBe('不可用')
  })

  it('0ms 是可达（极快的本地探测），不能当成不可用', () => {
    expect(latencyIndicator(0).label).toBe('0ms')
  })

  it('正常延时按区间着色', () => {
    expect(latencyIndicator(50).className).toContain('green')
    expect(latencyIndicator(120).className).toContain('yellow')
    expect(latencyIndicator(500).className).toContain('red')
  })
})
