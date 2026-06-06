/**
 * VOD 配置解析器
 * 解析 VodConfig JSON，兼容各种非标准格式
 * 处理：注释、trailing comma、控制字符、spider;md5;hash、相对路径等
 */
import type { VodConfig, Site, LiveSource, Parse, Doh, Rule, Header } from '../../shared/types'
import { request } from '../network/NetworkStack'

/**
 * 解析相对路径
 * 将 ./xxx 或 ../xxx 形式的路径基于 baseUrl 解析为绝对路径
 */
export function resolveRelativePath(path: string, baseUrl: string): string {
  if (!path) return path
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('file://')) {
    return path
  }
  try {
    const base = new URL(baseUrl)
    return new URL(path, base.href).href
  } catch {
    return path
  }
}

/**
 * 从 spider 字段提取实际 URL
 * spider 格式变体：
 *   - "url;md5;hash" → 取 url
 *   - "url;md5" → 取 url
 *   - "url" → 直接用
 */
function extractSpiderUrl(spider: string): string {
  if (!spider) return spider
  // 如果包含分号，取第一段
  if (spider.includes(';')) {
    return spider.split(';')[0]
  }
  return spider
}

/**
 * 清理非标准 JSON 文本
 * 处理：BOM、注释行、trailing comma、字符串内控制字符
 */
function cleanJsonText(text: string): string {
  let cleaned = text
    // 去除 BOM
    .replace(/^\uFEFF/, '')

  // 去除 // 注释行（只处理行首的注释，不处理字符串内的 //）
  const lines = cleaned.split('\n')
  const filteredLines: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    // 跳过空行和注释行
    if (!trimmed || trimmed.startsWith('//')) continue
    filteredLines.push(line)
  }
  cleaned = filteredLines.join('\n')

  // 去除 trailing comma（}, ] 前的逗号）
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1')

  // 清理 JSON 字符串值内的控制字符（换行、回车、制表符等）
  // 逐字符扫描，只在字符串值内部转义控制字符
  cleaned = cleanStringControlChars(cleaned)

  return cleaned
}

/**
 * 清理 JSON 字符串值内的控制字符
 * 逐字符扫描，在引号内遇到控制字符时转义
 */
function cleanStringControlChars(text: string): string {
  const result: string[] = []
  let inString = false
  let escape = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (escape) {
      result.push(ch)
      escape = false
      continue
    }

    if (ch === '\\' && inString) {
      result.push(ch)
      escape = true
      continue
    }

    if (ch === '"') {
      inString = !inString
      result.push(ch)
      continue
    }

    if (inString) {
      // 字符串内部：转义控制字符
      const code = ch.charCodeAt(0)
      if (code < 0x20) {
        if (ch === '\n') result.push('\\n')
        else if (ch === '\r') result.push('\\r')
        else if (ch === '\t') result.push('\\t')
        else result.push('') // 去掉其他控制字符
      } else {
        result.push(ch)
      }
    } else {
      // 字符串外部：直接去掉控制字符
      const code = ch.charCodeAt(0)
      if (code < 0x20 && ch !== '\n' && ch !== '\r' && ch !== '\t') {
        // 跳过
      } else {
        result.push(ch)
      }
    }
  }

  return result.join('')
}

/**
 * 安全解析 JSON，自动清理非标准格式
 */
function safeJsonParse(text: string): Record<string, unknown> {
  const cleaned = cleanJsonText(text)
  try {
    return JSON.parse(cleaned)
  } catch (firstError) {
    // 二次尝试：更激进的清理
    try {
      let aggressive = cleaned
      // 修复未转义的换行（兜底）
      aggressive = aggressive.replace(
        /"([^"]*)\r?\n([^"]*)"/g,
        (_, before, after) => `"${before}\\n${after}"`
      )
      return JSON.parse(aggressive)
    } catch {
      throw firstError
    }
  }
}

/**
 * 解析 VodConfig JSON
 */
