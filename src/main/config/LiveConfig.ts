/**
 * 直播配置解析器
 * 解析 LiveConfig JSON，支持内嵌于 VodConfig 的 lives 数组
 */
import type { LiveConfig, LiveSource, Group, Channel } from '../../shared/types'
import { request } from '../network/NetworkStack'
import { resolveRelativePath } from './VodConfig'
import { parseLiveContent } from '../live/LiveParser'

/**
 * 解析 LiveConfig JSON
 */
export function parseLiveConfig(json: string, baseUrl?: string): LiveConfig {
  const raw = JSON.parse(json)
  return transformLiveConfig(raw, baseUrl)
}

/**
 * 从 URL 加载 LiveConfig
 */
export async function loadLiveConfig(url: string): Promise<LiveConfig> {
  const response = await request({ url, method: 'GET' })
  return parseLiveConfig(response.data, url)
}

/**
 * 从 VodConfig 的 lives 数组提取直播源
 * VodConfig.lives 可以包含内嵌 groups 或指向外部 URL
 */
export function extractLivesFromVodConfig(
  lives: LiveSource[],
  baseUrl?: string
): LiveSource[] {
  return lives.map((live) => {
    const result = { ...live }
    // 解析相对路径
    if (baseUrl) {
      if (result.url) {
        result.url = resolveRelativePath(result.url, baseUrl)
      }
      if (result.jar) {
        result.jar = resolveRelativePath(result.jar, baseUrl)
      }
    }
    return result
  })
}

/**
 * 加载直播源内容
 * 如果 live.url 存在则从 URL 加载并解析频道列表
 * 如果 live.groups 存在则直接使用
 */
export async function loadLiveSource(live: LiveSource): Promise<Group[]> {
  // 如果已有内嵌 groups，直接返回
  if (live.groups && live.groups.length > 0) {
    return live.groups
  }

  // 如果有 URL，从 URL 加载
  if (live.url) {
    try {
      const response = await request({ url: live.url, method: 'GET' })
      // 检查 HTTP 状态码
      if (response.status >= 400) {
        console.error(`加载直播源失败 [${live.name}]: HTTP ${response.status}`)
        return []
      }
      const content = response.data
      // 检查内容是否为有效格式（非 HTML 错误页）
      const trimmed = content.trim()
      if (trimmed.startsWith('<!') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML')) {
        console.error(`加载直播源失败 [${live.name}]: 返回了 HTML 而非直播数据`)
        return []
      }
      return parseLiveContent(content)
    } catch (err) {
      console.error(`加载直播源失败 [${live.name}]:`, err)
      return []
    }
  }

  // 如果有 api，通过 spider 加载
  if (live.api) {
    // TODO: 通过 SpiderLoader 加载 spider 并调用 liveContent
    console.warn(`直播源 [${live.name}] 使用 Spider API，暂未实现`)
    return []
  }

  return []
}

/**
 * 将原始 JSON 转换为 LiveConfig
 */
function transformLiveConfig(
  raw: Record<string, unknown>,
  baseUrl?: string
): LiveConfig {
  const lives: LiveSource[] = []

  if (Array.isArray(raw.lives)) {
    for (const l of raw.lives) {
      const live: LiveSource = {
        name: l.name ?? '',
        url: l.url,
        api: l.api,
        ext: l.ext,
        jar: l.jar,
        click: l.click,
        logo: l.logo,
        epg: l.epg,
        ua: l.ua,
        origin: l.origin,
        referer: l.referer,
        timeZone: l.timeZone ?? l.timezone,
        timeout: l.timeout,
        header: l.header,
        catchup: l.catchup,
        groups: l.groups,
        boot: l.boot,
        pass: l.pass
      }

      // 解析相对路径
      if (baseUrl) {
        if (live.url) {
          live.url = resolveRelativePath(live.url, baseUrl)
        }
        if (live.jar) {
          live.jar = resolveRelativePath(live.jar, baseUrl)
        }
      }

      lives.push(live)
    }
  }

  return {
    spider: raw.spider as string | undefined,
    lives,
    proxy: raw.proxy as LiveConfig['proxy'],
    rules: raw.rules as LiveConfig['rules'],
    headers: raw.headers as LiveConfig['headers'],
    hosts: raw.hosts as string[] | undefined,
    ads: raw.ads as string[] | undefined
  }
}
