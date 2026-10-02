import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatClock,
  formatDuration,
  formatRelativeTime,
  formatThroughput,
  smoothThroughput
} from '../src/renderer/src/utils/format'

describe('formatClock（播放进度：分钟可超过 60）', () => {
  it('空值与非法值显示 00:00', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(Number.NaN)).toBe('00:00')
  })

  it('补零到 mm:ss', () => {
    expect(formatClock(5)).toBe('00:05')
    expect(formatClock(65)).toBe('01:05')
  })

  it('超过一小时仍按分钟累计（保持播放器原有语义）', () => {
    expect(formatClock(5400)).toBe('90:00')
  })
})

describe('formatDuration（时长：h:mm:ss）', () => {
  it('不足一小时为 m:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65)).toBe('1:05')
  })

  it('超过一小时带小时位', () => {
    expect(formatDuration(3661)).toBe('1:01:01')
  })

  it('负数按 0 处理', () => {
    expect(formatDuration(-5)).toBe('0:00')
  })
})

describe('formatBytes', () => {
  it('0 或缺失显示 -', () => {
    expect(formatBytes(0)).toBe('-')
  })

  it('按单位换算', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(1024 * 1024 * 3)).toBe('3.0 MB')
  })
})

describe('formatRelativeTime', () => {
  it('一分钟内为「刚刚」', () => {
    expect(formatRelativeTime(Date.now() - 5_000)).toBe('刚刚')
  })

  it('一小时内为 N分钟前', () => {
    expect(formatRelativeTime(Date.now() - 5 * 60_000)).toBe('5分钟前')
  })

  it('一天内为 N小时前', () => {
    expect(formatRelativeTime(Date.now() - 3 * 3_600_000)).toBe('3小时前')
  })

  it('超过一天回落到日期', () => {
    const old = Date.now() - 3 * 86_400_000
    expect(formatRelativeTime(old)).toBe(new Date(old).toLocaleDateString('zh-CN'))
  })
})

describe('formatThroughput（码率/速度显示）', () => {
  it('未知值显示 --，不显示 0/NaN', () => {
    expect(formatThroughput(null)).toBe('--')
    expect(formatThroughput(0)).toBe('--')
    expect(formatThroughput(Number.NaN)).toBe('--')
    expect(formatThroughput(-5)).toBe('--')
  })

  it('按量级切换 Kbps / Mbps', () => {
    expect(formatThroughput(999)).toBe('999 Kbps')
    expect(formatThroughput(1500)).toBe('1.5 Mbps')
    expect(formatThroughput(23400)).toBe('23 Mbps')
  })
})

describe('smoothThroughput（指数平滑）', () => {
  it('首个有效值直接采用', () => {
    expect(smoothThroughput(null, 1200)).toBe(1200)
  })

  it('后续值按 0.6/0.4 平滑', () => {
    expect(smoothThroughput(1000, 2000)).toBeCloseTo(1400, 5)
  })

  it('丢弃非有限、非正与不合理尖峰，保留上一次有效值', () => {
    expect(smoothThroughput(1000, Number.NaN)).toBe(1000)
    expect(smoothThroughput(1000, 0)).toBe(1000)
    expect(smoothThroughput(1000, -3)).toBe(1000)
    expect(smoothThroughput(1000, 900_000)).toBe(1000)
  })
})
