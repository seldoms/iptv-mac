/**
 * HTTP API Spider
 * 实现 type 0/1/4 的 HTTP API 调用
 * type 0: XML 格式 API
 * type 1: JSON 格式 API，支持 Filter 筛选
 * type 4: 同 type 1，ext 参数以 Base64 编码传递
 */
import { SpiderBase } from './SpiderBase'
import type { Site, Result, PlayerResult, Vod, VodClass, Filter } from '../../shared/types'
import { request } from '../network/NetworkStack'
import { isVideoFormat } from '../parse/SuperParse'

export class HttpSpider extends SpiderBase {
  private site: Site
  private apiUrl: string
  private siteType: number

  constructor(site: Site) {
    super()
    this.site = site
    this.apiUrl = site.api
    this.siteType = site.type
  }

  override async homeContent(filter: boolean): Promise<Result> {
    if (this.siteType === 0) {
      return this.homeContentXml(filter)
    }
    return this.homeContentJson(filter)
  }

  override async homeVideoContent(): Promise<Result> {
    // type 0 使用 XML，type 1/4 使用 JSON
    if (this.siteType === 0) {
      const url = this.buildUrl({ ac: 'videolist' })
      const data = await this.fetchXml(url)
      return { list: this.parseXmlVodList(data) }
    }

    const url = this.buildUrl({ ac: 'detail' })
    const data = await this.fetchJson(url)
    return { list: this.parseJsonVodList(data) }
  }

  override async categoryContent(
    tid: string,
    pg: string,
    filter: boolean,
    extend: Record<string, string>
  ): Promise<Result> {
    if (this.siteType === 0) {
      const params: Record<string, string> = {
        ac: 'videolist',
        t: tid,
        pg
      }
      const url = this.buildUrl(params)
      const data = await this.fetchXml(url)
      return { list: this.parseXmlVodList(data) }
    }

    const params: Record<string, string> = {
      ac: 'detail',
      t: tid,
      pg
    }

    // type 4: ext 以 Base64 编码
    if (this.siteType === 4 && this.site.ext) {
      try {
        params.ext = Buffer.from(this.site.ext).toString('base64')
      } catch {
        // ext 编码失败则忽略
      }
    }

    // 添加筛选参数
    if (filter && Object.keys(extend).length > 0) {
      params.f = JSON.stringify(extend)
    }

    const url = this.buildUrl(params)
    const data = await this.fetchJson(url)
    const result: Result = { list: this.parseJsonVodList(data) }

    // 解析分页信息
    if (data.pagecount) {
      result.pagecount = Number(data.pagecount)
    }

    return result
  }

  override async detailContent(ids: string[]): Promise<Result> {
    if (this.siteType === 0) {
      const url = this.buildUrl({ ac: 'videolist', ids: ids.join(',') })
      const data = await this.fetchXml(url)
      return { list: this.parseXmlVodList(data) }
    }

    const url = this.buildUrl({ ac: 'detail', ids: ids.join(',') })
    const data = await this.fetchJson(url)
    return { list: this.parseJsonVodList(data) }
  }

  override async searchContent(
    key: string,
    _quick: boolean,
    pg?: string
  ): Promise<Result> {
    if (this.siteType === 0) {
      const params: Record<string, string> = {
        ac: 'videolist',
        wd: key
      }
      if (pg) params.pg = pg
      const url = this.buildUrl(params)
      const data = await this.fetchXml(url)
      return { list: this.parseXmlVodList(data) }
    }

    const params: Record<string, string> = {
      ac: 'detail',
      wd: key
    }
    if (pg) params.pg = pg
    const url = this.buildUrl(params)
    const data = await this.fetchJson(url)
    return { list: this.parseJsonVodList(data) }
  }

  override async playerContent(
    flag: string,
    id: string,
    _vipFlags: string[]
  ): Promise<PlayerResult> {
    // 参考 Android SiteApi.playerContent 的判断逻辑
    // 对于 type=0/1 的 HTTP 采集站（非 Spider 插件）：
    // - URL 是视频格式（.m3u8/.mp4等）且没有 playUrl → parse=0 直接播放
    // - 否则 → parse=1 需要解析

    const isDirectVideo = isVideoFormat(id)
    const hasPlayUrl = !!(this.site.playUrl)

    const result: PlayerResult = {
      url: id,
      parse: (isDirectVideo && !hasPlayUrl) ? 0 : 1,
      playUrl: this.site.playUrl || undefined,
      click: this.site.click || undefined
    }

    // 附加站点配置的 header
    if (this.site.header) {
      result.header = this.site.header
    }

    return result
  }

  // ==================== 私有方法 ====================

