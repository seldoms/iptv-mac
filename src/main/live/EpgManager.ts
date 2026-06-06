/**
 * EPG 管理器
 * 获取和解析 XMLTV 格式 EPG
 * 支持 .gz 压缩文件
 * 缓存 EPG 数据，每 6 小时刷新
 * 支持 API 模板 EPG（{id}、{name} 变量替换）
 */
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { request } from '../network/NetworkStack'
import type { EpgChannel, EpgProgram } from '../../shared/types'

/** EPG 缓存目录 */
const EPG_CACHE_DIR = join(app.getPath('userData'), 'epg_cache')

/** EPG 刷新间隔：6 小时 */
const EPG_REFRESH_INTERVAL = 6 * 60 * 60 * 1000

/** EPG 数据缓存 */
const epgCache = new Map<string, EpgChannel[]>()

/** EPG 加载时间记录 */
const epgLoadTime = new Map<string, number>()

/**
 * 获取 EPG 数据
 * @param epgUrl EPG URL，支持逗号分隔多个源
 * @param channelMap 频道映射（id/name -> 频道信息）
 */
export async function getEpgData(
  epgUrl: string,
  channelMap?: Map<string, { id?: string; name: string }>
): Promise<EpgChannel[]> {
  if (!epgUrl) return []

  const urls = epgUrl.split(',').map((u) => u.trim())
  const allChannels: EpgChannel[] = []
  const channelIndex = new Map<string, EpgChannel>()

  for (const url of urls) {
    try {
      const channels = await loadEpgFromUrl(url, channelMap)
      for (const ch of channels) {
        // 合并同名频道
        const existing = channelIndex.get(ch.name) || channelIndex.get(ch.id)
        if (existing) {
          existing.programs.push(...ch.programs)
        } else {
          channelIndex.set(ch.name, ch)
          if (ch.id) channelIndex.set(ch.id, ch)
          allChannels.push(ch)
        }
      }
    } catch (err) {
      console.error(`EPG 加载失败 [${url}]:`, err)
    }
  }

  // 按时间排序节目
  for (const ch of allChannels) {
    ch.programs.sort((a, b) => a.start.localeCompare(b.start))
  }

  return allChannels
}

/**
 * 从 URL 加载 EPG
 * 根据 URL 类型决定加载方式：
 * - 含 xml/gz：作为 XMLTV 源
 * - 含 {：作为 API 模板
 */
async function loadEpgFromUrl(
  url: string,
  channelMap?: Map<string, { id?: string; name: string }>
): Promise<EpgChannel[]> {
  // API 模板 EPG
  if (url.includes('{')) {
    return loadApiEpg(url, channelMap)
  }

  // XMLTV EPG
  return loadXmltvEpg(url)
}

/**
 * 加载 XMLTV 格式 EPG
 */
async function loadXmltvEpg(url: string): Promise<EpgChannel[]> {
  // 检查缓存
  const cacheKey = getCacheKey(url)
  const cached = epgCache.get(cacheKey)
  const lastLoad = epgLoadTime.get(cacheKey) || 0

  if (cached && Date.now() - lastLoad < EPG_REFRESH_INTERVAL) {
    return cached
  }

  // 尝试从磁盘缓存加载
  const diskCache = loadDiskCache(cacheKey)
  if (diskCache && Date.now() - lastLoad < EPG_REFRESH_INTERVAL) {
    epgCache.set(cacheKey, diskCache)
    epgLoadTime.set(cacheKey, Date.now())
    return diskCache
  }

  // 从网络加载
  let xmlContent: string

  if (url.endsWith('.gz')) {
    // 下载并解压 .gz 文件
    const response = await request({ url, method: 'GET', responseType: 'arraybuffer' })
    const buffer = Buffer.from(response.data, 'binary')
    const { gunzipSync } = await import('zlib')
    xmlContent = gunzipSync(buffer).toString('utf-8')
  } else {
    const response = await request({ url, method: 'GET' })
    xmlContent = response.data
  }

  // 解析 XMLTV
  const channels = parseXmltv(xmlContent)

  // 缓存
  epgCache.set(cacheKey, channels)
  epgLoadTime.set(cacheKey, Date.now())
  saveDiskCache(cacheKey, channels)

  return channels
}

/**
 * 加载 API 模板 EPG
 * 支持 {id} 和 {name} 变量替换
 */
async function loadApiEpg(
  template: string,
  channelMap?: Map<string, { id?: string; name: string }>
): Promise<EpgChannel[]> {
  if (!channelMap || channelMap.size === 0) return []

  const channels: EpgChannel[] = []

  for (const [, info] of channelMap) {
    try {
      const url = template
        .replace('{id}', info.id || info.name)
        .replace('{name}', encodeURIComponent(info.name))

      const response = await request({ url, method: 'GET' })
      const data = JSON.parse(response.data)

      // API 返回格式：{ channel: string, programs: [...] } 或直接是数组
      if (Array.isArray(data)) {
        const programs: EpgProgram[] = data.map((p: Record<string, unknown>) => ({
          channel: info.name,
          title: String(p.title ?? ''),
          start: String(p.start ?? ''),
          stop: String(p.stop ?? ''),
          desc: p.desc ? String(p.desc) : undefined
        }))
        channels.push({
          id: info.id || info.name,
          name: info.name,
          programs
        })
      } else if (data.programs) {
        channels.push({
          id: info.id || info.name,
          name: info.name,
          programs: data.programs
        })
      }
    } catch {
      // 单个频道 EPG 加载失败不影响其他频道
    }
  }

  return channels
}

