import { describe, expect, it } from 'vitest'
import { DEFAULT_BOOTSTRAP_SOURCE, resolveStartupConfigUrl } from '../src/renderer/src/startupConfig'
import { DEFAULT_SOURCES } from '../src/renderer/src/defaultSources'

describe('resolveStartupConfigUrl', () => {
  it('keeps the saved config url when one exists', () => {
    expect(resolveStartupConfigUrl(' https://example.com/current.json ')).toBe('https://example.com/current.json')
  })

  it('falls back to the first bundled source on first launch', () => {
    expect(DEFAULT_SOURCES[0]).toBe(DEFAULT_BOOTSTRAP_SOURCE)
    expect(DEFAULT_BOOTSTRAP_SOURCE.name).toBe('心魔在线')
    expect(DEFAULT_BOOTSTRAP_SOURCE.url).toMatch(/^https?:\/\//)
    expect(resolveStartupConfigUrl('')).toBe(DEFAULT_BOOTSTRAP_SOURCE.url)
  })
})
