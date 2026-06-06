/**
 * 本地 HTTP API 服务器
 * Express.js 服务器，端口从 9978 到 9998 自动检测
 * 实现所有 LOCAL.md 中定义的端点
 */
import express, { type Request, type Response, type NextFunction } from 'express'
import multer from 'multer'
import { app } from 'electron'
import { join, dirname } from 'path'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  rmdirSync,
  createReadStream
} from 'fs'
import { createUnzip } from 'zlib'
import { randomUUID } from 'crypto'
import type { Device, MediaState } from '../../shared/types'
import { getCachedSpider } from '../spider/SpiderLoader'
import { getCache, setCache, deleteCache } from '../store/Database'

/** 端口范围 */
const PORT_MIN = 9978
const PORT_MAX = 9998

/** 应用文件根目录 */
const FILE_ROOT = join(app.getPath('userData'), 'files')

/** 当前服务器实例 */
let server: ReturnType<typeof express> | null = null
let serverPort: number = 0

/** 当前播放状态 */
let mediaState: MediaState = {}

/** multer 文件上传中间件 */
const upload = multer({ storage: multer.memoryStorage() })

/**
 * 启动本地 HTTP 服务器
 * @returns 实际绑定的端口号
 */
export async function startLocalServer(): Promise<number> {
  if (server) return serverPort

  const app = express()

  // 解析 query string 和 JSON body
  app.use(express.urlencoded({ extended: true }))
  app.use(express.json())
  app.use(express.text())

  // 注册路由
  registerRoutes(app)

  // 尝试绑定端口
  for (let port = PORT_MIN; port <= PORT_MAX; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const srv = app.listen(port, '127.0.0.1')
        srv.on('listening', () => {
          serverPort = port
          server = app
          srv.close()
          resolve()
        })
        srv.on('error', reject)
      })

      // 正式启动
      await new Promise<void>((resolve, reject) => {
        const srv = app.listen(serverPort, '127.0.0.1')
        srv.on('listening', resolve)
        srv.on('error', reject)
      })

      console.log(`本地 HTTP 服务器启动: http://127.0.0.1:${serverPort}`)
      return serverPort
    } catch {
      continue
    }
  }

  throw new Error(`无法绑定端口 ${PORT_MIN}-${PORT_MAX}`)
}

/**
 * 停止本地 HTTP 服务器
 */
export function stopLocalServer(): void {
  server = null
  serverPort = 0
}

/**
 * 获取服务器端口
 */
export function getServerPort(): number {
  return serverPort
}

/**
 * 更新播放状态
 */
export function updateMediaState(state: Partial<MediaState>): void {
  mediaState = { ...mediaState, ...state }
}

/**
 * 注册所有路由
 */
function registerRoutes(app: express.Express): void {
  // ==================== /action ====================
  app.all('/action', handleAction)

  // ==================== /cache ====================
  app.all('/cache', handleCache)

  // ==================== /media ====================
  app.get('/media', handleMedia)

  // ==================== /file ====================
  app.get('/file/*', handleFile)
  app.get('/file', handleFile)

  // ==================== /upload ====================
  app.post('/upload', upload.single('file'), handleUpload)

  // ==================== 文件管理 ====================
  app.get('/newFolder', handleNewFolder)
  app.get('/delFolder', handleDelFolder)
  app.get('/delFile', handleDelFile)

  // ==================== /parse ====================
  app.get('/parse', handleParse)

  // ==================== /proxy ====================
  app.all('/proxy', handleProxy)

  // ==================== /device ====================
  app.get('/device', handleDevice)
}

// ==================== 路由处理函数 ====================

/** /action 路由 */
function handleAction(req: Request, res: Response): void {
  const action = (req.query.do || req.body?.do) as string

  switch (action) {
    case 'control':
      handleControl(req, res)
      break
    case 'refresh':
      handleRefresh(req, res)
      break
    case 'push':
      handlePush(req, res)
      break
    case 'file':
      handleFileAction(req, res)
      break
    case 'search':
      handleSearch(req, res)
      break
    case 'setting':
      handleSetting(req, res)
      break
    case 'cast':
      handleCast(req, res)
      break
    case 'sync':
      handleSync(req, res)
      break
    default:
      res.status(400).send(`未知动作: ${action}`)
  }
}

/** do=control 播放控制 */
function handleControl(req: Request, res: Response): void {
  const type = (req.query.type || req.body?.type) as string
  const validTypes = ['play', 'pause', 'stop', 'replay', 'prev', 'next', 'loop']

  if (!type || !validTypes.includes(type)) {
    res.status(400).send(`无效控制指令: ${type}`)
    return
  }

  // TODO: 发送播放控制事件到渲染进程
  res.send('OK')
}

