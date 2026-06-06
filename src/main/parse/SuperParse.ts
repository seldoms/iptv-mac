/**
 * 分层解析体系 - SuperParse
 * 参考 FongMi/TV Android 版的 ParseJob
 *
 * 核心策略（与 Android 一致）：
 * 1. 直链识别 → 0ms 直接播放
 * 2. JSON Parse 并行 → 200~500ms（主力，Android 秒播的关键）
 * 3. Chromium Sniffer → 兜底（onBeforeRequest 实时拦截）
 * 4. 解析结果缓存 → 避免重复解析
 */

import { BrowserWindow, session } from 'electron'
import type { Parse, Site } from '../../shared/types'

/**
 * 安全化 clickScript，只允许简单的选择器点击操作
 * 防止恶意脚本执行
 */
function sanitizeClickScript(script: string): string | null {
  // 只允许非常简单的点击脚本模式
  // 例如：document.querySelector('.play-btn')?.click()
  const safePattern = /^[\s]*document\.(querySelector|getElementById|getElementsByClassName|getElementsByTagName)\(['"]([^'"]+)['"]\)\?\.click\(\)[\s;]*$/i;
  
  if (safePattern.test(script)) {
    return script;
  }
  
  // 如果不是安全模式，返回 null 不执行
  console.warn('[SuperParse] 不安全的 clickScript 被拒绝:', script.substring(0, 100));
  return null;
}

// ==================== 解析缓存 ====================

const parseCache = new Map<string, { url: string; header?: Record<string, string>; from: string; time: number }>()
const CACHE_TTL = 30 * 60 * 1000 // 30分钟缓存

function getCached(key: string): { url: string; header?: Record<string, string>; from: string } | null {
  const cached = parseCache.get(key)
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    console.log('[SuperParse] 命中缓存:', key.substring(0, 80), '→', cached.url.substring(0, 80))
    return { url: cached.url, header: cached.header, from: cached.from + '(cache)' }
  }
  if (cached) parseCache.delete(key)
  return null
}

function setCache(key: string, result: { url: string; header?: Record<string, string>; from: string }) {
  parseCache.set(key, { ...result, time: Date.now() })
  // 清理过期缓存
  if (parseCache.size > 200) {
    const now = Date.now()
    for (const [k, v] of parseCache) {
      if (now - v.time > CACHE_TTL) parseCache.delete(k)
    }
  }
}

// ==================== Level 0: 直链识别 ====================

const VIDEO_FORMAT_REGEX = /https?:\/\/[^\s]{12,}\.(?:m3u8|m3u|mp4|flv|hlv|f4v|mkv|avi|wmv|mov|webm|ts|m4s|mpd|aac|mp3|m4a)(?:\?.*)?/i
const VIDEO_TOS_REGEX = /https?:\/\/.*?video\/tos[^\s]*/i
const RTMP_REGEX = /rtmp:[^\s]+/i

export function isVideoFormat(url: string): boolean {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return false
  if (VIDEO_FORMAT_REGEX.test(url)) return true
  if (VIDEO_TOS_REGEX.test(url)) return true
  if (RTMP_REGEX.test(url)) return true
  return false
}

export function needParse(url: string, playUrl?: string): boolean {
  if (isVideoFormat(url) && !playUrl) return false
  return true
}

// ==================== Level 1: JSON Parse ====================

/**
 * JSON 解析服务 - 参考 Android ParseJob.jsonParse
 * 关键优化：3秒超时（Android 也是快速失败策略）
 */
async function jsonParse(
  parseItem: Parse,
  webUrl: string,
  headers?: Record<string, string>
): Promise<{ url: string; header?: Record<string, string>; from: string } | null> {
  try {
    const fetchUrl = parseItem.url + encodeURIComponent(webUrl)
    console.log('[SuperParse] JSON解析:', parseItem.name, fetchUrl.substring(0, 120))

    const fetchHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      ...headers
    }
    if (parseItem.ext?.header) {
      Object.assign(fetchHeaders, parseItem.ext.header)
    }

    const response = await fetch(fetchUrl, {
      headers: fetchHeaders,
      signal: AbortSignal.timeout(3000) // 3秒超时，与 Android 快速失败一致
    })

    if (!response.ok) {
      console.log('[SuperParse] JSON解析HTTP错误:', parseItem.name, response.status)
      return null
    }

    const text = await response.text()
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      console.log('[SuperParse] JSON解析返回非JSON:', parseItem.name, text.substring(0, 80))
      return null
    }

    // 提取 url - 参考 Android Result.fromJson
    let url = data.url || data.playUrl || ''
    if (!url && data.data) {
      url = data.data.url || data.data.playUrl || ''
    }

    // 参考 Android checkResult: url.length > 40 才算有效
    if (!url || url.length < 10) return null

    const resultHeader: Record<string, string> = {}
    if (data.header && typeof data.header === 'object') {
      Object.assign(resultHeader, data.header)
    }
    for (const key of ['User-Agent', 'user-agent', 'ua', 'Referer', 'referer', 'Cookie', 'cookie']) {
      if (data[key]) resultHeader[key] = data[key]
    }

    console.log('[SuperParse] JSON解析成功:', parseItem.name, 'url:', url.substring(0, 100))
    return { url, header: Object.keys(resultHeader).length > 0 ? resultHeader : undefined, from: parseItem.name }
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.code === 'ABORT_ERR') {
      console.log('[SuperParse] JSON解析超时:', parseItem.name)
    } else {
      console.log('[SuperParse] JSON解析异常:', parseItem.name, err?.message || err)
    }
    return null
  }
}

