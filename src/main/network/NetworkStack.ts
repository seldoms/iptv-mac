/**
 * 网络栈
 * 自定义 HTTP 请求函数，支持：
 * - DoH (DNS over HTTPS)
 * - 代理支持 (HTTP/HTTPS/SOCKS4/SOCKS5)
 * - Hosts 覆盖
 * - 广告拦截
 * - 自定义标头注入
 * - 请求超时
 */
import http from 'http'
import https from 'https'
import { URL } from 'url'
import { ProxyAgent } from 'proxy-agent'
import type { VodConfig, Doh, ProxyConfig, HeaderConfig } from '../../shared/types'

/** 请求选项 */
export interface RequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers?: Record<string, string>
  body?: string | Buffer
  timeout?: number
  responseType?: 'text' | 'arraybuffer'
}

/** 响应结果 */
export interface ResponseResult {
  status: number
  data: string
  headers: Record<string, string>
}

// ==================== 全局网络配置 ====================

/** DoH 服务器列表 */
let dohServers: Doh[] = []

/** 代理规则列表 */
let proxyRules: ProxyConfig[] = []

/** Hosts 覆盖规则 */
let hostsRules: string[] = []

/** 广告域名黑名单 */
let adDomains: string[] = []

/** 标头注入规则 */
let headerRules: HeaderConfig[] = []

/** DNS 缓存（DoH 解析结果） */
const dnsCache = new Map<string, { ip: string; expire: number }>()

/**
 * 应用 VodConfig 中的网络配置
 */
export function applyNetworkConfig(config: VodConfig): void {
  dohServers = config.doh || []
  proxyRules = config.proxy || []
  hostsRules = config.hosts || []
  adDomains = config.ads || []
  headerRules = config.headers || []
}

/**
 * 发起 HTTP 请求
 * 使用 Node.js 内置 http/https 模块，支持 ProxyAgent
 */
export async function request(options: RequestOptions): Promise<ResponseResult> {
  const {
    url,
    method = 'GET',
    headers = {},
    body,
    timeout = 15000,
    responseType = 'text'
  } = options

  // 检查广告拦截
  if (isAdBlocked(url)) {
    throw new Error(`请求被广告拦截: ${url}`)
  }

  // 应用 Hosts 覆盖
  const finalUrl = applyHosts(url)

  // 应用标头注入
  const finalHeaders = applyHeaderInjection(finalUrl, { ...headers })

  // 获取代理
  const proxyUrl = getProxyUrl(finalUrl)

  // DoH 解析
  await resolveDns(finalUrl)

  // 解析 URL
  const parsed = new URL(finalUrl)
  const isHttps = parsed.protocol === 'https:'

  // 构建请求选项
  const reqOptions: https.RequestOptions = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method,
    headers: finalHeaders,
    timeout
  }

  // 设置代理
  if (proxyUrl) {
    reqOptions.agent = new ProxyAgent({
      getProxyForUrl: () => proxyUrl
    }) as http.Agent
  }

  return new Promise((resolve, reject) => {
    const requestModule = isHttps ? https : http
    const req = requestModule.request(reqOptions, (res) => {
      const chunks: Buffer[] = []

      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })

      res.on('end', () => {
        const buffer = Buffer.concat(chunks)
        let data: string

        if (responseType === 'arraybuffer') {
          data = buffer.toString('binary')
        } else {
          data = buffer.toString('utf-8')
        }

        // 提取响应头
        const responseHeaders: Record<string, string> = {}
        for (const [key, value] of Object.entries(res.headers)) {
          if (typeof value === 'string') {
            responseHeaders[key] = value
          } else if (Array.isArray(value)) {
            responseHeaders[key] = value.join(', ')
          }
        }

        resolve({
          status: res.statusCode || 200,
          data,
          headers: responseHeaders
        })
      })

      res.on('error', reject)
    })

    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`请求超时: ${finalUrl}`))
    })

    // 发送请求体
    if (body && (method === 'POST' || method === 'PUT')) {
      if (typeof body === 'string') {
        req.write(body)
      } else {
        req.write(body)
      }
    }

    req.end()
  })
}

// ==================== DoH 支持 ====================

/**
 * 通过 DoH 解析域名
 */
