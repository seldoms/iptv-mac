import { create } from 'zustand'

export interface VodDetail {
  vod_id: string
  vod_name: string
  vod_pic: string
  vod_remarks?: string
  type_name?: string
  vod_year?: string
  vod_area?: string
  vod_director?: string
  vod_actor?: string
  vod_content?: string
  vod_play_from?: string
  vod_play_url?: string
}

export interface Episode {
  name: string
  url: string
}

/** 跨站点的备选源（换源用） */
export interface AlternativeSource {
  siteKey: string
  siteName: string
  vodId: string
  vodName: string
  vodPic?: string
  vodRemarks?: string
}

export type PlaybackPhase =
  | 'idle'
  | 'resolving'
  | 'connecting'
  | 'buffering'
  | 'playing'
  | 'recovering'
  | 'failed'

export interface PlaybackDiagnostic {
  stage: 'parse' | 'connect' | 'manifest' | 'buffer' | 'media' | 'network' | 'unknown'
  errorKind: 'parse_failed' | 'timeout' | 'http' | 'hls' | 'media' | 'unsupported' | 'unknown'
  protocol?: 'hls' | 'dash' | 'native' | 'unknown'
  httpStatus?: number
  elapsedMs?: number
  sourceId?: string
  attempt?: number
  sourceCount?: number
  nextAction?: string
}

interface PlayerState {
  isPlaying: boolean
  currentUrl: string
  playKey: number
  currentTime: number
  duration: number
  speed: number
  volume: number
  isDanmakuOn: boolean
  isFullscreen: boolean
  currentVod: VodDetail | null
  episodes: Episode[]
  currentEpisodeIndex: number
  currentSourceIndex: number
  currentSourceName: string
  playHeader: Record<string, string> | null
  currentSiteKey: string
  playbackPhase: PlaybackPhase
  playbackMessage: string
  playbackError: string
  playbackStartedAt: number
  playbackFirstFrameAt: number
  playbackLastErrorAt: number
  playbackDiagnostic: PlaybackDiagnostic | null

  // ==================== 换源相关状态 ====================
  /** 备选源队列（来自其他站点的同名 VOD） */
  alternativeSources: AlternativeSource[]
  /** 已失败的源 key 数组（siteKey + vodId） */
  brokenSources: string[]
  /** 换源状态：idle / searching / switching */
  sourceSwitchState: 'idle' | 'searching' | 'switching'
  /** 换源提示信息（给用户看） */
  sourceSwitchMessage: string
  /** 是否启用自动换源 */
  autoSwitchSource: boolean
}

interface PlayerActions {
  play: (url?: string) => void
  pause: () => void
  stop: () => void
  setSpeed: (speed: number) => void
  setVolume: (volume: number) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setIsPlaying: (playing: boolean) => void
  toggleDanmaku: () => void
  toggleFullscreen: () => void
  nextEpisode: () => void
  prevEpisode: () => void
  setVod: (
    vod: VodDetail,
    episodes: Episode[],
    sourceIndex?: number,
    resolvedUrl?: string,
    header?: Record<string, string>,
    siteKey?: string,
    sourceName?: string,
    startPositionSeconds?: number
  ) => void
  setCurrentEpisodeIndex: (index: number, resolvedUrl?: string, startPositionSeconds?: number) => void
  setCurrentSourceIndex: (index: number) => void
  setPlaybackPhase: (phase: PlaybackPhase, message?: string) => void
  setPlaybackError: (message: string, diagnostic?: Partial<PlaybackDiagnostic>) => void
  markPlaybackFirstFrame: () => void

  // ==================== 换源相关 Actions ====================
  /** 设置备选源队列 */
  setAlternativeSources: (sources: AlternativeSource[]) => void
  /** 标记当前源为失败，加入 brokenSources 集合 */
  markCurrentSourceBroken: (siteKey: string, vodId: string) => void
  /** 设置换源状态 */
  setSourceSwitchState: (state: 'idle' | 'searching' | 'switching', message?: string) => void
  /** 设置是否启用自动换源 */
  setAutoSwitchSource: (enabled: boolean) => void
  /** 从备选队列取下一个源（弹出第一个） */
  popNextAlternativeSource: () => AlternativeSource | null
  /** 手动切换到指定备选源 */
  pickAlternativeSource: (index: number) => AlternativeSource | null
  /** 重置换源状态 */
  resetSourceSwitch: () => void

  reset: () => void
}