export function parseVodConfig(json: string, baseUrl?: string): VodConfig {
  const raw = safeJsonParse(json)
  const config = transformVodConfig(raw)

  // 解析相对路径
  if (baseUrl) {
    if (config.spider) {
      config.spider = resolveRelativePath(extractSpiderUrl(config.spider), baseUrl)
    }

    if (config.sites) {
      for (const site of config.sites) {
        if (site.jar) {
          site.jar = resolveRelativePath(extractSpiderUrl(site.jar), baseUrl)
        }
        if (site.api) {
          site.api = resolveRelativePath(site.api, baseUrl)
        }
        // ext 如果是字符串 URL 形式则解析
        if (site.ext && typeof site.ext === 'string') {
          if (
            site.ext.startsWith('./') ||
            site.ext.startsWith('../') ||
            site.ext.startsWith('/')
          ) {
            site.ext = resolveRelativePath(site.ext, baseUrl)
          }
        }
      }
    }

    if (config.lives) {
      for (const live of config.lives) {
        if (live.url) {
          live.url = resolveRelativePath(live.url, baseUrl)
        }
        if (live.jar) {
          live.jar = resolveRelativePath(live.jar, baseUrl)
        }
        if (live.api) {
          live.api = resolveRelativePath(live.api, baseUrl)
        }
      }
    }
  }

  return config
}

/**
 * 从 URL 加载 VodConfig
 */
export async function loadVodConfig(url: string): Promise<VodConfig> {
  const response = await request({ url, method: 'GET' })
  const json = response.data
  return parseVodConfig(json, url)
}

/**
 * 转换原始配置对象
 * 处理各种字段格式变体
 */
function transformVodConfig(raw: Record<string, unknown>): VodConfig {
  const sites: Site[] = []

  if (Array.isArray(raw.sites)) {
    for (const s of raw.sites as Record<string, unknown>[]) {
      // 跳过非对象项（如注释字符串）
      if (!s || typeof s !== 'object' || Array.isArray(s)) continue
      // 跳过没有 key 的项
      if (!s.key) continue

      sites.push({
        key: String(s.key ?? ''),
        name: String(s.name ?? ''),
        type: Number(s.type ?? 0),
        api: String(s.api ?? ''),
        ext: s.ext, // 可能是字符串或对象
        jar: s.jar ? String(s.jar) : undefined,
        click: s.click ? String(s.click) : undefined,
        playUrl: s.playUrl ? String(s.playUrl) : s.play_url ? String(s.play_url) : undefined,
        hide: s.hide != null ? Number(s.hide) : undefined,
        timeout: s.timeout != null ? Number(s.timeout) : undefined,
        searchable: s.searchable != null ? Number(s.searchable) : undefined,
        changeable: s.changeable != null ? Number(s.changeable) : undefined,
        quickSearch: s.quickSearch != null ? Boolean(s.quickSearch) : s.quick_search != null ? Boolean(s.quick_search) : undefined,
        indexs: s.indexs as number[] | undefined,
        categories: s.categories as string[] | undefined,
        header: s.header ? String(s.header) : undefined,
        style: s.style as Site['style']
      })
    }
  }

  return {
    spider: raw.spider ? extractSpiderUrl(String(raw.spider)) : undefined,
    wallpaper: raw.wallpaper ? String(raw.wallpaper) : undefined,
    logo: raw.logo ? String(raw.logo) : undefined,
    notice: raw.notice ? String(raw.notice) : raw.warningText ? String(raw.warningText) : undefined,
    sites,
    parses: transformParses(raw.parses),
    lives: transformLives(raw.lives),
    doh: transformDoh(raw.doh),
    proxy: raw.proxy as VodConfig['proxy'],
    rules: transformRules(raw.rules),
    headers: transformHeaders(raw.headers),
    hosts: transformHosts(raw.hosts),
    flags: raw.flags as string[] | undefined,
    ads: raw.ads as string[] | undefined
  }
}

/**
 * 转换解析器列表
 */
function transformParses(parses: unknown): Parse[] | undefined {
  if (!Array.isArray(parses)) return undefined
  return parses
    .filter((p): p is Record<string, unknown> => p && typeof p === 'object')
    .map((p) => ({
      name: String(p.name ?? ''),
      type: p.type != null ? Number(p.type) : 0,
      url: String(p.url ?? ''),
      ext: p.ext as Parse['ext']
    }))
}

/**
 * 转换直播源列表
 * 支持多种 lives 格式变体
 */
