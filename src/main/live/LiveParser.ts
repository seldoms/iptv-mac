/**
 * 直播源解析器
 * 支持 TXT、M3U、JSON 三种格式的直播源解析
 * 支持频道指令（ua, referer, header, format, parse, click）
 * 支持行内标头（|key=value）
 */
import type { Group, Channel, Catchup, Drm } from '../../shared/types'

/**
 * 解析直播源内容
 * 根据内容自动检测格式
 */
export function parseLiveContent(content: string): Group[] {
  const trimmed = content.trim()

  // JSON 格式：以 [ 开头
  if (trimmed.startsWith('[')) {
    return parseJsonFormat(trimmed)
  }

  // M3U 格式：包含 #EXTM3U 且不含 #genre#
  if (trimmed.includes('#EXTM3U') && !trimmed.includes('#genre#')) {
    return parseM3uFormat(trimmed)
  }

  // TXT 格式：其他
  return parseTxtFormat(trimmed)
}

// ==================== TXT 格式解析 ====================

/**
 * 解析 TXT 格式
 * 每行以逗号分隔，含 #genre# 的行声明分组
 * 支持频道指令和行内标头
 */
function parseTxtFormat(content: string): Group[] {
  const groups: Group[] = []
  let currentGroup: Group | null = null
  // 当前分组级别的指令
  let groupDirectives: Directives = {}

  const lines = content.split('\n')
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    // 分组声明行
    if (line.includes('#genre#')) {
      const commaIdx = line.indexOf(',')
      let groupName = commaIdx > 0 ? line.substring(0, commaIdx).trim() : line.replace('#genre#', '').trim()

      // 检查密码保护：名称_密码
      let password: string | undefined
      const underscoreIdx = groupName.lastIndexOf('_')
      if (underscoreIdx > 0) {
        password = groupName.substring(underscoreIdx + 1)
        groupName = groupName.substring(0, underscoreIdx)
      }

      currentGroup = { name: groupName, channel: [], pass: password }
      groups.push(currentGroup)
      groupDirectives = {}
      continue
    }

    // 频道指令行（不含 :// 的行）
    if (!line.includes('://') && !line.includes(',')) {
      const directive = parseDirective(line)
      if (directive) {
        groupDirectives = { ...groupDirectives, ...directive }
      }
      continue
    }

    // 频道行：名称,URL
    const commaIdx = line.indexOf(',')
    if (commaIdx <= 0) continue

    const channelName = line.substring(0, commaIdx).trim()
    const urlPart = line.substring(commaIdx + 1).trim()

    if (!urlPart.includes('://')) {
      // 可能是指令行
      const directive = parseDirective(line)
      if (directive) {
        groupDirectives = { ...groupDirectives, ...directive }
      }
      continue
    }

    // 如果还没有分组，创建默认分组
    if (!currentGroup) {
      currentGroup = { name: '', channel: [] }
      groups.push(currentGroup)
    }

    const channel = parseChannelUrls(channelName, urlPart, groupDirectives)
    currentGroup.channel.push(channel)
  }

  return groups
}

// ==================== M3U 格式解析 ====================

/**
 * 解析 M3U 格式
 * 支持 #EXTM3U 全局属性、#EXTINF 频道属性、指令行
 */
