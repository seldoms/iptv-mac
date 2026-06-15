import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'

const fixturesDir = join(__dirname, 'fixtures')

function readFixture(subdir: string, name: string): string {
  return readFileSync(join(fixturesDir, subdir, name), 'utf-8')
}

// ==================== 配置 fixture ====================

describe('config fixtures', () => {
  it('valid.json is parseable', () => {
    const text = readFixture('config', 'valid.json')
    const config = JSON.parse(text)
    expect(config.sites).toHaveLength(3)
    expect(config.lives).toHaveLength(1)
    expect(config.parses).toHaveLength(1)
    expect(config.doh).toHaveLength(1)
    expect(config.proxy).toHaveLength(1)
    expect(config.rules).toHaveLength(1)
    expect(config.headers['User-Agent']).toBe('Mozilla/5.0 Test')
    expect(config.hosts).toHaveLength(2)
    expect(config.ads).toHaveLength(2)
  })

  it('empty.json is parseable', () => {
    const text = readFixture('config', 'empty.json')
    const config = JSON.parse(text)
    expect(Object.keys(config)).toHaveLength(0)
  })

  it('malformed.json throws on parse', () => {
    const text = readFixture('config', 'malformed.json')
    expect(() => JSON.parse(text)).toThrow()
  })

  it('relative-paths.json has expected structure', () => {
    const text = readFixture('config', 'relative-paths.json')
    const config = JSON.parse(text)
    expect(config.sites[0].api).toBe('./api.php')
    expect(config.sites[0].ext).toBe('../ext/data.json')
    expect(config.lives[0].url).toBe('./local/live.m3u8')
  })

  it('comment-stripping.json is not valid JSON (needs cleanJsonText)', () => {
    const text = readFixture('config', 'comment-stripping.json')
    expect(() => JSON.parse(text)).toThrow()
    const cleaned = text
      .replace(/\/\/.*/g, '')
      .replace(/,\s*([}\]])/g, '$1')
    const config = JSON.parse(cleaned)
    expect(config.sites[0].name).toBe('注释站点')
  })
})

// ==================== 直播 fixture ====================

describe('live fixtures', () => {
  it('txt-format.txt contains groups and channels', () => {
    const text = readFixture('live', 'txt-format.txt')
    expect(text).toContain('#genre#')
    expect(text).toContain('CCTV-1')
    expect(text).toContain('http://')
    expect(text).toContain('password123')
  })

  it('m3u-format.m3u has EXTINF entries', () => {
    const text = readFixture('live', 'm3u-format.m3u')
    expect(text).toContain('#EXTM3U')
    expect(text).toContain('#EXTINF:')
    expect(text).toContain('#KODIPROP:')
    expect(text).toContain('#EXTVLCOPT:')
    expect(text).toContain('inputstream.adaptive.license_key')
  })

  it('json-format.json is valid JSON array', () => {
    const text = readFixture('live', 'json-format.json')
    const groups = JSON.parse(text)
    expect(groups).toHaveLength(2)
    expect(groups[0].name).toBe('央视')
    expect(groups[1].channel).toHaveLength(2)
  })

  it('txt-directives.txt has ua/referer directives', () => {
    const text = readFixture('live', 'txt-directives.txt')
    expect(text).toContain('ua=Mozilla/5.0')
    expect(text).toContain('referer=http://example.com')
    expect(text).toContain('注释行')
  })
})

// ==================== EPG fixture ====================

describe('epg fixtures', () => {
  it('sample.xml has channels and programmes', () => {
    const text = readFixture('epg', 'sample.xml')
    expect(text).toContain('<channel id="cctv1.example.com">')
    expect(text).toContain('<programme channel="cctv1.example.com"')
    expect(text).toContain('新闻联播')
    expect(text).toContain('焦点访谈')
    expect(text).toContain('湖南新闻')
  })

  it('empty.xml is minimal valid XMLTV', () => {
    const text = readFixture('epg', 'empty.xml')
    expect(text).toContain('<tv>')
    expect(text).toContain('</tv>')
  })
})

// ==================== HLS fixture ====================

describe('hls fixtures', () => {
  it('simple.m3u8 has variant streams', () => {
    const text = readFixture('hls', 'simple.m3u8')
    expect(text).toContain('#EXTM3U')
    expect(text).toContain('#EXT-X-STREAM-INF:')
    expect(text).toContain('low.m3u8')
    expect(text).toContain('/medium/medium.m3u8')
    expect(text).toContain('https://cdn.example.com/high/high.m3u8')
  })

  it('master.m3u8 has encryption key and segments', () => {
    const text = readFixture('hls', 'master.m3u8')
    expect(text).toContain('#EXT-X-KEY:')
    expect(text).toContain('URI="https://keys.example.com/key.bin"')
    expect(text).toContain('segment1.ts')
    expect(text).toContain('/segments/segment2.ts')
    expect(text).toContain('https://cdn.example.com/segments/segment3.ts')
  })

  it('nested.m3u8 has variant references', () => {
    const text = readFixture('hls', 'nested.m3u8')
    expect(text).toContain('variant_1280.m3u8')
    expect(text).toContain('variant_2560.m3u8')
  })
})
