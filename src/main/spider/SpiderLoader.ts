/**
 * Spider 加载器
 * 根据 Site.type 加载对应的 Spider 实现
 * type 0/1/4: HttpSpider
 * type 3 + .js: JsSpider (QuickJS 占位)
 * type 3 + csp_xxx: JarSpider (占位)
 */
import type { Site } from '../../shared/types'
import { SpiderBase } from './SpiderBase'
import { HttpSpider } from './HttpSpider'

/** Spider 实例缓存 */
const spiderCache = new Map<string, SpiderBase>()

/**
 * 根据 Site 配置加载 Spider 实例
 */
export async function loadSpider(site: Site): Promise<SpiderBase> {
  // 检查缓存
  const cacheKey = `${site.key}:${site.type}:${site.api}`
  const cached = spiderCache.get(cacheKey)
  if (cached) return cached

  let spider: SpiderBase

  switch (site.type) {
    case 0:
    case 1:
    case 4:
      // HTTP API 类型
      spider = new HttpSpider(site)
      break

    case 3:
      if (site.api.endsWith('.js')) {
        // JavaScript Spider（QuickJS）
        spider = createJsSpider(site)
      } else if (site.api.endsWith('.py')) {
        // Python Spider（暂不支持）
        spider = createUnsupportedSpider(site, 'Python')
      } else {
        // JAR Spider（暂不支持）
        spider = createUnsupportedSpider(site, 'JAR')
      }
      break

    default:
      spider = createUnsupportedSpider(site, `type=${site.type}`)
  }

  // 注入 siteKey
  spider.siteKey = site.key

  // 初始化
  try {
    spider.init(site.ext || '')
  } catch (err) {
    console.error(`Spider 初始化失败 [${site.key}]:`, err)
  }

  // 缓存
  spiderCache.set(cacheKey, spider)
  return spider
}

/**
 * 获取已缓存的 Spider 实例
 */
export function getCachedSpider(siteKey: string): SpiderBase | undefined {
  for (const spider of spiderCache.values()) {
    if (spider.siteKey === siteKey) return spider
  }
  return undefined
}

/**
 * 销毁并清除所有缓存的 Spider 实例
 */
export function destroyAllSpiders(): void {
  for (const spider of spiderCache.values()) {
    try {
      spider.destroy()
    } catch {
      // 忽略销毁错误
    }
  }
  spiderCache.clear()
}

/**
 * 创建 JS Spider（QuickJS 占位实现）
 * TODO: 集成 quickjs-emscripten 运行 JS 脚本
 */
function createJsSpider(site: Site): SpiderBase {
  console.warn(`JS Spider 暂未实现 [${site.key}]: ${site.api}`)
  // 返回一个空实现的 SpiderBase
  return new SpiderBase()
}

/**
 * 创建不支持的 Spider 占位
 */
function createUnsupportedSpider(site: Site, type: string): SpiderBase {
  console.warn(`不支持的 Spider 类型 [${site.key}]: ${type}`)
  return new SpiderBase()
}