function parseM3uFormat(content: string): Group[] {
  const groups: Group[] = []
  const groupMap = new Map<string, Group>()

  // 全局追看设置
  let globalCatchup: Catchup | undefined
  let globalEpgUrl: string | undefined

  const lines = content.split('\n')
  let i = 0

  // 解析 #EXTM3U 行的全局属性
  if (lines.length > 0 && lines[0].includes('#EXTM3U')) {
    const extm3uLine = lines[0]
    globalEpgUrl = extractAttr(extm3uLine, 'tvg-url') || extractAttr(extm3uLine, 'url-tvg')
    globalCatchup = parseM3uCatchup(extm3uLine)
    i = 1
  }

  // 逐行解析频道
  let pendingChannel: Partial<Channel> | null = null
  let pendingGroupName: string = ''
  let pendingDirectives: Directives = {}

  for (; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    // #EXTINF 行
    if (line.startsWith('#EXTINF:')) {
      const parsed = parseExtinfLine(line)
      pendingChannel = parsed.channel
      pendingGroupName = parsed.groupName
      pendingDirectives = {}
      continue
    }

    // 指令行（#EXTHTTP、#EXTVLCOPT、#KODIPROP 等）
    if (line.startsWith('#')) {
      const directive = parseM3uDirective(line)
      if (directive) {
        if (directive.channel && pendingChannel) {
          pendingChannel = Object.assign({}, pendingChannel, directive.channel)
        }
        if (directive.directives) {
          pendingDirectives = Object.assign({}, pendingDirectives, directive.directives)
        }
      }
      continue
    }

    // URL 行
    if (line.includes('://') && pendingChannel) {
      const { url, headers } = parseInlineHeaders(line)
      const channelName = pendingChannel.name || ''
      const groupName = pendingGroupName

      // 获取或创建分组
      let group = groupMap.get(groupName)
      if (!group) {
        group = { name: groupName, channel: [] }
        groupMap.set(groupName, group)
        groups.push(group)
      }

      // 合并指令
      const mergedDirectives = { ...pendingDirectives, ...headers }
      const channel: Channel = {
        name: channelName,
        urls: [url],
        number: pendingChannel.number,
        logo: pendingChannel.logo,
        tvgId: pendingChannel.tvgId,
        tvgName: pendingChannel.tvgName,
        ...applyDirectives(mergedDirectives)
      }

      // 合并追看设置
      if (pendingChannel.catchup) {
        channel.catchup = pendingChannel.catchup
      } else if (globalCatchup) {
        channel.catchup = globalCatchup
      }

      // 合并 DRM
      if (pendingChannel.drm) {
        channel.drm = pendingChannel.drm
      }

      // 合并 header
      if (pendingChannel.header || Object.keys(headers).length > 0) {
        channel.header = { ...pendingChannel.header, ...headers }
      }

      group.channel.push(channel)
      pendingChannel = null
      pendingDirectives = {}
    }
  }

  return groups
}

// ==================== JSON 格式解析 ====================

/**
 * 解析 JSON 格式
 * 直接反序列化为 Group 数组
 */
function parseJsonFormat(content: string): Group[] {
  try {
    const raw = JSON.parse(content)
    if (!Array.isArray(raw)) return []

    return raw.map((g: Record<string, unknown>) => ({
      name: String(g.name ?? ''),
      pass: g.pass ? String(g.pass) : undefined,
      channel: Array.isArray(g.channel)
        ? g.channel.map((c: Record<string, unknown>) => ({
            name: String(c.name ?? ''),
            urls: Array.isArray(c.urls) ? c.urls.map(String) : [],
            number: c.number ? String(c.number) : undefined,
            logo: c.logo ? String(c.logo) : undefined,
            epg: c.epg ? String(c.epg) : undefined,
            ua: c.ua ? String(c.ua) : undefined,
            click: c.click ? String(c.click) : undefined,
            format: c.format ? String(c.format) : undefined,
            origin: c.origin ? String(c.origin) : undefined,
            referer: c.referer ? String(c.referer) : undefined,
            tvgId: c.tvgId ?? c.tvg_id ? String(c.tvgId ?? c.tvg_id) : undefined,
            tvgName: c.tvgName ?? c.tvg_name ? String(c.tvgName ?? c.tvg_name) : undefined,
            header: c.header as Record<string, string> | undefined,
            parse: c.parse as number | undefined,
            catchup: c.catchup as Catchup | undefined,
            drm: c.drm as Drm | undefined
          }))
        : []
    }))
  } catch (err) {
    console.error('JSON 格式直播源解析失败:', err)
    return []
  }
}

// ==================== 辅助函数 ====================

/** 指令集合 */
interface Directives {
  ua?: string
  origin?: string
  referer?: string
  header?: Record<string, string>
  format?: string
  parse?: number
  click?: string
  forceKey?: boolean
}

/** 解析指令行 */
function parseDirective(line: string): Directives | null {
  const result: Directives = {}

  if (line.startsWith('ua=')) {
    result.ua = line.substring(3).trim()
  } else if (line.startsWith('origin=')) {
    result.origin = line.substring(7).trim()
  } else if (line.startsWith('referer=') || line.startsWith('referrer=')) {
    result.referer = line.substring(line.indexOf('=') + 1).trim()
  } else if (line.startsWith('header=')) {
    try {
      result.header = JSON.parse(line.substring(7).trim())
    } catch {
      // JSON 解析失败则忽略
    }
  } else if (line.startsWith('format=')) {
    result.format = mapFormat(line.substring(7).trim())
  } else if (line.startsWith('parse=')) {
    result.parse = parseInt(line.substring(6).trim(), 10)
  } else if (line.startsWith('click=')) {
    result.click = line.substring(6).trim()
  } else if (line.startsWith('forceKey=')) {
    result.forceKey = line.substring(9).trim() === 'true'
  } else {
    return null
  }

  return result
}

