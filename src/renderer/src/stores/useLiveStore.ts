import { create } from 'zustand'
import type { EpgChannel, EpgProgram } from '@shared/types'
import { invoke } from '@/utils/ipc'

export interface Channel {
  name: string
  number?: string
  logo?: string
  format?: string
  urls: string[]
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
  loadLive: (liveName: string) => Promise<void>
  loadLiveByUrl: (url: string, name?: string) => Promise<void>
  switchGroup: (groupName: string) => void
  switchChannel: (channel: Channel) => void
  fetchEpg: (epgUrl: string, channelId: string) => Promise<void>
  setIsPlaying: (playing: boolean) => void
  reset: () => void
}

interface RefreshState {
  isRefreshing: boolean
  refreshProgress: {
    phase: string
    current: number
    total: number
    message: string
  } | null
  lastRefreshTime: number
  nextRefreshTime: number
  refreshInterval: number
}

interface RefreshActions {
  triggerRefresh: () => Promise<void>
  setRefreshInterval: (minutes: number) => Promise<void>
  getRefreshStatus: () => Promise<void>
  getChannelTree: () => Promise<any>
  applyRefreshProgress: (progress: NonNullable<RefreshState['refreshProgress']>) => void
}

const initialState: LiveState & RefreshState = {
  groups: [],
  channels: [],
  currentGroup: '',
  currentChannel: null,
  epgData: [],
  isPlaying: false,
  isLoading: false,
  error: null,
  // 刷新相关状态
  isRefreshing: false,
  refreshProgress: null,
  lastRefreshTime: 0,
  nextRefreshTime: 0,
  refreshInterval: 30
}

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

function normalizeChannel(channel: any): Channel {
  const urls = Array.isArray(channel.urls) ? channel.urls.filter(Boolean) : []
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

export const useLiveStore = create<LiveState & LiveActions & RefreshState & RefreshActions>()((set, get) => ({
  ...initialState,

  loadLive: async (liveName: string) => {
    set({ isLoading: true, error: null })
    try {
      console.log('[LiveStore] loadLive 请求:', liveName)
      const res = await invoke('live:load', liveName) as { success: boolean; data?: any[]; error?: string }
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
      console.error('[LiveStore] loadLive 异常:', e)
      set({ isLoading: false, error: e.message || '加载直播源失败' })
    }
  },

  loadLiveByUrl: async (url: string, name?: string) => {
    set({ isLoading: true, error: null })
    try {
      console.log('[LiveStore] loadLiveByUrl 请求:', name || url, 'url:', url)
      const res = await invoke('live:loadByUrl', url, name) as { success: boolean; data?: any[]; error?: string }
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
        channels: group.channels,
        currentChannel: group.channels.length > 0 ? group.channels[0] : null,
        epgData: []
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
      const res = await invoke('live:epg', epgUrl, {
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

  reset: () => set(initialState),

  triggerRefresh: async () => {
    set({ isRefreshing: true, refreshProgress: {
      phase: 'loading',
      current: 0,
      total: 0,
      message: '正在刷新...'
    }})
    try {
      // 后台执行刷新，进度通过 IPC 事件通知
      invoke('live:refresh')
    } catch (e: any) {
      set({ isRefreshing: false, refreshProgress: null })
    }
  },

  setRefreshInterval: async (minutes: number) => {
    try {
      const res = await invoke('live:setRefreshInterval', minutes) as { success: boolean; error?: string }
      if (res.success) {
        set({ refreshInterval: minutes })
        await get().getRefreshStatus()
      } else {
        set({ refreshProgress: null })
      }
    } catch (e: any) {
      set({ refreshProgress: null })
    }
  },

  getRefreshStatus: async () => {
    try {
      const status = await invoke('live:getRefreshStatus') as any
      set({
        isRefreshing: status.isRefreshing,
        lastRefreshTime: status.lastRefreshTime,
        nextRefreshTime: status.nextRefreshTime,
        refreshInterval: status.interval
      })
    } catch (e: any) {
      console.error('[LiveStore] 获取刷新状态失败:', e)
    }
  },

  getChannelTree: async () => {
    try {
      const tree = await invoke('live:getChannelTree') as any
      return tree
    } catch (e: any) {
      console.error('[LiveStore] 获取频道树失败:', e)
      return { countries: [] }
    }
  },

  applyRefreshProgress: (progress) => {
    set({
      refreshProgress: progress,
      isRefreshing: progress.phase !== 'done' && progress.phase !== 'error'
    })
  }
}))
