/**
 * 直播 URL 连通性测试器
 * 测试 URL 是否可用，记录延迟时间
 */
import http from 'http'
import https from 'https'
import { URL } from 'url'

export interface TestResult {
  url: string
  alive: boolean
  latency: number // ms, -1 表示不可用
  error?: string
}

export interface TestOptions {
  timeout?: number        // 单个 URL 超时时间 (ms)
  concurrency?: number    // 并发数
  retries?: number        // 失败重试次数
}

const DEFAULT_OPTIONS: Required<TestOptions> = {
  timeout: 5000,
  concurrency: 10,
  retries: 1
}

/**
 * 测试单个 URL
 */
export async function testUrl(
  url: string,
  options: TestOptions = {}
): Promise<TestResult> {
  const { timeout = DEFAULT_OPTIONS.timeout } = options

  const startTime = Date.now()

  try {
    const parsed = new URL(url)
    const isHttps = parsed.protocol === 'https:'

    return new Promise((resolve) => {
      const reqOptions: https.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'HEAD',
        timeout
      }

      const requestModule = isHttps ? https : http
      const req = requestModule.request(reqOptions, (res) => {
        const latency = Date.now() - startTime

        // 读取少量数据即可关闭
        res.resume()
        res.on('end', () => {
          resolve({
            url,
            alive: res.statusCode !== undefined && res.statusCode < 400,
            latency,
            error: res.statusCode && res.statusCode >= 400
              ? `HTTP ${res.statusCode}`
              : undefined
          })
        })
      })

      req.on('error', (err) => {
        resolve({
          url,
          alive: false,
          latency: -1,
          error: err.message
        })
      })

      req.on('timeout', () => {
        req.destroy()
        resolve({
          url,
          alive: false,
          latency: -1,
          error: 'Timeout'
        })
      })

      req.end()
    })
  } catch (err) {
    return {
      url,
      alive: false,
      latency: -1,
      error: (err as Error).message
    }
  }
}

/**
 * 批量测试 URL（并发控制）
 */
export async function testBatch(
  urls: string[],
  options: TestOptions = {},
  onProgress?: (current: number, total: number) => void
): Promise<TestResult[]> {
  const { concurrency = DEFAULT_OPTIONS.concurrency, retries = DEFAULT_OPTIONS.retries } = options

  const results: TestResult[] = new Array(urls.length)
  let completed = 0

  // 分批处理
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency)
    const promises = batch.map(async (url, batchIdx) => {
      let result = await testUrl(url, options)

      // 失败重试
      if (!result.alive && retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        result = await testUrl(url, options)
      }

      const idx = i + batchIdx
      results[idx] = result
      completed++

      if (onProgress) {
        onProgress(completed, urls.length)
      }
    })

    await Promise.all(promises)
  }

  return results
}