const initialState: PlayerState = {
  isPlaying: false,
  currentUrl: '',
  playKey: 0,
  currentTime: 0,
  duration: 0,
  speed: 1,
  volume: 1,
  isDanmakuOn: true,
  isFullscreen: false,
  currentVod: null,
  episodes: [],
  currentEpisodeIndex: 0,
  currentSourceIndex: 0,
  currentSourceName: '',
  playHeader: null,
  currentSiteKey: '',
  playbackPhase: 'idle',
  playbackMessage: '',
  playbackError: '',
  playbackStartedAt: 0,
  playbackFirstFrameAt: 0,
  playbackLastErrorAt: 0,
  playbackDiagnostic: null,
  alternativeSources: [],
  brokenSources: [],
  sourceSwitchState: 'idle',
  sourceSwitchMessage: '',
  autoSwitchSource: true
}

function makeSourceKey(siteKey: string, vodId: string): string {
  return `${siteKey}::${vodId}`
}

export const usePlayerStore = create<PlayerState & PlayerActions>()((set, get) => ({
  ...initialState,

  play: (url?: string) => {
    if (url) {
      set((s) => ({
        currentUrl: url,
        currentTime: 0,
        duration: 0,
        isPlaying: true,
        playbackPhase: 'connecting',
        playbackMessage: '正在连接播放地址...',
        playbackError: '',
        playbackDiagnostic: null,
        playbackStartedAt: Date.now(),
        playbackFirstFrameAt: 0,
        playbackLastErrorAt: 0,
        playKey: s.playKey + 1
      }))
    } else {
      set((s) => ({
        isPlaying: true,
        playbackPhase: s.currentUrl ? 'connecting' : s.playbackPhase,
        playbackMessage: s.currentUrl ? '正在连接播放地址...' : s.playbackMessage,
        playbackError: '',
        playbackDiagnostic: null,
        playbackLastErrorAt: 0,
        playKey: s.playKey + 1
      }))
    }
  },

  pause: () => set({ isPlaying: false }),

  stop: () => set({
    isPlaying: false,
    currentUrl: '',
    currentTime: 0,
    duration: 0,
    playbackPhase: 'idle',
    playbackMessage: '',
    playbackError: '',
    playbackDiagnostic: null,
    playbackFirstFrameAt: 0,
    playbackLastErrorAt: 0
  }),

  setSpeed: (speed: number) => set({ speed }),

  setVolume: (volume: number) => set({ volume: Math.max(0, Math.min(1, volume)) }),

  setCurrentTime: (time: number) => set({ currentTime: time }),

  setDuration: (duration: number) => set({ duration }),

  setIsPlaying: (playing: boolean) => set({ isPlaying: playing }),

  toggleDanmaku: () => set((s) => ({ isDanmakuOn: !s.isDanmakuOn })),

  toggleFullscreen: () => set((s) => ({ isFullscreen: !s.isFullscreen })),

  nextEpisode: () => {
    const { episodes, currentEpisodeIndex } = get()
    if (currentEpisodeIndex < episodes.length - 1) {
      const nextIndex = currentEpisodeIndex + 0 + 1
      set({
        currentEpisodeIndex: nextIndex,
        currentUrl: episodes[nextIndex].url,
        currentTime: 0,
        isPlaying: true
      })
    }
  },

  prevEpisode: () => {
    const { episodes, currentEpisodeIndex } = get()
    if (currentEpisodeIndex > 0) {
      const prevIndex = currentEpisodeIndex - 1
      set({
        currentEpisodeIndex: prevIndex,
        currentUrl: episodes[prevIndex].url,
        currentTime: 0,
        isPlaying: true
      })
    }
  },

  setVod: (
    vod,
    episodes,
    sourceIndex = 0,
    resolvedUrl?: string,
    header?: Record<string, string>,
    siteKey?: string,
    sourceName = '',
    startPositionSeconds = 0
  ) => {
    set({
      currentVod: vod,
      episodes,
      currentSourceIndex: sourceIndex,
      currentEpisodeIndex: 0,
      currentSourceName: sourceName,
      currentUrl: resolvedUrl || (episodes.length > 0 ? episodes[0].url : ''),
      currentTime: Math.max(0, startPositionSeconds),
      duration: 0,
      isPlaying: episodes.length > 0,
      playHeader: header || null,
      currentSiteKey: siteKey || '',
      playbackPhase: resolvedUrl === '__resolving__' ? 'resolving' : episodes.length > 0 ? 'connecting' : 'idle',
      playbackMessage: resolvedUrl === '__resolving__' ? '解析播放地址中...' : episodes.length > 0 ? '正在连接播放地址...' : '',
      playbackError: '',
      playbackDiagnostic: null,
      playbackStartedAt: episodes.length > 0 ? Date.now() : 0,
      playbackFirstFrameAt: 0,
      playbackLastErrorAt: 0
    })
  },

  setCurrentEpisodeIndex: (index: number, resolvedUrl?: string, startPositionSeconds = 0) => {
    const { episodes } = get()
    if (index >= 0 && index < episodes.length) {
      set({
        currentEpisodeIndex: index,
        currentUrl: resolvedUrl || episodes[index].url,
        currentTime: Math.max(0, startPositionSeconds),
        isPlaying: true,
        playbackPhase: resolvedUrl === '__resolving__' ? 'resolving' : 'connecting',
        playbackMessage: resolvedUrl === '__resolving__' ? '解析播放地址中...' : '正在连接播放地址...',
        playbackError: '',
        playbackDiagnostic: null,
        playbackStartedAt: Date.now(),
        playbackFirstFrameAt: 0,
        playbackLastErrorAt: 0
      })
    }
  },

  setCurrentSourceIndex: (index: number) => set({ currentSourceIndex: index }),

  setPlaybackPhase: (phase, message = '') => set({
    playbackPhase: phase,
    playbackMessage: message,
    playbackError: phase === 'failed' ? get().playbackError : '',
    playbackDiagnostic: phase === 'failed' ? get().playbackDiagnostic : null
  }),

  setPlaybackError: (message: string, diagnostic = {}) => set((state) => ({
    playbackPhase: 'failed',
    playbackMessage: diagnostic.stage === 'parse' ? '解析失败' : '播放失败',
    playbackError: message,
    playbackLastErrorAt: Date.now(),
    playbackDiagnostic: {
      stage: diagnostic.stage || 'unknown',
      errorKind: diagnostic.errorKind || 'unknown',
      protocol: diagnostic.protocol || 'unknown',
      httpStatus: diagnostic.httpStatus,
      elapsedMs: diagnostic.elapsedMs,
      sourceId: diagnostic.sourceId || (
        state.currentSiteKey && state.currentVod ? `${state.currentSiteKey}::${state.currentVod.vod_id}` : undefined
      ),
      attempt: diagnostic.attempt ?? state.brokenSources.length + 1,
      sourceCount: diagnostic.sourceCount ?? state.alternativeSources.length + state.brokenSources.length + 1,
      nextAction: diagnostic.nextAction || (state.autoSwitchSource ? '自动尝试下一条可用线路' : '可手动重试或切换线路')
    }
  })),

  markPlaybackFirstFrame: () => set((state) => ({
    playbackPhase: 'playing',
    playbackMessage: '正在播放',
    playbackFirstFrameAt: state.playbackFirstFrameAt || Date.now(),
    playbackError: '',
    playbackDiagnostic: null
  })),

  // ==================== 换源 Actions ====================
  setAlternativeSources: (sources) => set({ alternativeSources: sources }),

  markCurrentSourceBroken: (siteKey, vodId) => {
    const key = makeSourceKey(siteKey, vodId)
    const { brokenSources, currentVod } = get()
    const newBroken = [...brokenSources, key]
    // 同时标记当前 detail 页面正在播放的源为 broken（用 siteKey + currentVod.vod_id）
    if (currentVod) {
      const vodKey = makeSourceKey(siteKey, currentVod.vod_id)
      if (!newBroken.includes(vodKey)) newBroken.push(vodKey)
    }
    console.log('[PlayerStore] 标记源失败:', siteKey, vodId, '已失败数:', newBroken.length)
    set({ brokenSources: newBroken })
  },

  setSourceSwitchState: (state, message = '') => set({
    sourceSwitchState: state,
    sourceSwitchMessage: message
  }),

  setAutoSwitchSource: (enabled) => set({ autoSwitchSource: enabled }),

  popNextAlternativeSource: () => {
    const { alternativeSources, brokenSources } = get()
    // 找到队列中第一个未被标记为失败的源
    while (alternativeSources.length > 0) {
      const next = alternativeSources[0]
      const key = makeSourceKey(next.siteKey, next.vodId)
      if (!brokenSources.includes(key)) {
        // 弹出
        set({ alternativeSources: alternativeSources.slice(1) })
        return next
      }
      // 跳过已失败的
      set({ alternativeSources: alternativeSources.slice(1) })
    }
    return null
  },

  pickAlternativeSource: (index) => {
    const { alternativeSources, brokenSources } = get()
    if (index < 0 || index >= alternativeSources.length) return null
    const target = alternativeSources[index]
    const key = makeSourceKey(target.siteKey, target.vodId)
    if (brokenSources.includes(key)) return null
    // 从队列中移除该源
    const newQueue = [...alternativeSources.slice(0, index), ...alternativeSources.slice(index + 1)]
    set({ alternativeSources: newQueue })
    return target
  },

  resetSourceSwitch: () => set({
    alternativeSources: [],
    brokenSources: [],
    sourceSwitchState: 'idle',
    sourceSwitchMessage: ''
  }),

  reset: () => set(initialState)
}))