async function resolveDns(url: string): Promise<void> {
  if (dohServers.length === 0) return

  try {
    const hostname = new URL(url).hostname

    // 检查缓存
    const cached = dnsCache.get(hostname)
    if (cached && cached.expire > Date.now()) return

    // 使用第一个 DoH 服务器
    const doh = dohServers[0]
    const dohUrl = `${doh.url}?name=${encodeURIComponent(hostname)}&type=A`

    // 使用内置 request 函数进行 DoH 查询（避免递归代理）
    const parsed = new URL(dohUrl)
    const isHttps = parsed.protocol === 'https:'

    const result = await new Promise<{ Answer?: { data: string; TTL: number }[] }>(
      (resolve, reject) => {
        const reqOptions: https.RequestOptions = {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers: { Accept: 'application/dns-json' },
          timeout: 5000
        }

        const requestModule = isHttps ? https : http
        const req = requestModule.request(reqOptions, (res) => {
          let data = ''
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString()
          })
          res.on('end', () => {
            try {
              resolve(JSON.parse(data))
            } catch {
              resolve({})
            }
          })
          res.on('error', reject)
        })
        req.on('error', reject)
        req.on('timeout', () => {
          req.destroy()
          reject(new Error('DoH 请求超时'))
        })
        req.end()
      }
    )

    if (result.Answer && result.Answer.length > 0) {
      const answer = result.Answer[0]
      dnsCache.set(hostname, {
        ip: answer.data,
        expire: Date.now() + answer.TTL * 1000
      })
    }
  } catch {
    // DoH 解析失败，回退到系统 DNS
  }
}

// ==================== 代理支持 ====================

/**
 * 获取匹配的代理 URL
 */
function getProxyUrl(url: string): string | undefined {
  if (proxyRules.length === 0) return undefined

  try {
    const hostname = new URL(url).hostname

    for (const rule of proxyRules) {
      for (const host of rule.hosts) {
        try {
          const regex = new RegExp(host)
          if (regex.test(hostname)) {
            return rule.urls[0]
          }
        } catch {
          // 正则语法错误，尝试直接匹配
          if (hostname.includes(host) || host === '.*') {
            return rule.urls[0]
          }
        }
      }
    }
  } catch {
    // URL 解析失败
  }

  return undefined
}

// ==================== Hosts 覆盖 ====================

/**
 * 应用 Hosts 覆盖规则
 * 格式：原始主机名=目标主机名（或 IP）
 */
function applyHosts(url: string): string {
  if (hostsRules.length === 0) return url

  try {
    const parsed = new URL(url)
    const originalHost = parsed.hostname

    for (const rule of hostsRules) {
      const eqIdx = rule.indexOf('=')
      if (eqIdx <= 0) continue

      const from = rule.substring(0, eqIdx).trim()
      const to = rule.substring(eqIdx + 1).trim()

      // 支持通配符匹配
      if (matchHost(originalHost, from)) {
        // 替换 hostname
        parsed.hostname = to
        return parsed.href
      }
    }
  } catch {
    // URL 解析失败
  }

  return url
}

/**
 * 主机名匹配（支持通配符 *）
 */
function matchHost(hostname: string, pattern: string): boolean {
  if (pattern === hostname) return true
  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$')
    return regex.test(hostname)
  }
  return false
}

// ==================== 广告拦截 ====================

/**
 * 检查 URL 是否被广告拦截
 */
function isAdBlocked(url: string): boolean {
  if (adDomains.length === 0) return false

  try {
    const hostname = new URL(url).hostname
    return adDomains.some((ad) => hostname === ad || hostname.endsWith(`.${ad}`))
  } catch {
    return false
  }
}

// ==================== 标头注入 ====================

/**
 * 应用标头注入规则
 */
function applyHeaderInjection(
  url: string,
  headers: Record<string, string>
): Record<string, string> {
  if (headerRules.length === 0) return headers

  try {
    const hostname = new URL(url).hostname

    for (const rule of headerRules) {
      if (hostname === rule.host || hostname.endsWith(`.${rule.host}`)) {
        Object.assign(headers, rule.header)
      }
    }
  } catch {
    // URL 解析失败
  }

  return headers
}

/**
 * 清除 DNS 缓存
 */
export function clearDnsCache(): void {
  dnsCache.clear()
}
