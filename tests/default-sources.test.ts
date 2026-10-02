import { describe, expect, it } from 'vitest'
import { DEFAULT_SOURCES } from '../src/renderer/src/defaultSources'

describe('DEFAULT_SOURCES', () => {
  it('exposes usable recommended config URLs for home entry points', () => {
    // 2026-10-01 全量审计后由 40 条精简为实测可用的 9 条；这里只断言下限与不变量，
    // 避免每次增删内置源都要改测试。
    expect(DEFAULT_SOURCES.length).toBeGreaterThanOrEqual(8)
    for (const source of DEFAULT_SOURCES) {
      expect(source.name.trim()).not.toBe('')
      expect(source.desc.trim()).not.toBe('')
      expect(source.url).toMatch(/^https?:\/\//)
    }
  })
})