/** 格式名映射 */
function mapFormat(format: string): string {
  switch (format.toLowerCase()) {
    case 'hls':
      return 'application/x-mpegURL'
    case 'dash':
    case 'mpd':
      return 'application/dash+xml'
    default:
      return format
  }
}

/** 解析频道 URL 列表（含行内标头） */
function parseChannelUrls(name: string, urlPart: string, directives: Directives): Channel {
  // 以 # 分隔多线路
  const urlSegments = urlPart.split('#')
  const urls: string[] = []
  const allHeaders: Record<string, string> = { ...directives.header }

  for (const segment of urlSegments) {
    const trimmed = segment.trim()
    if (!trimmed) continue

    const { url, headers } = parseInlineHeaders(trimmed)
    urls.push(url)
    Object.assign(allHeaders, headers)
  }

  const channel: Channel = {
    name,
    urls,
    ...applyDirectives(directives)
  }

  if (Object.keys(allHeaders).length > 0) {
    channel.header = allHeaders
  }

  return channel
}

/** 解析行内标头 |key=value&key2=value2 */
function parseInlineHeaders(url: string): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {}
  const pipeIdx = url.indexOf('|')
  if (pipeIdx < 0) return { url, headers }

  const actualUrl = url.substring(0, pipeIdx)
  const headerPart = url.substring(pipeIdx + 1)

  // 以 & 分隔多个标头
  const pairs = headerPart.split('&')
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=')
    if (eqIdx > 0) {
      headers[pair.substring(0, eqIdx).trim()] = pair.substring(eqIdx + 1).trim()
    }
  }

  return { url: actualUrl, headers }
}

/** 应用指令到频道属性 */
function applyDirectives(directives: Directives): Partial<Channel> {
  const result: Partial<Channel> = {}
  if (directives.ua) result.ua = directives.ua
  if (directives.origin) result.origin = directives.origin
  if (directives.referer) result.referer = directives.referer
  if (directives.format) result.format = directives.format
  if (directives.parse !== undefined) result.parse = directives.parse
  if (directives.click) result.click = directives.click
  if (directives.header) result.header = directives.header
  return result
}

/** 从 M3U 属性字符串中提取指定属性 */
function extractAttr(line: string, attr: string): string | undefined {
  const regex = new RegExp(`${attr}="([^"]*)"`, 'i')
  const match = line.match(regex)
  return match ? match[1] : undefined
}

/** 解析 #EXTINF 行 */
function parseExtinfLine(line: string): { channel: Partial<Channel>; groupName: string } {
  const channel: Partial<Channel> = {}
  let groupName = ''

  // 提取频道名称（逗号后）
  const commaIdx = line.lastIndexOf(',')
  if (commaIdx > 0) {
    channel.name = line.substring(commaIdx + 1).trim()
  }

  // 提取属性
  channel.tvgId = extractAttr(line, 'tvg-id')
  channel.tvgName = extractAttr(line, 'tvg-name')
  channel.number = extractAttr(line, 'tvg-chno')
  channel.logo = extractAttr(line, 'tvg-logo')
  groupName = extractAttr(line, 'group-title') || ''

  // 提取 UA
  const ua = extractAttr(line, 'http-user-agent')
  if (ua) channel.ua = ua

  // 提取追看设置
  const catchupType = extractAttr(line, 'catchup')
  const catchupSource = extractAttr(line, 'catchup-source')
  const catchupReplace = extractAttr(line, 'catchup-replace')
  if (catchupType || catchupSource) {
    channel.catchup = {
      type: (catchupType as 'append' | 'default') || 'append',
      source: catchupSource,
      replace: catchupReplace
    }
  }

  return { channel, groupName }
}

/** 解析 M3U 全局追看设置 */
function parseM3uCatchup(extm3uLine: string): Catchup | undefined {
  const catchupType = extractAttr(extm3uLine, 'catchup')
  const catchupSource = extractAttr(extm3uLine, 'catchup-source')
  const catchupReplace = extractAttr(extm3uLine, 'catchup-replace')

  if (!catchupType && !catchupSource) return undefined

  return {
    type: (catchupType as 'append' | 'default') || 'append',
    source: catchupSource,
    replace: catchupReplace
  }
}