/**
 * 解析 XMLTV 格式 XML
 */
function parseXmltv(xml: string): EpgChannel[] {
  // 简单的 XML 解析，避免引入重量级 XML 解析库
  const channels: EpgChannel[] = []
  const channelMap = new Map<string, EpgChannel>()

  // 解析频道定义 <channel id="xxx">
  const channelRegex = /<channel\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/g
  let match: RegExpExecArray | null

  while ((match = channelRegex.exec(xml)) !== null) {
    const id = match[1]
    const content = match[2]

    // 提取频道名称
    const nameMatch = content.match(/<display-name[^>]*>([^<]*)<\/display-name>/)
    const name = nameMatch ? nameMatch[1].trim() : id

    // 提取 logo
    const logoMatch = content.match(/<icon\s+src="([^"]*)"/)
    const logo = logoMatch ? logoMatch[1] : undefined

    const channel: EpgChannel = { id, name, logo, programs: [] }
    channelMap.set(id, channel)
    channels.push(channel)
  }

  // 解析节目 <programme start="..." stop="..." channel="xxx">
  const programmeRegex = /<programme\s+start="([^"]*)"\s+stop="([^"]*)"\s+channel="([^"]*)"[^>]*>([\s\S]*?)<\/programme>/g

  while ((match = programmeRegex.exec(xml)) !== null) {
    const start = formatXmltvTime(match[1])
    const stop = formatXmltvTime(match[2])
    const channelId = match[3]
    const content = match[4]

    // 提取标题
    const titleMatch = content.match(/<title[^>]*>([^<]*)<\/title>/)
    const title = titleMatch ? titleMatch[1].trim() : ''

    // 提取描述
    const descMatch = content.match(/<desc[^>]*>([^<]*)<\/desc>/)
    const desc = descMatch ? descMatch[1].trim() : undefined

    const channel = channelMap.get(channelId)
    if (channel) {
      channel.programs.push({ channel: channelId, title, start, stop, desc })
    }
  }

  return channels
}

/**
 * 格式化 XMLTV 时间
 * 输入格式：20260312140000 +0800 或 20260312140000
 * 输出格式：2026-03-12 14:00:00
 */
function formatXmltvTime(time: string): string {
  // 去掉时区信息
  const cleaned = time.replace(/\s*[+-]\d{4}$/, '')
  if (cleaned.length < 14) return time

  return `${cleaned.substring(0, 4)}-${cleaned.substring(4, 6)}-${cleaned.substring(6, 8)} ${cleaned.substring(8, 10)}:${cleaned.substring(10, 12)}:${cleaned.substring(12, 14)}`
}

/**
 * 获取当前播放的节目信息
 */
export function getCurrentProgram(
  channels: EpgChannel[],
  channelName: string
): EpgProgram | undefined {
  const channel = channels.find(
    (c) => c.name === channelName || c.id === channelName
  )
  if (!channel) return undefined

  const now = new Date()
  const nowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`

  return channel.programs.find((p) => p.start <= nowStr && p.stop > nowStr)
}

// ==================== 磁盘缓存 ====================

function getCacheKey(url: string): string {
  // 用 URL 的简单哈希作为缓存键
  let hash = 0
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return `epg_${Math.abs(hash).toString(36)}`
}

function loadDiskCache(cacheKey: string): EpgChannel[] | null {
  try {
    const filePath = join(EPG_CACHE_DIR, `${cacheKey}.json`)
    if (!existsSync(filePath)) return null

    const data = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(data)
    // 检查缓存时间
    if (parsed.timestamp && Date.now() - parsed.timestamp < EPG_REFRESH_INTERVAL) {
      return parsed.channels as EpgChannel[]
    }
    return null
  } catch {
    return null
  }
}

function saveDiskCache(cacheKey: string, channels: EpgChannel[]): void {
  try {
    if (!existsSync(EPG_CACHE_DIR)) {
      mkdirSync(EPG_CACHE_DIR, { recursive: true })
    }
    const filePath = join(EPG_CACHE_DIR, `${cacheKey}.json`)
    writeFileSync(filePath, JSON.stringify({ timestamp: Date.now(), channels }), 'utf-8')
  } catch (err) {
    console.error('EPG 磁盘缓存写入失败:', err)
  }
}

/**
 * 清除 EPG 缓存
 */
export function clearEpgCache(): void {
  epgCache.clear()
  epgLoadTime.clear()

  try {
    if (existsSync(EPG_CACHE_DIR)) {
      const { rmSync } = require('fs')
      rmSync(EPG_CACHE_DIR, { recursive: true, force: true })
    }
  } catch {
    // 忽略清除错误
  }
}
