import { create } from 'zustand'
import type { EpgChannel, EpgProgram } from '@shared/types'
import { liveApi } from '@/utils/ipc'

export interface ChannelLine {
  url: string
  header: Record<string, string>
  latency: number
  alive: boolean
  /** 上次探测时间（epoch 秒）；0 = 从未探测。-2 延迟表示「未验证」 */
  tested_at?: number
}

export interface Channel {
  name: string
  number?: string
  logo?: string
  format?: string
  urls: string[]
  lines?: ChannelLine[]
  epgId?: string
  urlHeaders?: Record<string, Record<string, string>>
  epgUrl?: string
  bestUrl?: string
  latency?: number
}

export interface Group {
  name: string
  pass?: string
  channels: Channel[]
}

export interface EpgData {
  title: string
  start: string
  end: string
  desc?: string
}

interface LiveState {
  groups: Group[]
  channels: Channel[]
  currentGroup: string
  currentChannel: Channel | null
  epgData: EpgData[]
  isPlaying: boolean
  isLoading: boolean
  error: string | null
}

interface LiveActions {
  loadChannelTree: () => Promise<void>
  /** 真实播放结果回写并刷新树（探测可能误判，真实播放为准） */
  reportPlaybackResult: (urls: string[], alive: boolean, latencyMs?: number) => Promise<void>
  loadLive: (liveName: string) => Promise<void>
  loadLiveByUrl: (url: string, name?: string) => Promise<void>
  switchGroup: (groupName: string) => void
  switchChannel: (channel: Channel) => void
  fetchEpg: (epgUrl: string, channelId: string) => Promise<void>
  setIsPlaying: (playing: boolean) => void
  reset: () => void
}

const initialState: LiveState = {
  groups: [],
  channels: [],
  currentGroup: '',
  currentChannel: null,
  epgData: [],
  isPlaying: false,
  isLoading: false,
  error: null
}

let liveLoadRequestId = 0

function findEpgChannel(channels: EpgChannel[], channelId: string): EpgChannel | undefined {
  const target = channelId.trim().toLowerCase()
  return channels.find((channel) =>
    channel.id?.trim().toLowerCase() === target ||
    channel.name.trim().toLowerCase() === target
  )
}

function normalizePrograms(programs: EpgProgram[]): EpgData[] {
  return programs.map((program) => ({
    title: program.title,
    start: program.start,
    end: program.stop,
    desc: program.desc
  }))
}

function normalizeLines(rawLines: ChannelLine[]): ChannelLine[] {
  const lines = new Map<string, ChannelLine>()
  for (const line of rawLines) {
    if (typeof line?.url !== 'string' || !line.url.trim()) continue
    const header = Object.fromEntries(Object.entries(line.header || {}).map(([name, value]) => [name.trim().toLowerCase(), value]))
    const identity = JSON.stringify([line.url, Object.entries(header).sort(([a], [b]) => a.localeCompare(b))])
    const normalized = { ...line, header, alive: Boolean(line.alive), latency: Number.isFinite(line.latency) ? line.latency : -1 }
    const existing = lines.get(identity)
    if (!existing || (normalized.alive && !existing.alive) || (normalized.alive === existing.alive && normalized.latency >= 0 && (existing.latency < 0 || normalized.latency < existing.latency))) {
      lines.set(identity, normalized)
    }
  }
  return [...lines.values()].sort((a, b) => Number(b.alive) - Number(a.alive) || (a.latency < 0 ? Infinity : a.latency) - (b.latency < 0 ? Infinity : b.latency))
}

function channelLines(channel: Channel): ChannelLine[] {
  return channel.lines?.length ? channel.lines : channel.urls.map((url) => ({
    url, header: channel.urlHeaders?.[url] || {}, latency: channel.bestUrl === url ? channel.latency ?? -1 : -1,
    alive: channel.bestUrl === url && (channel.latency ?? -1) >= 0
  }))
}