/** M3U 指令解析结果 */
interface M3uDirectiveResult {
  channel?: Partial<Channel>
  directives?: Directives
}

/** 解析 M3U 专用指令行 */
function parseM3uDirective(line: string): M3uDirectiveResult | null {
  // #EXTHTTP: JSON 格式标头
  if (line.startsWith('#EXTHTTP:')) {
    try {
      const header = JSON.parse(line.substring(9).trim())
      return { channel: { header } }
    } catch {
      return null
    }
  }

  // #EXTVLCOPT:http-user-agent=
  if (line.startsWith('#EXTVLCOPT:http-user-agent=')) {
    return { channel: { ua: line.substring(27).trim() } }
  }

  // #EXTVLCOPT:http-referrer=
  if (line.startsWith('#EXTVLCOPT:http-referrer=')) {
    return { channel: { referer: line.substring(25).trim() } }
  }

  // #EXTVLCOPT:http-origin=
  if (line.startsWith('#EXTVLCOPT:http-origin=')) {
    return { channel: { origin: line.substring(22).trim() } }
  }

  // #KODIPROP: DRM 相关
  if (line.startsWith('#KODIPROP:')) {
    return parseKodiProp(line.substring(10).trim())
  }

  // 通用指令行（format=、parse= 等）
  const directive = parseDirective(line)
  if (directive) {
    return { directives: directive }
  }

  return null
}

/** 解析 #KODIPROP 指令 */
function parseKodiProp(prop: string): M3uDirectiveResult {
  const result: M3uDirectiveResult = {}

  if (prop.startsWith('inputstream.adaptive.license_type=')) {
    const drmType = prop.substring(34).trim()
    result.channel = {
      drm: { type: drmType, key: '' }
    }
  } else if (prop.startsWith('inputstream.adaptive.license_key=')) {
    const licenseKey = prop.substring(33).trim()
    // 解析 license_key，可能包含 | 分隔的标头
    const pipeIdx = licenseKey.indexOf('|')
    const key = pipeIdx > 0 ? licenseKey.substring(0, pipeIdx) : licenseKey

    if (result.channel?.drm) {
      result.channel.drm.key = key
      // 解析 license 标头
      if (pipeIdx > 0) {
        const headerPart = licenseKey.substring(pipeIdx + 1)
        const header: Record<string, string> = {}
        for (const pair of headerPart.split('&')) {
          const eqIdx = pair.indexOf('=')
          if (eqIdx > 0) {
            header[pair.substring(0, eqIdx)] = pair.substring(eqIdx + 1)
          }
        }
        result.channel.drm.header = header
      }
    } else {
      result.channel = {
        drm: { type: '', key }
      }
    }
  } else if (prop.startsWith('inputstream.adaptive.drm_legacy=')) {
    // 快速宣告：类型|URL
    const legacy = prop.substring(32).trim()
    const pipeIdx = legacy.indexOf('|')
    if (pipeIdx > 0) {
      result.channel = {
        drm: {
          type: legacy.substring(0, pipeIdx),
          key: legacy.substring(pipeIdx + 1)
        }
      }
    }
  } else if (prop.startsWith('inputstream.adaptive.manifest_type=')) {
    const manifestType = prop.substring(35).trim()
    result.directives = { format: mapFormat(manifestType) }
  } else if (
    prop.startsWith('inputstream.adaptive.stream_headers=') ||
    prop.startsWith('inputstream.adaptive.common_headers=')
  ) {
    const headersPart = prop.substring(prop.indexOf('=') + 1)
    const header: Record<string, string> = {}
    for (const pair of headersPart.split('&')) {
      const eqIdx = pair.indexOf('=')
      if (eqIdx > 0) {
        const key = pair.substring(0, eqIdx)
        const value = pair.substring(eqIdx + 1)
        // 特殊键名映射
        if (key === 'drmScheme') {
          if (!result.channel) result.channel = {}
          if (!result.channel.drm) result.channel.drm = { type: value, key: '' }
          else result.channel.drm.type = value
        } else if (key === 'drmLicense') {
          if (!result.channel) result.channel = {}
          if (!result.channel.drm) result.channel.drm = { type: '', key: value }
          else result.channel.drm.key = value
        } else {
          header[key] = value
        }
      }
    }
    if (Object.keys(header).length > 0) {
      result.channel = { ...result.channel, header }
    }
  }

  return result
}