function transformLives(lives: unknown): LiveSource[] | undefined {
  if (!Array.isArray(lives)) return undefined
  return lives
    .filter((l): l is Record<string, unknown> => l && typeof l === 'object')
    .map((l) => ({
      name: String(l.name ?? ''),
      url: l.url ? String(l.url) : undefined,
      api: l.api ? String(l.api) : undefined,
      ext: l.ext,
      jar: l.jar ? String(l.jar) : undefined,
      click: l.click ? String(l.click) : undefined,
      logo: l.logo ? String(l.logo) : undefined,
      epg: l.epg ? String(l.epg) : undefined,
      ua: l.ua ? String(l.ua) : undefined,
      origin: l.origin ? String(l.origin) : undefined,
      referer: l.referer ? String(l.referer) : undefined,
      timeZone: l.timeZone ? String(l.timeZone) : undefined,
      timeout: l.timeout != null ? Number(l.timeout) : undefined,
      header: l.header ? String(l.header) : undefined,
      type: l.type != null ? Number(l.type) : 0,
      playerType: l.playerType != null ? Number(l.playerType) : undefined,
      catchup: l.catchup as LiveSource['catchup'],
      groups: l.groups as LiveSource['groups'],
      boot: l.boot != null ? Boolean(l.boot) : undefined,
      pass: l.pass != null ? Number(l.pass) : undefined
    }))
}

/**
 * 转换 DoH 配置
 */
function transformDoh(doh: unknown): Doh[] | undefined {
  if (!Array.isArray(doh)) return undefined
  return doh
    .filter((d): d is Record<string, unknown> => d && typeof d === 'object')
    .map((d) => ({
      name: String(d.name ?? ''),
      url: String(d.url ?? ''),
      ips: d.ips as string[] | undefined
    }))
}

/**
 * 转换规则列表
 * 兼容新旧两种格式：
 *   新版：{name, hosts, regex, script, exclude}
 *   旧版：{host, rule: [regex1, regex2]}
 */
function transformRules(rules: unknown): Rule[] | undefined {
  if (!Array.isArray(rules)) return undefined
  return rules
    .filter((r): r is Record<string, unknown> => r && typeof r === 'object')
    .map((r) => {
      // 新版格式
      if (r.hosts && Array.isArray(r.hosts)) {
        return {
          name: String(r.name ?? ''),
          hosts: r.hosts as string[],
          regex: r.regex as string[] | undefined,
          script: r.script ? String(r.script) : undefined,
          exclude: r.exclude as string[] | undefined
        }
      }
      // 旧版格式 {host, rule}
      if (r.host) {
        const host = String(r.host)
        const ruleArray = Array.isArray(r.rule) ? r.rule : r.rule ? [String(r.rule)] : []
        return {
          name: host,
          hosts: [host],
          regex: ruleArray.map(String),
          script: undefined,
          exclude: undefined
        }
      }
      return {
        name: String(r.name ?? ''),
        hosts: r.hosts as string[] ?? [],
        regex: r.regex as string[] | undefined,
        script: r.script ? String(r.script) : undefined,
        exclude: r.exclude as string[] | undefined
      }
    })
}

/**
 * 转换 Header 注入列表
 */
function transformHeaders(headers: unknown): Header[] | undefined {
  if (!Array.isArray(headers)) return undefined
  return headers
    .filter((h): h is Record<string, unknown> => h && typeof h === 'object')
    .map((h) => ({
      host: String(h.host ?? ''),
      header: String(h.header ?? '')
    }))
}

/**
 * 转换 Hosts 覆盖
 * 支持两种格式：
 *   - 字符串数组：["old=new", ...]
 *   - 对象数组：[{host, ip}, ...]
 */
function transformHosts(hosts: unknown): string[] | undefined {
  if (!Array.isArray(hosts)) return undefined
  return hosts
    .filter((h) => h != null)
    .map((h) => {
      if (typeof h === 'string') return h
      if (typeof h === 'object') {
        const obj = h as Record<string, unknown>
        // 对象格式 {host, ip} → "host=ip"
        if (obj.host && obj.ip) {
          return `${obj.host}=${obj.ip}`
        }
      }
      return String(h)
    })
}