  /** 构建 API URL，自动处理已有的查询参数 */
  private buildUrl(params: Record<string, string>): string {
    // 分离 baseURL 和已有查询参数
    let baseUrl = this.apiUrl
    const existingParams: Record<string, string> = {}

    const qIdx = baseUrl.indexOf('?')
    if (qIdx >= 0) {
      const qs = baseUrl.substring(qIdx + 1)
      baseUrl = baseUrl.substring(0, qIdx)
      // 解析已有参数
      for (const pair of qs.split('&')) {
        const eqIdx = pair.indexOf('=')
        if (eqIdx > 0) {
          existingParams[decodeURIComponent(pair.substring(0, eqIdx))] = decodeURIComponent(pair.substring(eqIdx + 1))
        }
      }
    }

    // 新参数覆盖已有参数（特别是 ac 参数）
    const mergedParams = { ...existingParams, ...params }

    const qs = Object.entries(mergedParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
    return `${baseUrl}?${qs}`
  }

  /** 获取 JSON API 的首页内容 */
  private async homeContentJson(filter: boolean): Promise<Result> {
    const url = this.buildUrl({ ac: 'detail' })
    const data = await this.fetchJson(url)

    let classes: VodClass[] = ((data.class as Record<string, unknown>[]) || []).map(
      (c) => ({
        type_id: String(c.type_id ?? c.id ?? ''),
        type_name: String(c.type_name ?? c.name ?? '')
      })
    )

    const list = this.parseJsonVodList(data)

    // 如果 API 没有返回 class 字段，从视频列表中提取分类
    if (classes.length === 0 && list.length > 0) {
      const categoryMap = new Map<string, string>()
      for (const vod of list) {
        if (vod.type_name && vod.vod_id) {
          // 从原始数据中获取 type_id
          const rawItem = (data.list as Record<string, unknown>[])?.find(
            (item) => String(item.vod_id) === vod.vod_id
          )
          const typeId = rawItem ? String(rawItem.type_id ?? '') : ''
          if (typeId && !categoryMap.has(typeId)) {
            categoryMap.set(typeId, vod.type_name)
          }
        }
      }
      classes = Array.from(categoryMap.entries()).map(([type_id, type_name]) => ({
        type_id,
        type_name
      }))
    }

    const result: Result = { class: classes, list }

    // 解析筛选器
    if (filter && data.filters) {
      const filters: Record<string, Filter[]> = {}
      for (const [typeId, filterList] of Object.entries(
        data.filters as Record<string, Record<string, unknown>[]>
      )) {
        filters[typeId] = filterList.map((f) => ({
          key: String(f.key ?? ''),
          name: String(f.name ?? ''),
          init: f.init ? String(f.init) : undefined,
          value: (f.value as { n: string; v: string }[]) || []
        }))
      }
      result.filters = filters
    }

    return result
  }

  /** 获取 XML API 的首页内容 */
  private async homeContentXml(filter: boolean): Promise<Result> {
    const url = this.buildUrl({ ac: 'videolist' })
    const data = await this.fetchXml(url)

    const classes: VodClass[] = ((data.class as Record<string, unknown>[]) || []).map(
      (c) => ({
        type_id: String(c.type_id ?? c.id ?? ''),
        type_name: String(c.type_name ?? c.name ?? '')
      })
    )

    const result: Result = { class: classes, list: this.parseXmlVodList(data) }

    // XML 格式通常不含筛选器
    if (filter) {
      result.filters = {}
    }

    return result
  }

  /** 发起 JSON API 请求 */
  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0',
      ...this.site.header
    }

    try {
      const response = await request({
        url,
        method: 'GET',
        headers,
        timeout: (this.site.timeout || 15) * 1000
      })
      return JSON.parse(response.data)
    } catch (err) {
      console.error(`JSON API 请求失败 [${this.siteKey}]:`, url, err)
      return {}
    }
  }

  /** 发起 XML API 请求并解析为对象 */
  private async fetchXml(url: string): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0',
      ...this.site.header
    }

    try {
      const response = await request({
        url,
        method: 'GET',
        headers,
        timeout: (this.site.timeout || 15) * 1000
      })
      // 使用 xml2js 解析 XML
      const { parseStringPromise } = await import('xml2js')
      const result = await parseStringPromise(response.data, {
        explicitArray: false,
        ignoreAttrs: false
      })
      return result.rss || result
    } catch (err) {
      console.error(`XML API 请求失败 [${this.siteKey}]:`, url, err)
      return {}
    }
  }

  /** 解析 JSON 格式的影片列表 */
  private parseJsonVodList(data: Record<string, unknown>): Vod[] {
    const list = data.list
    if (!Array.isArray(list)) return []

    return (list as Record<string, unknown>[]).map((item) => this.parseVodItem(item))
  }

  /** 解析 XML 格式的影片列表 */
  private parseXmlVodList(data: Record<string, unknown>): Vod[] {
    const list = data.list as Record<string, unknown> | undefined
    if (!list) return []

    // XML 解析后 list 可能是对象或数组
    const video = (list as Record<string, unknown>).video
    const items: Record<string, unknown>[] = Array.isArray(video)
      ? video
      : video
        ? [video as Record<string, unknown>]
        : []
    return items.map((item) => this.parseVodItem(item))
  }

  /** 解析单个影片项 */
  private parseVodItem(item: Record<string, unknown>): Vod {
    return {
      vod_id: String(item.vod_id ?? ''),
      vod_name: String(item.vod_name ?? ''),
      vod_pic: item.vod_pic ? String(item.vod_pic) : undefined,
      vod_remarks: item.vod_remarks ? String(item.vod_remarks) : undefined,
      type_name: item.type_name ? String(item.type_name) : undefined,
      vod_year: item.vod_year ? String(item.vod_year) : undefined,
      vod_area: item.vod_area ? String(item.vod_area) : undefined,
      vod_director: item.vod_director ? String(item.vod_director) : undefined,
      vod_actor: item.vod_actor ? String(item.vod_actor) : undefined,
      vod_content: item.vod_content ? String(item.vod_content) : undefined,
      vod_play_from: item.vod_play_from ? String(item.vod_play_from) : undefined,
      vod_play_url: item.vod_play_url ? String(item.vod_play_url) : undefined,
      vod_tag: item.vod_tag ? String(item.vod_tag) : undefined
    }
  }
}
