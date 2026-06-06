/**
 * 配置管理器
 * 管理多个 VodConfig，存储配置列表，处理配置切换
 */
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import type { VodConfig, ConfigItem, LiveSource } from '../../shared/types'
import { loadVodConfig, parseVodConfig } from './VodConfig'
import { extractLivesFromVodConfig } from './LiveConfig'

/** 默认配置源列表（经连通性检测可用的源） */
const DEFAULT_CONFIGS: { url: string; name: string }[] = [
  { url: 'https://qist.wyfc.qzz.io/fty.json', name: '饭太硬' },
  { url: 'https://qist.wyfc.qzz.io/xiaosa/api.json', name: '潇洒' },
  { url: 'https://qist.wyfc.qzz.io/jsm.json', name: 'QIST' },
  { url: 'https://raw.githubusercontent.com/qist/tvbox/master/jsm.json', name: 'GitHub QIST' },
  { url: 'http://47.96.82.41:5188/api.json', name: '47.96 API' },
  { url: 'http://124.223.214.31:8/api.json', name: '124.223 API' },
  { url: 'https://9280.kstore.vip/newwex.json', name: 'KStore VIP' },
  { url: 'https://9280.kstore.space/newwex.json', name: 'KStore SPACE' },
  { url: 'http://fmys.top/fmys.json', name: '肥猫影视' },
  { url: 'http://home.jundie.top:81/top98.json', name: '俊哥TOP98' },
  { url: 'https://tv.203511.xyz/0821.json', name: '荐片网' }
]

interface ConfigStoreData {
  configs: ConfigItem[]
  currentUrl: string
}

/** 延迟初始化的存储路径 */
let storePath: string = ''

function getStorePath(): string {
  if (!storePath) {
    let userDataDir = app.getPath('userData')
    // 如果 userData 目录不可写，回退到项目目录
    try {
      if (!existsSync(userDataDir)) {
        mkdirSync(userDataDir, { recursive: true })
      }
      // 测试写入权限
      const testFile = join(userDataDir, '.write-test')
      writeFileSync(testFile, 'test')
      unlinkSync(testFile)
    } catch {
      // 回退到项目目录下的 data 文件夹
      userDataDir = join(process.cwd(), 'data')
      if (!existsSync(userDataDir)) {
        mkdirSync(userDataDir, { recursive: true })
      }
    }
    storePath = join(userDataDir, 'config-store.json')
  }
  return storePath
}

function readStore(): ConfigStoreData {
  try {
    const path = getStorePath()
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'))
    }
  } catch {
    // ignore
  }
  return { configs: [], currentUrl: '' }
}

function writeStore(data: ConfigStoreData): void {
  writeFileSync(getStorePath(), JSON.stringify(data, null, 2), 'utf-8')
}

/** 当前生效的 VodConfig */
let currentConfig: VodConfig | null = null

/** 当前配置的 URL */
let currentUrl: string = ''

/**
 * 获取配置列表
 */
export function getConfigList(): ConfigItem[] {
  return readStore().configs
}

/**
 * 添加配置
 */
export function addConfig(url: string, name?: string): void {
  const data = readStore()
  const existing = data.configs.find((c) => c.url === url)
  if (existing) {
    existing.updateTime = Date.now()
    if (name) existing.name = name
  } else {
    data.configs.push({
      url,
      name: name || url,
      addTime: Date.now(),
      updateTime: Date.now()
    })
  }
  writeStore(data)
}

/**
 * 删除配置
 */
export function removeConfig(url: string): void {
  const data = readStore()
  data.configs = data.configs.filter((c) => c.url !== url)
  if (currentUrl === url) {
    currentConfig = null
    currentUrl = ''
    data.currentUrl = ''
  }
  writeStore(data)
}

/**
 * 获取当前配置
 */
export function getCurrentConfig(): VodConfig | null {
  return currentConfig
}

/**
 * 获取当前配置 URL
 */
export function getCurrentUrl(): string {
  return currentUrl
}

/**
 * 加载指定 URL 的配置并设为当前配置
 */
export async function switchConfig(url: string): Promise<VodConfig> {
  const config = await loadVodConfig(url)
  currentConfig = config
  currentUrl = url

  const data = readStore()
  data.currentUrl = url
  const item = data.configs.find((c) => c.url === url)
  if (item) {
    item.updateTime = Date.now()
  }
  writeStore(data)

  return config
}

/**
 * 从字符串加载配置并设为当前配置
 */
export function loadConfigFromString(json: string, name?: string): VodConfig {
  const config = parseVodConfig(json)
  currentConfig = config
  currentUrl = ''
  return config
}

/**
 * 获取当前配置的直播源列表
 */
export function getCurrentLives(): LiveSource[] {
  if (!currentConfig?.lives) return []
  return extractLivesFromVodConfig(currentConfig.lives, currentUrl || undefined)
}

/**
 * 获取当前配置中指定 key 的站点
 */
export function getSiteByKey(key: string): VodConfig['sites'][number] | undefined {
  return currentConfig?.sites.find((s) => s.key === key)
}

/**
 * 重新加载当前配置
 */
export async function reloadCurrentConfig(): Promise<VodConfig | null> {
  if (!currentUrl) return null
  return switchConfig(currentUrl)
}

/**
 * 清除当前配置
 */
export function clearCurrentConfig(): void {
  currentConfig = null
  currentUrl = ''
  const data = readStore()
  data.currentUrl = ''
  writeStore(data)
}

/**
 * 确保默认配置存在
 * 如果没有任何配置，自动添加预设源列表
 */
export function ensureDefaultConfig(): string {
  const data = readStore()
  // 如果已有配置，返回当前 URL
  if (data.configs.length > 0) {
    return data.currentUrl || data.configs[0].url
  }
  // 没有配置，添加所有预设源
  for (const preset of DEFAULT_CONFIGS) {
    data.configs.push({
      url: preset.url,
      name: preset.name,
      addTime: Date.now(),
      updateTime: Date.now()
    })
  }
  data.currentUrl = DEFAULT_CONFIGS[0].url
  writeStore(data)
  return DEFAULT_CONFIGS[0].url
}