function normalizeChannel(channel: any): Channel {
  const lines = Array.isArray(channel.lines) ? normalizeLines(channel.lines) : undefined
  const urls = [...new Set<string>([...(Array.isArray(channel.urls) ? channel.urls.filter((url: unknown) => typeof url === 'string' && url) : []), ...(lines || []).map((line) => line.url)])]
  const baseHeaders: Record<string, string> = { ...(channel.header || {}) }
  if (channel.ua) baseHeaders['User-Agent'] = channel.ua
  if (channel.referer) baseHeaders.Referer = channel.referer
  if (channel.origin) baseHeaders.Origin = channel.origin

  const urlHeaders: Record<string, Record<string, string>> = { ...(channel.urlHeaders || {}) }
  if (Object.keys(baseHeaders).length > 0) {
    for (const url of urls) {
      urlHeaders[url] = { ...baseHeaders, ...urlHeaders[url] }
    }
  }

  const epgValue = typeof channel.epg === 'string' ? channel.epg : ''
  const epgIsUrl = /^https?:\/\//i.test(epgValue)

  return {
    name: channel.name || '',
    number: channel.number,
    logo: channel.logo,
    format: channel.format,
    urls,
    lines: lines?.length ? lines : undefined,
    epgId: channel.epgId || channel.tvgId || (epgIsUrl ? '' : epgValue),
    epgUrl: channel.epgUrl || (epgIsUrl ? epgValue : undefined),
    bestUrl: channel.bestUrl,
    latency: channel.latency,
    urlHeaders: Object.keys(urlHeaders).length > 0 ? urlHeaders : undefined
  }
}

export function normalizeLiveGroups(rawGroups: any[]): Group[] {
  return rawGroups.map((group) => ({
    name: group.name,
    pass: group.pass,
    channels: (group.channel || group.channels || []).map(normalizeChannel)
  }))
}

interface ChannelTree {
  countries: Array<{ name: string; categories: Array<{ name: string; channels: any[] }> }>
}

export function normalizeChannelTree(tree: ChannelTree): Group[] {
  const groups = new Map<string, Group>()
  const channels = new Map<string, Channel>()
  for (const country of tree.countries) {
    for (const category of country.categories || []) {
      const groupName = [country.name, category.name].filter(Boolean).join(' / ') || '其他'
      for (const raw of category.channels || []) {
        const channel = normalizeChannel(raw)
        channel.name = channel.name.trim()
        if (!channel.name || channel.urls.length === 0) continue
        const key = channel.name.toLowerCase()
        const existing = channels.get(key)
        if (existing) {
          existing.lines = normalizeLines([...channelLines(existing), ...channelLines(channel)])
          existing.urls = [...new Set([...existing.urls, ...channel.urls])]
          for (const [url, headers] of Object.entries(channel.urlHeaders || {})) {
            existing.urlHeaders ||= {}
            existing.urlHeaders[url] = { ...existing.urlHeaders[url], ...headers }
          }
          if (channel.bestUrl && (!existing.bestUrl || (channel.latency ?? Infinity) < (existing.latency ?? Infinity))) {
            existing.bestUrl = channel.bestUrl
            existing.latency = channel.latency
          }
          continue
        }
        channel.urls = [...new Set(channel.urls)]
        channels.set(key, channel)
        if (!groups.has(groupName)) groups.set(groupName, { name: groupName, channels: [] })
        groups.get(groupName)!.channels.push(channel)
      }
    }
  }
  return [...groups.values()]
}

