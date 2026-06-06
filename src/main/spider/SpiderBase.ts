/**
 * Spider 抽象基类
 * 定义与 Android Spider API 兼容的接口
 * 所有 Spider 实现（HttpSpider、JsSpider 等）均继承此基类
 * 注意：不使用 abstract 修饰符，以允许直接实例化作为占位实现
 */
import type { Result, PlayerResult } from '../../shared/types'

/**
 * Spider 接口定义
 * 匹配 Android 版 Spider API 规范
 */
export interface ISpider {
  /** 来源 key，由加载器注入 */
  siteKey: string

  /** 初始化 Spider */
  init(ext: string): void

  /** 首页分类及筛选器 */
  homeContent(filter: boolean): Promise<Result>

  /** 首页推荐影片 */
  homeVideoContent(): Promise<Result>

  /** 分类列表 */
  categoryContent(
    tid: string,
    pg: string,
    filter: boolean,
    extend: Record<string, string>
  ): Promise<Result>

  /** 影片详情 */
  detailContent(ids: string[]): Promise<Result>

  /** 搜索 */
  searchContent(key: string, quick: boolean, pg?: string): Promise<Result>

  /** 播放解析 */
  playerContent(flag: string, id: string, vipFlags: string[]): Promise<PlayerResult>

  /** 直播频道列表（返回原始文本） */
  liveContent(url: string): Promise<string>

  /** 本地代理 */
  proxy(params: Record<string, string>): Promise<ProxyResult | null>

  /** 销毁，释放资源 */
  destroy(): void
}

/** 代理回传结果 */
export interface ProxyResult {
  statusCode: number
  mimeType: string
  body: Buffer | string
  headers?: Record<string, string>
}

/**
 * Spider 基类
 * 所有方法提供默认空实现，子类只需覆写所需方法
 */
export class SpiderBase implements ISpider {
  siteKey: string = ''

  init(_ext: string): void {
    // 默认空实现
  }

  async homeContent(_filter: boolean): Promise<Result> {
    return {}
  }

  async homeVideoContent(): Promise<Result> {
    return {}
  }

  async categoryContent(
    _tid: string,
    _pg: string,
    _filter: boolean,
    _extend: Record<string, string>
  ): Promise<Result> {
    return {}
  }

  async detailContent(_ids: string[]): Promise<Result> {
    return {}
  }

  async searchContent(_key: string, _quick: boolean, _pg?: string): Promise<Result> {
    return {}
  }

  async playerContent(
    _flag: string,
    _id: string,
    _vipFlags: string[]
  ): Promise<PlayerResult> {
    return { url: '' }
  }

  async liveContent(_url: string): Promise<string> {
    return ''
  }

  async proxy(_params: Record<string, string>): Promise<ProxyResult | null> {
    return null
  }

  destroy(): void {
    // 默认空实现
  }
}