/** do=refresh 刷新指令 */
function handleRefresh(req: Request, res: Response): void {
  const type = (req.query.type || req.body?.type) as string

  // TODO: 发送刷新事件到渲染进程
  res.send('OK')
}

/** do=push 推送播放 */
function handlePush(req: Request, res: Response): void {
  const url = (req.query.url || req.body?.url) as string

  if (!url) {
    res.status(400).send('缺少 url 参数')
    return
  }

  // TODO: 发送推送播放事件到渲染进程
  res.send('OK')
}

/** do=file 开启档案 */
function handleFileAction(req: Request, res: Response): void {
  const path = (req.query.path || req.body?.path) as string

  if (!path) {
    res.status(400).send('缺少 path 参数')
    return
  }

  // TODO: 根据副档名执行对应动作
  res.send('OK')
}

/** do=search 触发搜寻 */
function handleSearch(req: Request, res: Response): void {
  const word = (req.query.word || req.body?.word) as string

  if (!word) {
    res.status(400).send('缺少 word 参数')
    return
  }

  // TODO: 发送搜寻事件到渲染进程
  res.send('OK')
}

/** do=setting 载入配置 */
function handleSetting(req: Request, res: Response): void {
  const text = (req.query.text || req.body?.text) as string
  const name = (req.query.name || req.body?.name) as string

  if (!text) {
    res.status(400).send('缺少 text 参数')
    return
  }

  // TODO: 载入配置
  res.send('OK')
}

/** do=cast 投放媒体 */
function handleCast(req: Request, res: Response): void {
  // TODO: DLNA 投放
  res.send('OK')
}

/** do=sync 同步资料 */
function handleSync(req: Request, res: Response): void {
  // TODO: 多装置同步
  res.send('OK')
}

/** /cache 路由 */
function handleCache(req: Request, res: Response): void {
  const action = (req.query.do || req.body?.do) as string
  const key = (req.query.key || req.body?.key) as string
  const rule = (req.query.rule || req.body?.rule) as string

  // Key 计算规则：cache_ + (rule 为空 ? "" : rule + "_") + key
  const cacheKey = `cache_${rule ? rule + '_' : ''}${key}`

  switch (action) {
    case 'get': {
      const value = getCache(cacheKey)
      res.send(value)
      break
    }
    case 'set': {
      const value = (req.query.value || req.body?.value) as string
      setCache(cacheKey, value || '')
      res.send('OK')
      break
    }
    case 'del': {
      deleteCache(cacheKey)
      res.send('OK')
      break
    }
    default:
      res.status(400).send(`未知缓存操作: ${action}`)
  }
}

/** /media 路由 - 播放状态 */
function handleMedia(_req: Request, res: Response): void {
  res.json(mediaState)
}

/** /file 路由 - 本地档案系统 */
function handleFile(req: Request, res: Response): void {
  // 提取路径参数
  const relativePath = req.params[0] || ''
  const fullPath = join(FILE_ROOT, relativePath)

  // 安全检查：确保路径在 FILE_ROOT 内
  if (!fullPath.startsWith(FILE_ROOT)) {
    res.status(403).send('禁止访问')
    return
  }

  if (!existsSync(fullPath)) {
    res.status(404).send('文件不存在')
    return
  }

  const stat = statSync(fullPath)

  if (stat.isDirectory()) {
    // 返回目录列表
    const files = readdirSync(fullPath).map((name) => {
      const filePath = join(fullPath, name)
      const fileStat = statSync(filePath)
      const relativeFilePath = join(relativePath, name)

      return {
        name,
        path: relativeFilePath,
        time: formatFileTime(fileStat.mtime),
        dir: fileStat.isDirectory() ? 1 : 0
      }
    })

    // 计算父目录
    const parent = relativePath === '' ? '.' : dirname(relativePath) || ''

    res.json({ parent, files })
  } else {
    // 返回文件内容，支持 Range 请求
    const range = req.headers.range

    if (range) {
      const fileSize = stat.size
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
      const chunkSize = end - start + 1

      const stream = createReadStream(fullPath, { start, end })
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'application/octet-stream'
      })
      stream.pipe(res)
    } else {
      res.sendFile(fullPath)
    }
  }
}