// ==================== Level 3: Chromium Sniffer ====================

/**
 * Chromium 嗅探 - 参考 Android CustomWebView.shouldInterceptRequest
 * 优化：onBeforeRequest 实时拦截，发现 m3u8/mp4 立即返回
 */
function sniffByBrowser(
  webUrl: string,
  referer?: string,
  clickScript?: string
): Promise<{ url: string; header?: Record<string, string> } | null> {
  return new Promise((resolve) => {
    const partition = `sniff-${Date.now()}`
    const ses = session.fromPartition(partition)
    let resolved = false
    const mediaUrls: string[] = []

    // 移除了禁用证书验证的代码，保持安全默认行为

    ses.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

    // 核心：onBeforeRequest 实时拦截 - 与 Android shouldInterceptRequest 等价
    ses.webRequest.onBeforeRequest((details, callback) => {
      if (!resolved) {
        const reqUrl = details.url
        if (isVideoFormat(reqUrl)) {
          mediaUrls.push(reqUrl)
          // 发现 m3u8/mp4 立即返回！
          if (/\.m3u8(\?|$)/i.test(reqUrl) || /\.mp4(\?|$)/i.test(reqUrl)) {
            resolved = true
            resolve({ url: reqUrl })
            callback({ cancel: true })
            setTimeout(() => { try { win.close() } catch {} }, 100)
            return
          }
        }
        // 参考 Android PLAYER 正则
        if (/player.*https?:\/\//i.test(reqUrl) && !mediaUrls.includes(reqUrl)) {
          mediaUrls.push(reqUrl)
        }
      }
      callback({})
    })

    // onResponseStarted 检查 content-type
    ses.webRequest.onResponseStarted((details) => {
      if (resolved) return
      const reqUrl = details.url
      const responseHeaders = details.responseHeaders
      let contentType = ''

      if (responseHeaders && typeof responseHeaders === 'object') {
        try {
          if (Array.isArray(responseHeaders)) {
            for (const header of responseHeaders) {
              if (header.name && header.name.toLowerCase() === 'content-type') {
                contentType = (header.value || '').toLowerCase().split(';')[0]
              }
            }
          } else {
            for (const key of Object.keys(responseHeaders)) {
              if (key.toLowerCase() === 'content-type') {
                const val = responseHeaders[key]
                contentType = (Array.isArray(val) ? val[0] : String(val)).toLowerCase().split(';')[0]
              }
            }
          }
        } catch { /* ignore */ }
      }

      const isMediaMime = contentType.startsWith('video/') ||
        contentType.startsWith('audio/') ||
        contentType.includes('mpegurl') ||
        contentType.includes('mp2t') ||
        contentType.includes('application/dash+xml')

      if (isMediaMime && !mediaUrls.includes(reqUrl)) {
        mediaUrls.push(reqUrl)
        if (!resolved) {
          resolved = true
          resolve({ url: reqUrl })
          setTimeout(() => { try { win.close() } catch {} }, 100)
        }
      }
    })

    if (referer) {
      ses.webRequest.onBeforeSendHeaders((details, callback) => {
        callback({
          requestHeaders: {
            ...details.requestHeaders,
            Referer: referer
          }
        })
      })
    }

    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true // 保持 webSecurity 启用以确保安全
      }
    })

    win.webContents.on('dom-ready', () => {
      if (resolved) return
      // 注入媒体拦截脚本
      win.webContents.executeJavaScript(`
        (function() {
          const origSrcSet = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
          if (origSrcSet && origSrcSet.set) {
            Object.defineProperty(HTMLMediaElement.prototype, 'src', {
              set: function(val) {
                if (val && !val.startsWith('blob:') && val.startsWith('http')) {
                  window.__sniffedMediaUrls = window.__sniffedMediaUrls || [];
                  window.__sniffedMediaUrls.push(val);
                }
                return origSrcSet.set.call(this, val);
              },
              get: origSrcSet.get
            });
          }

          // 拦截 window.location 跳转（很多站点通过 location.href 重定向到真实 URL）
          try {
            const origAssign = window.location.assign;
            const origReplace = window.location.replace;
            window.location.assign = function(url) {
              if (url && url.startsWith('http')) {
                window.__sniffedMediaUrls = window.__sniffedMediaUrls || [];
                window.__sniffedMediaUrls.push(url);
              }
              return origAssign.call(this, url);
            };
            window.location.replace = function(url) {
              if (url && url.startsWith('http')) {
                window.__sniffedMediaUrls = window.__sniffedMediaUrls || [];
                window.__sniffedMediaUrls.push(url);
              }
              return origReplace.call(this, url);
            };
          } catch {}

          // 拦截动态创建的 <script> 标签（一些站点动态注入播放器）
          try {
            const origCreateElement = document.createElement.bind(document);
            document.createElement = function(tag) {
              const el = origCreateElement(tag);
              if (tag.toLowerCase() === 'script') {
                const origSetAttr = el.setAttribute.bind(el);
                el.setAttribute = function(name, value) {
                  if (name === 'src' && value && value.startsWith('http')) {
                    window.__sniffedMediaUrls = window.__sniffedMediaUrls || [];
                    window.__sniffedMediaUrls.push(value);
                  }
                  return origSetAttr(name, value);
                };
              }
              return el;
            };
          } catch {}
        })()
      `).catch(() => {})

      // 安全地执行 clickScript - 只允许简单的点击操作
      if (clickScript) {
        // 验证 clickScript 只包含简单的选择器和点击逻辑，避免执行危险代码
        const safeClickScript = sanitizeClickScript(clickScript);
        if (safeClickScript) {
          win.webContents.executeJavaScript(safeClickScript).catch(() => {})
        }
      }
    })

    win.webContents.on('did-finish-load', async () => {
      if (resolved) return

      // 自动点击播放按钮
      try {
        await win.webContents.executeJavaScript(`
          (function() {
            const selectors = ['.play-btn', '.vjs-big-play-button', '.video-play',
              '[class*="play"]', 'button[aria-label*="play"]',
              '.btn-play', '.player-play', '.play-button'];
            for (const sel of selectors) {
              const btns = document.querySelectorAll(sel);
              btns.forEach(btn => { try { btn.click(); } catch {} });
              if (btns.length > 0) break;
            }
            document.querySelectorAll('video').forEach(v => { try { v.play(); } catch {} });
          })()
        `)
      } catch { /* ignore */ }

      // 等待 2.5 秒后检查注入脚本捕获的URL
      await new Promise(r => setTimeout(r, 2500))
      if (resolved) return

      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            if (window.__sniffedMediaUrls && window.__sniffedMediaUrls.length > 0) {
              for (let i = window.__sniffedMediaUrls.length - 1; i >= 0; i--) {
                const item = window.__sniffedMediaUrls[i];
                if (typeof item === 'string' && item.startsWith('http')) return item;
              }
            }
            const video = document.querySelector('video');
            if (video) {
              if (video.currentSrc && !video.currentSrc.startsWith('blob:')) return video.currentSrc;
              if (video.src && !video.src.startsWith('blob:')) return video.src;
            }
            return null;
          })()
        `)
        if (result && isVideoFormat(result)) {
          resolved = true
          resolve({ url: result })
          setTimeout(() => { try { win.close() } catch {} }, 100)
          return
        }
      } catch { /* ignore */ }
    })

    win.loadURL(webUrl)

    // 超时延长至 20 秒（页面需要 JS 执行 + 重定向才能露出真实 m3u8/mp4）
    setTimeout(() => {
      if (!resolved) {
        resolved = true
        try { win.close() } catch {}
        if (mediaUrls.length > 0) {
          const m3u8 = mediaUrls.find(u => /\.m3u8/i.test(u))
          const bestUrl = m3u8 || mediaUrls[0]
          console.log('[SuperParse:Sniffer] 超时（20s），使用已发现的URL:', bestUrl.substring(0, 120))
          resolve({ url: bestUrl })
        } else {
          console.log('[SuperParse:Sniffer] 超时（20s），未找到媒体URL')
          resolve(null)
        }
      }
    }, 20000)
  })
}

// ==================== SuperParse 入口 ====================

export interface SuperParseResult {
  url: string
  header?: Record<string, string>
  from: string
}

/**
 * SuperParse - 分层解析入口
 * 与 Android ParseJob 完全一致的策略：
 *
 * 1. 直链识别 → 直接播放（0ms）
 * 2. parse=0 → 直接播放
 * 3. parse=1 → 并行 JSON 解析 + 嗅探，Promise.any 取最快
 * 4. 缓存命中 → 直接返回
 */
export async function superParse(params: {
  url: string
  flag: string
  siteKey: string
  site?: Site
  parses?: Parse[]
  playUrl?: string
  click?: string
  header?: Record<string, string>
  playerResult?: { url: string; parse?: number; header?: Record<string, string>; playUrl?: string; click?: string }
}): Promise<SuperParseResult | null> {
  const { url, flag, siteKey, parses = [], click, header, playerResult } = params

  // ===== Level 0: 直链识别 =====
  if (isVideoFormat(url)) {
    return { url, header, from: 'direct' }
  }

  // ===== 获取 playerContent 结果 =====
  let playUrl = params.playUrl || ''
  let parse = 0
  let resultUrl = url
  let resultHeader = header
  let resultClick = click

  if (playerResult) {
    resultUrl = playerResult.url || url
    parse = playerResult.parse || 0
    resultHeader = playerResult.header || header
    playUrl = playerResult.playUrl || playUrl
    resultClick = playerResult.click || resultClick
  }

  // playerContent 返回的 URL 是直链
  if (isVideoFormat(resultUrl)) {
    console.log('[SuperParse] playerContent 返回直链:', resultUrl.substring(0, 100))
    setCache(resultUrl, { url: resultUrl, header: resultHeader, from: 'playerContent' })
    return { url: resultUrl, header: resultHeader, from: 'playerContent' }
  }

  // parse=0 直接播放
  if (parse === 0 && !needParse(resultUrl, playUrl)) {
    return { url: resultUrl, header: resultHeader, from: 'direct' }
  }

  // ===== 检查缓存 =====
  const cacheKey = `${resultUrl}|${flag}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  // ===== Level 1+2: 并行解析 =====
  const jsonParses = parses.filter(p => p.type === 1 && p.url)
  const webParses = parses.filter(p => p.type === 0 && p.url)
  console.log('[SuperParse] 启动并行解析, JSON解析数:', jsonParses.length, 'Web嗅探数:', webParses.length, 'URL:', resultUrl.substring(0, 100))

  // 构建并行任务 - 与 Android superParse 一致：所有 JSON 解析并行 + Web嗅探并行 + 1个原始嗅探
  const tasks: Promise<SuperParseResult | null>[] = []

  // JSON 解析任务（主力，200-500ms）
  for (const parseItem of jsonParses) {
    tasks.push(
      jsonParse(parseItem, resultUrl, resultHeader).then(result => {
        if (result) return { url: result.url, header: result.header, from: result.from }
        return null
      })
    )
  }

  // Web 嗅探解析任务（type=0，通过解析器URL嗅探视频地址）
  // 参考 Android：type=0 的解析器 URL = parseUrl + encodeURIComponent(videoUrl)
  // 注意：不并行启动所有 web 嗅探（每个创建1个 BrowserWindow 太重），
  // 而是作为 JSON 解析+原始嗅探都失败后的第二阶段
  // 但为了 Promise.any 并行效果，只启动前2个最可能成功的 web 嗅探
  const maxWebSniff = Math.min(webParses.length, 2)
  for (let i = 0; i < maxWebSniff; i++) {
    const parseItem = webParses[i]
    const sniffUrl = parseItem.url + encodeURIComponent(resultUrl)
    console.log('[SuperParse] Web嗅探:', parseItem.name, sniffUrl.substring(0, 120))
    tasks.push(
      sniffByBrowser(sniffUrl, undefined, resultClick).then(result => {
        if (result) return { url: result.url, header: result.header, from: `web:${parseItem.name}` }
        return null
      })
    )
  }

  // Chromium 嗅探任务（兜底）
  tasks.push(
    sniffByBrowser(resultUrl, undefined, resultClick).then(result => {
      if (result) return { url: result.url, header: result.header, from: 'sniffer' }
      return null
    })
  )

  // Promise.any() 取最快成功 - 与 Android CountDownLatch + AtomicBoolean 等价
  try {
    const result = await Promise.any(
      tasks.map(t => t.then(r => {
        if (r) return r
        throw new Error('no result')
      }))
    )
    console.log('[SuperParse] 并行解析成功, 来源:', result.from, 'url:', result.url.substring(0, 100))
    setCache(cacheKey, result)
    return result
  } catch {
    // 所有方法都失败，尝试 playUrl 拼接
    if (playUrl) {
      const fullUrl = playUrl + resultUrl
      if (isVideoFormat(fullUrl)) {
        const result = { url: fullUrl, header: resultHeader, from: 'playUrl' }
        setCache(cacheKey, result)
        return result
      }
      const sniffResult = await sniffByBrowser(fullUrl, undefined, resultClick)
      if (sniffResult) {
        const result = { url: sniffResult.url, header: sniffResult.header, from: 'sniffer+playUrl' }
        setCache(cacheKey, result)
        return result
      }
    }

    console.log('[SuperParse] 所有解析方式均失败')
    return null
  }
}