export const useLiveStore = create<LiveState & LiveActions>()((set, get) => ({
  ...initialState,

  loadChannelTree: async () => {
    const requestId = ++liveLoadRequestId
    set({ isLoading: true, error: null })
    try {
      const tree = await liveApi.getChannelTree() as ChannelTree
      if (requestId !== liveLoadRequestId) return
      if (!Array.isArray(tree?.countries)) throw new Error('频道缓存格式错误')
      const groups = normalizeChannelTree(tree)
      const currentGroup = groups.find((group) => group.name === get().currentGroup) || groups[0]
      // 播放会话保留原频道对象，缓存更新仅替换可浏览的列表。
      set({ groups, channels: currentGroup?.channels || [], currentGroup: currentGroup?.name || '', isLoading: false })
    } catch (error) {
      if (requestId !== liveLoadRequestId) return
      set({ isLoading: false, error: error instanceof Error ? error.message : String(error || '读取频道缓存失败') })
    }
  },

  reportPlaybackResult: async (urls, alive, latencyMs) => {
    if (urls.length === 0) return
    try {
      await liveApi.reportLineResult(urls, alive, latencyMs)
      // 回写后刷新树，让「无信号」立刻被纠正（不重新探测，纯读缓存）
      await get().loadChannelTree()
    } catch (error) {
      console.warn('[Live] 播放结果回写失败:', error)
    }
  },

  loadLive: async (liveName: string) => {
    const requestId = ++liveLoadRequestId
    set({ isLoading: true, error: null })
    try {
      console.log('[LiveStore] loadLive 请求:', liveName)
      const res = await liveApi.load(liveName) as { success: boolean; data?: any[]; error?: string }
      if (requestId !== liveLoadRequestId) return
      console.log('[LiveStore] loadLive 响应:', res.success, 'data length:', res.data?.length, 'error:', res.error)
      if (!res.success || !res.data || res.data.length === 0) {
        set({ isLoading: false, error: res.error || '直播源无可用频道' })
        return
      }

      // 主进程返回 Group[]，其中 channel 是单数形式，需要映射为 channels
      const groups = normalizeLiveGroups(res.data)

      console.log('[LiveStore] 解析后 groups:', groups.length, '总频道:', groups.reduce((s, g) => s + g.channels.length, 0))

      const firstGroup = groups.length > 0 ? groups[0].name : ''
      const firstChannels = groups.length > 0 ? groups[0].channels : []
      set({
        groups,
        channels: firstChannels,
        currentGroup: firstGroup,
        currentChannel: firstChannels.length > 0 ? firstChannels[0] : null,
        isLoading: false
      })
    } catch (e: any) {
      if (requestId !== liveLoadRequestId) return
      console.error('[LiveStore] loadLive 异常:', e)
      set({ isLoading: false, error: e.message || '加载直播源失败' })
    }
  },

  loadLiveByUrl: async (url: string, name?: string) => {
    const requestId = ++liveLoadRequestId
    set({ isLoading: true, error: null })
    try {
      console.log('[LiveStore] loadLiveByUrl 请求:', name || url, 'url:', url)
      const res = await liveApi.loadByUrl(url, name) as { success: boolean; data?: any[]; error?: string }
      if (requestId !== liveLoadRequestId) return
      console.log('[LiveStore] loadLiveByUrl 响应:', res.success, 'data length:', res.data?.length, 'error:', res.error)
      if (!res.success || !res.data || res.data.length === 0) {
        set({ isLoading: false, error: res.error || '直播源无可用频道' })
        return
      }

      const groups = normalizeLiveGroups(res.data)

      console.log('[LiveStore] 解析后 groups:', groups.length, '总频道:', groups.reduce((s, g) => s + g.channels.length, 0))

      const firstGroup = groups.length > 0 ? groups[0].name : ''
      const firstChannels = groups.length > 0 ? groups[0].channels : []
      set({
        groups,
        channels: firstChannels,
        currentGroup: firstGroup,
        currentChannel: firstChannels.length > 0 ? firstChannels[0] : null,
        isLoading: false
      })
    } catch (e: any) {
      if (requestId !== liveLoadRequestId) return
      console.error('[LiveStore] loadLiveByUrl 异常:', e)
      set({ isLoading: false, error: e.message || '加载直播源失败' })
    }
  },

  switchGroup: (groupName: string) => {
    const { groups } = get()
    const group = groups.find((g) => g.name === groupName)
    if (group) {
      set({
        currentGroup: groupName,
        channels: group.channels
      })
    }
  },

  switchChannel: (channel: Channel) => {
    set({ currentChannel: channel, isPlaying: true, epgData: [] })
  },

  fetchEpg: async (epgUrl: string, channelId: string) => {
    if (!epgUrl || !channelId) {
      set({ epgData: [] })
      return
    }
    try {
      const res = await liveApi.epg(epgUrl, {
        [channelId]: { id: channelId, name: channelId }
      }) as { success: boolean; data?: EpgChannel[]; error?: string }
      if (!res.success || !res.data) {
        set({ epgData: [] })
        return
      }
      const channel = findEpgChannel(res.data, channelId)
      set({ epgData: channel ? normalizePrograms(channel.programs) : [] })
    } catch {
      set({ epgData: [] })
    }
  },

  setIsPlaying: (playing: boolean) => set({ isPlaying: playing }),

  reset: () => {
    liveLoadRequestId += 1
    set(initialState)
  }
}))