/** /upload 路由 - 上传档案 */
function handleUpload(req: Request, res: Response): void {
  const path = (req.query.path as string) || ''
  const file = req.file

  if (!file) {
    res.status(400).send('未提供文件')
    return
  }

  // 防止路径遍历攻击
  const targetDir = join(FILE_ROOT, path)
  if (!targetDir.startsWith(FILE_ROOT)) {
    res.status(403).send('禁止访问')
    return
  }

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true })
  }

  // 防止文件名中的路径遍历攻击
  const safeFileName = (file.originalname || 'unnamed').replace(/[/\\?%*:|"<>]/g, '_')
  const targetPath = join(targetDir, safeFileName)

  // 安全检查：确保最终路径仍在 FILE_ROOT 内
  if (!targetPath.startsWith(FILE_ROOT)) {
    res.status(403).send('禁止访问')
    return
  }

  // .zip 文件自动解压
  if (safeFileName.endsWith('.zip')) {
    // TODO: 实现 zip 解压（使用安全的解压库）
    writeFileSync(targetPath, file.buffer)
  } else {
    writeFileSync(targetPath, file.buffer)
  }

  res.send('OK')
}

/** /newFolder 路由 */
function handleNewFolder(req: Request, res: Response): void {
  const path = (req.query.path as string) || ''
  const name = (req.query.name as string) || ''

  if (!name) {
    res.status(400).send('缺少 name 参数')
    return
  }

  const fullPath = join(FILE_ROOT, path, name)
  if (!fullPath.startsWith(FILE_ROOT)) {
    res.status(403).send('禁止访问')
    return
  }

  mkdirSync(fullPath, { recursive: true })
  res.send('OK')
}

/** /delFolder 路由 */
function handleDelFolder(req: Request, res: Response): void {
  const path = (req.query.path as string) || ''
  const fullPath = join(FILE_ROOT, path)

  if (!fullPath.startsWith(FILE_ROOT)) {
    res.status(403).send('禁止访问')
    return
  }

  try {
    rmdirSync(fullPath, { recursive: true })
    res.send('OK')
  } catch (err) {
    res.status(500).send(`删除失败: ${err}`)
  }
}

/** /delFile 路由 */
function handleDelFile(req: Request, res: Response): void {
  const path = (req.query.path as string) || ''
  const fullPath = join(FILE_ROOT, path)

  if (!fullPath.startsWith(FILE_ROOT)) {
    res.status(403).send('禁止访问')
    return
  }

  try {
    unlinkSync(fullPath)
    res.send('OK')
  } catch (err) {
    res.status(500).send(`删除失败: ${err}`)
  }
}

/**
 * 简单的 HTML 转义函数来防止 XSS
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** /parse 路由 - 解析页面 */
function handleParse(req: Request, res: Response): void {
  const jxs = (req.query.jxs as string) || ''
  const url = (req.query.url as string) || ''

  if (!jxs || !url) {
    res.status(400).send('缺少 jxs 或 url 参数')
    return
  }

  // TODO: 生成解析 HTML 页面
  res.type('html').send(`<html><body>Parse: ${escapeHtml(jxs)} - ${escapeHtml(url)}</body></html>`)
}

/** /proxy 路由 - 爬虫代理 */
async function handleProxy(req: Request, res: Response): Promise<void> {
  const params: Record<string, string> = {}

  // 合并 query 和 body 参数
  for (const [key, value] of Object.entries(req.query)) {
    params[key] = String(value)
  }
  if (req.body && typeof req.body === 'object') {
    for (const [key, value] of Object.entries(req.body)) {
      params[key] = String(value)
    }
  }

  // 查找对应的 Spider
  const siteKey = params.do === 'js' ? params.key : params.do
  const spider = siteKey ? getCachedSpider(siteKey) : undefined

  if (!spider) {
    res.status(404).send(`未找到 Spider: ${siteKey}`)
    return
  }

  try {
    const result = await spider.proxy(params)
    if (result) {
      res.writeHead(result.statusCode, {
        'Content-Type': result.mimeType,
        ...(result.headers || {})
      })
      res.end(result.body)
    } else {
      res.status(404).send('代理无响应')
    }
  } catch (err) {
    res.status(500).send(`代理错误: ${err}`)
  }
}

/** /device 路由 - 装置资讯 */
function handleDevice(_req: Request, res: Response): void {
  const device: Device = {
    uuid: getDeviceUuid(),
    name: 'IPTV-Mac',
    ip: `127.0.0.1:${serverPort}`,
    type: 1, // 1=桌面
    time: Date.now()
  }
  res.type('text/plain').send(JSON.stringify(device))
}

// ==================== 辅助函数 ====================

/** 格式化文件时间 */
function formatFileTime(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  return `${y}/${m}/${d} ${h}:${min}:${s}`
}

/** 获取设备 UUID（简单实现） */
let deviceUuid: string | null = null
function getDeviceUuid(): string {
  if (deviceUuid) return deviceUuid

  // 尝试从文件读取
  const uuidPath = join(app.getPath('userData'), '.device_uuid')
  if (existsSync(uuidPath)) {
    deviceUuid = readFileSync(uuidPath, 'utf-8').trim()
  } else {
    // 生成新 UUID
    deviceUuid = randomUUID()
    writeFileSync(uuidPath, deviceUuid, 'utf-8')
  }

  return deviceUuid
}
