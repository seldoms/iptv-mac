import { create } from 'zustand'

export interface Channel {
  name: string
  number?: string
  logo?: string
  format?: string
  urls: string[]
  epgId?: string
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

export const useLiveStore = create<LiveState & LiveActions & RefreshState & RefreshActions>()((set, get) => ({
  ...initialState,

  loadLive: async (liveName: string) => {
    set({ isLoading: true, error: null })
    try {
      console.log('[LiveStore] loadLive 请求:', liveName)
      const res = await window.api.invoke('live:load', liveName) as { success: boolean; data?: any[]; error?: string }
      console.log('[LiveStore] loadLive 响应:', res.success, 'data length:', res.data?.length, 'error:', res.error)
      if (!res.success || !res.data || res.data.length === 0) {
        set({ isLoading: false, error: res.error || '直播源无可用频道' })
        return
      }

      // 主进程返回 Group[]，其中 channel 是单数形式，需要映射为 channels
      const rawGroups: { name: string; pass?: string; channel?: any[] }[] = res.data
      const groups: Group[] = rawGroups.map((g) => ({
        name: g.name,
        pass: g.pass,
        channels: (g.channel || []).map((c: any) => ({
          name: c.name || '',
          number: c.number,
          logo: c.logo,
          format: c.format,
          urls: c.urls || [],
          epgId: c.epg || c.tvgId || ''
        }))
      }))

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
      const res = await window.api.invoke('live:loadByUrl', url, name) as { success: boolean; data?: any[]; error?: string }
      console.log('[LiveStore] loadLiveByUrl 响应:', res.success, 'data length:', res.data?.length, 'error:', res.error)
      if (!res.success || !res.data || res.data.length === 0) {
        set({ isLoading: false, error: res.error || '直播源无可用频道' })
        return
      }

      const rawGroups: { name: string; pass?: string; channel?: any[] }[] = res.data
      const groups: Group[] = rawGroups.map((g) => ({
        name: g.name,
        pass: g.pass,
        channels: (g.channel || []).map((c: any) => ({
          name: c.name || '',
          number: c.number,
          logo: c.logo,
          format: c.format,
          urls: c.urls || [],
          epgId: c.epg || c.tvgId || ''
        }))
      }))

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
    try {
      const data = await window.api.invoke('live:epg', epgUrl, channelId) as EpgData[]
      set({ epgData: data })
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
      await window.api.invoke('live:refresh')
      // 刷新完成后获取最新状态
      await get().getRefreshStatus()
      await get().getChannelTree()
    } catch (e: any) {
      set({ isRefreshing: false, refreshProgress: null })
    }
  },

  setRefreshInterval: async (minutes: number) => {
    try {
      const res = await window.api.invoke('live:setRefreshInterval', minutes) as { success: boolean; error?: string }
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
      const status = await window.api.invoke('live:getRefreshStatus') as any
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
      const tree = await window.api.invoke('live:getChannelTree') as any
      return tree
    } catch (e: any) {
      console.error('[LiveStore] 获取频道树失败:', e)
      return { countries: [] }
    }
  }
}))
