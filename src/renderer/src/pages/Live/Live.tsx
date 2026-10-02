import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { useLiveStore, Channel } from '@/stores/useLiveStore'
import { usePlayerStore } from '@/stores/usePlayerStore'
import ChannelItem from '@/components/ChannelItem/ChannelItem'
import VideoPlayer from '@/components/VideoPlayer/VideoPlayer'
import { ChevronDown, ChevronRight, Loader2, Search } from 'lucide-react'
import { getPlayableMediaUrl } from '@/utils/media'
import { downloadApi, liveApi, on } from '@/utils/ipc'
import RecordButton from '@/components/RecordButton/RecordButton'
import { useRecordingStore } from '@/stores/useRecordingStore'


/** 简易媒体查询 hook（与 Tailwind 断点保持一致的判定用） */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  )
  useEffect(() => {
    const media = window.matchMedia(query)
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches)
    setMatches(media.matches)
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [query])
  return matches
}

export default function Live() {
  const {
    groups, channels, currentGroup, currentChannel, epgData,
    isLoading, error, loadChannelTree, switchGroup, switchChannel, fetchEpg,
    reportPlaybackResult
  } = useLiveStore()
  const play = usePlayerStore((state) => state.play)
  const autoSwitchSource = usePlayerStore((state) => state.autoSwitchSource)
  const setPlaybackError = usePlayerStore((state) => state.setPlaybackError)
  const setSourceSwitchState = usePlayerStore((state) => state.setSourceSwitchState)
  const channelUrlIndexRef = useRef(0)
  const playRequestRef = useRef(0)
  const channelPlaybackQueueRef = useRef<string[]>([])
  const channelHeadersQueueRef = useRef<Array<Record<string, string> | undefined>>([])

  const [searchKeyword, setSearchKeyword] = useState('')
  const [selectedLineIndex, setSelectedLineIndex] = useState(0)
  const [sortMode, setSortMode] = useState<'name' | 'latency'>('name')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [speedTesting, setSpeedTesting] = useState(false)
  const [speedTestProgress, setSpeedTestProgress] = useState<{ current: number; total: number; message: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    let receivedProgress = false
    const cleanup = on('live:refreshProgress', (progress: any) => {
      receivedProgress = true
      setSpeedTestProgress(progress)
      setSpeedTesting(progress.phase !== 'done' && progress.phase !== 'error')
      if (progress.phase === 'cached' || progress.phase === 'done') void loadChannelTree()
    })
    void loadChannelTree()
    void liveApi.getRefreshStatus().then((status: any) => {
      if (!cancelled && !receivedProgress) {
        setSpeedTesting(Boolean(status?.isRefreshing))
        setSpeedTestProgress(status?.progress || null)
      }
    }).catch(() => {})
    return () => { cancelled = true; cleanup() }
  }, [loadChannelTree])

  // 直播录像：复用下载管理（输出 TS，停止后文件仍可播放）
  // 录制状态与播放器控制栏共用同一个 store，避免两个按钮各说各话。
  const recordingStatus = useRecordingStore((state) => state.status)
  useEffect(() => {
    useRecordingStore.getState().setSourceName(currentChannel?.name || '')
  }, [currentChannel])
  useEffect(() => {
    const off = on('download:progress', (payload: any) => {
      const task = payload?.task
      if (!task) return
      const active = useRecordingStore.getState().taskId
      if (!active || task.id !== active) return
      if (task.status !== 'running') useRecordingStore.getState().finishRecording()
    })
    return () => { if (typeof off === 'function') off() }
  }, [])

  const buildPlaybackQueue = useCallback((channel: Channel): { urls: string[]; headers: Array<Record<string, string> | undefined> } => {
    if (channel.lines?.length) {
      return { urls: channel.lines.map((line) => line.url), headers: channel.lines.map((line) => line.header) }
    }
    const candidates: Array<{ url: string; best: boolean; headers?: Record<string, string> }> = []
    const bestUrl = (channel as Channel & { bestUrl?: string }).bestUrl
    const channelUrlHeaders = (channel as any).urlHeaders as Record<string, Record<string, string>> | undefined

    if (bestUrl) {
      candidates.push({ url: bestUrl, best: true, headers: channelUrlHeaders?.[bestUrl] })
    }
    for (const url of channel.urls) {
      candidates.push({ url, best: url === bestUrl, headers: channelUrlHeaders?.[url] })
    }

    candidates.sort((a, b) => {
      if (a.best !== b.best) return a.best ? -1 : 1
      return 0
    })

    const uniqueUrls: string[] = []
    const uniqueHeaders: Array<Record<string, string> | undefined> = []
    const seen = new Set<string>()
    for (const candidate of candidates) {
      if (!seen.has(candidate.url)) {
        seen.add(candidate.url)
        uniqueUrls.push(candidate.url)
        uniqueHeaders.push(candidate.headers)
      }
    }
    return { urls: uniqueUrls, headers: uniqueHeaders }
  }, [])

  const playLiveUrl = useCallback(async (url: string, headers?: Record<string, string>) => {
    const requestId = ++playRequestRef.current
    try {
      const playableUrl = await getPlayableMediaUrl(url, headers)
      if (requestId !== playRequestRef.current) return
      usePlayerStore.setState({ currentVod: null, currentSiteKey: '', episodes: [], currentEpisodeIndex: 0, currentSourceIndex: 0, playHeader: null })
      play(playableUrl)
    } catch (error) {
      if (requestId !== playRequestRef.current) return
      setPlaybackError(error instanceof Error ? error.message : String(error || '直播线路加载失败'))
      usePlayerStore.getState().sendPlayerSignal({ type: 'playFailed', scope: 'live' })
    }
  }, [play, setPlaybackError])

  useEffect(() => () => { playRequestRef.current += 1 }, [])

  useEffect(() => {
    if (!currentChannel || currentChannel.urls.length === 0) return
    const queue = buildPlaybackQueue(currentChannel)
    channelPlaybackQueueRef.current = queue.urls
    channelHeadersQueueRef.current = queue.headers
    channelUrlIndexRef.current = 0
    setSelectedLineIndex(0)
    void playLiveUrl(queue.urls[0], queue.headers[0])
  }, [buildPlaybackQueue, currentChannel, playLiveUrl])

  const switchToNextLiveLine = useCallback(() => {
      if (!currentChannel) return

      const nextIndex = channelUrlIndexRef.current + 1
      const queue = channelPlaybackQueueRef.current
      const headersQueue = channelHeadersQueueRef.current
      if (nextIndex < queue.length) {
        channelUrlIndexRef.current = nextIndex
        setSelectedLineIndex(nextIndex)
        setSourceSwitchState('switching', `正在切换直播线路 ${nextIndex + 1}/${queue.length}`)
        console.warn(
          `[Live] 当前线路失败，切换备用线路 ${nextIndex + 1}/${queue.length}:`,
          currentChannel.name
        )
        void playLiveUrl(queue[nextIndex], headersQueue[nextIndex])
        window.setTimeout(() => setSourceSwitchState('idle', ''), 2500)
        return
      }

      console.error('[Live] 当前频道所有线路均不可用:', currentChannel.name)
      setSourceSwitchState('idle', '当前频道所有线路均不可用')
      setPlaybackError('当前频道所有线路均不可用', {
        stage: 'connect',
        errorKind: 'unknown',
        protocol: 'unknown',
        sourceId: currentChannel.name,
        attempt: queue.length,
        sourceCount: queue.length,
        nextAction: '可重试当前频道或选择其他频道'
      })
  }, [currentChannel, playLiveUrl, setPlaybackError, setSourceSwitchState])

  // 用 useRef 稳定回调引用，避免 useEffect 频繁重建事件监听
  const autoSwitchSourceRef = useRef(autoSwitchSource)
  autoSwitchSourceRef.current = autoSwitchSource
  const switchToNextLiveLineRef = useRef(switchToNextLiveLine)
  switchToNextLiveLineRef.current = switchToNextLiveLine
  const playLiveUrlRef = useRef(playLiveUrl)
  playLiveUrlRef.current = playLiveUrl

  // 播放器信号（显式状态，替代 window 事件）
  const playerSignal = usePlayerStore((state) => state.playerSignal)
  const playerSignalToken = playerSignal?.token ?? 0
  // 信号放在 store 里不会自动消失：挂载时先记下当前 token，避免把旧信号当新信号再处理一次
  const handledSignalRef = useRef(usePlayerStore.getState().playerSignal?.token ?? 0)
  useEffect(() => {
    if (playerSignalToken === handledSignalRef.current) return
    handledSignalRef.current = playerSignalToken
    if (!playerSignal || playerSignal.scope !== 'live') return
    if (playerSignal.type === 'playFailed') {
      if (autoSwitchSourceRef.current) switchToNextLiveLineRef.current()
    } else if (playerSignal.type === 'retry') {
      const url = channelPlaybackQueueRef.current[channelUrlIndexRef.current]
      if (url) {
        void playLiveUrlRef.current(url, channelHeadersQueueRef.current[channelUrlIndexRef.current])
      }
    } else if (playerSignal.type === 'nextSource') {
      switchToNextLiveLineRef.current()
    }
  }, [playerSignalToken, playerSignal])

  useEffect(() => {
    const ch = currentChannel as Channel & { epgUrl?: string }
    if (ch?.epgId && ch?.epgUrl) {
      fetchEpg(ch.epgUrl, ch.epgId)
    }
  }, [currentChannel, fetchEpg])

  const channelsRef = useRef(channels)
  channelsRef.current = channels
  const currentChannelRef = useRef(currentChannel)
  currentChannelRef.current = currentChannel

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' && e.metaKey) {
        e.preventDefault()
        const chs = channelsRef.current
        const cur = currentChannelRef.current
        const idx = chs.findIndex((c) => c.name === cur?.name)
        if (idx > 0) switchChannel(chs[idx - 1])
      } else if (e.key === 'ArrowDown' && e.metaKey) {
        e.preventDefault()
        const chs = channelsRef.current
        const cur = currentChannelRef.current
        const idx = chs.findIndex((c) => c.name === cur?.name)
        if (idx < chs.length - 1) switchChannel(chs[idx + 1])
      }
    },
    [switchChannel]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown]) // handleKeyDown 依赖 useRef，引用稳定

  const displayChannels = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase()
    const isVisible = (channel: Channel) =>
      (!keyword || channel.name.toLowerCase().includes(keyword))
    const filtered = keyword
      ? groups.flatMap((group) => group.channels.filter(isVisible))
      : channels.filter(isVisible)
    // 排序
    if (sortMode === 'latency') {
      return [...filtered].sort((a, b) => {
        const aLat = a.latency ?? 9999
        const bLat = b.latency ?? 9999
        return aLat - bLat
      })
    }
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
  }, [channels, groups, searchKeyword, sortMode])
  // 组内排序：可达的在前 → 延时升序 → 名称
  const speedFirst = useCallback((list: Channel[]) => [...list].sort((a, b) => {
    const aAlive = (a.latency ?? -1) > 0 ? 0 : 1
    const bAlive = (b.latency ?? -1) > 0 ? 0 : 1
    if (aAlive !== bAlive) return aAlive - bAlive
    const aLat = (a.latency ?? -1) > 0 ? (a.latency as number) : Number.MAX_SAFE_INTEGER
    const bLat = (b.latency ?? -1) > 0 ? (b.latency as number) : Number.MAX_SAFE_INTEGER
    if (aLat !== bLat) return aLat - bLat
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
  }), [])

  const groupBestLatency = useCallback((list: Channel[]) => {
    const alive = list.map((c) => c.latency ?? -1).filter((v) => v > 0)
    return alive.length ? Math.min(...alive) : -1
  }, [])

  // 分组排序：组内最快频道越快的组越靠前
  const sortedGroups = useMemo(() => [...groups].sort((a, b) => {
    const aBest = groupBestLatency(a.channels)
    const bBest = groupBestLatency(b.channels)
    const aScore = aBest > 0 ? aBest : Number.MAX_SAFE_INTEGER
    const bScore = bBest > 0 ? bBest : Number.MAX_SAFE_INTEGER
    if (aScore !== bScore) return aScore - bScore
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
  }), [groups, groupBestLatency])

  // 当前分组默认展开
  useEffect(() => {
    if (!currentGroup) return
    setExpandedGroups((prev) => (prev.has(currentGroup) ? prev : new Set(prev).add(currentGroup)))
  }, [currentGroup])

  const toggleGroup = useCallback((name: string) => {
    const willExpand = !expandedGroups.has(name)
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (willExpand) next.add(name)
      else next.delete(name)
      return next
    })
    if (willExpand) switchGroup(name)
  }, [expandedGroups, switchGroup])

  const playbackQueue = useMemo(() => currentChannel ? buildPlaybackQueue(currentChannel) : { urls: [], headers: [] }, [currentChannel, buildPlaybackQueue])

  // 真实播放结果回写：探测会因超时/嗅探条件误判「无信号」，而用户双击却能播。
  // 这里把播放器实际结果写回缓存，状态立刻自我纠正（同一 URL 只回写一次）。
  const playbackPhase = usePlayerStore((state) => state.playbackPhase)
  const playbackUrl = usePlayerStore((state) => state.currentUrl)
  const reportedPlaybackRef = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    if (!playbackUrl || !playbackQueue.urls.includes(playbackUrl)) return
    const outcome = playbackPhase === 'playing' ? 'alive' : playbackPhase === 'failed' ? 'dead' : null
    if (!outcome) return
    if (reportedPlaybackRef.current.get(playbackUrl) === outcome) return
    reportedPlaybackRef.current.set(playbackUrl, outcome)
    console.log(`[Live] 播放结果回写: ${outcome} ${playbackUrl.slice(0, 80)}`)
    void reportPlaybackResult([playbackUrl], outcome === 'alive')
  }, [playbackPhase, playbackUrl, playbackQueue.urls, reportPlaybackResult])

  const handleRecord = useCallback(async () => {
    const store = useRecordingStore.getState()
    if (store.taskId) {
      // 停止录制：Rust 侧会保留已录部分；状态转「常亮」
      await downloadApi.cancel(store.taskId).catch(() => {})
      store.finishRecording()
      return
    }
    if (!currentChannel || playbackQueue.urls.length === 0) return
    const index = selectedLineIndex
    const url = playbackQueue.urls[index] || playbackQueue.urls[0]
    const headers = playbackQueue.headers[index]
    try {
      const task = await downloadApi.start({
        url,
        headers,
        fileName: `${currentChannel.name} 录像`,
        live: true
      })
      store.startRecording(task.id)
    } catch (error) {
      setPlaybackError(error instanceof Error ? error.message : String(error))
    }
  }, [currentChannel, playbackQueue, selectedLineIndex, setPlaybackError])


  // 频道列表宽度：可拖动调整并记住（原先写死 wide:w-56 = 224px，名字被状态文字挤没）
  const isWideLayout = useMediaQuery('(min-width: 1200px)')
  const [listWidth, setListWidth] = useState<number>(() => {
    const saved = Number(window.localStorage.getItem('iptv.liveListWidth'))
    return Number.isFinite(saved) && saved >= 200 ? Math.min(600, saved) : 264
  })
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const startResize = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      dragStateRef.current = { startX: event.clientX, startWidth: listWidth }
      const onMove = (moveEvent: MouseEvent) => {
        const drag = dragStateRef.current
        if (!drag) return
        const next = Math.max(200, Math.min(600, drag.startWidth + (moveEvent.clientX - drag.startX)))
        setListWidth(next)
      }
      const onUp = () => {
        dragStateRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setListWidth((current) => {
          window.localStorage.setItem('iptv.liveListWidth', String(current))
          return current
        })
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [listWidth]
  )

  return (
    <div className="h-full min-h-0 flex flex-col">
      {/* 主内容区 */}
      <div className="flex-1 min-h-0 flex flex-col wide:flex-row">
        {/* 左侧 - 当前源频道 */}
        <div
          className="w-full wide:w-auto min-h-0 shrink-0 max-h-[38vh] wide:max-h-none border-b wide:border-b-0 wide:border-r border-[#2a2a2a] flex flex-col"
          style={isWideLayout ? { width: listWidth } : undefined}
        >
          <div className="px-3 py-2 border-b border-[#2a2a2a] space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-secondary font-medium">
                {searchKeyword ? `搜索: ${searchKeyword}` : currentGroup || '频道列表'}
              </span>
              <button
                onClick={() => setSortMode(sortMode === 'name' ? 'latency' : 'name')}
                className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                  sortMode === 'latency'
                    ? 'text-accent bg-accent/20'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
                title={sortMode === 'name' ? '按延时排序' : '按名称排序'}
              >
                {sortMode === 'name' ? '名称 ↕' : '延时 ↕'}
              </button>
            </div>
            {/* 后台测速进度 */}
            {speedTesting && (
              <div className="flex items-center gap-1.5">
                <Loader2 className="w-2.5 h-2.5 animate-spin text-accent shrink-0" />
                <span className="text-[10px] text-text-muted truncate">
                  {speedTestProgress?.message || '后台巡检中...'}
                </span>
              </div>
            )}
          </div>

          {/* 搜索框 */}
          <div className="px-3 py-2 border-b border-[#2a2a2a]">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="搜索频道..."
                className="w-full pl-7 pr-2 py-1.5 text-xs bg-bg-tertiary rounded-md border border-[#2a2a2a] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
            </div>
          </div>


          {/* 分组 → 点开 → 组内按速度最快排序 */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-dark py-1">
            {!searchKeyword && sortedGroups.length > 0 ? (
              sortedGroups.map((group) => {
                const expanded = expandedGroups.has(group.name)
                const best = groupBestLatency(group.channels)
                return (
                  <div key={group.name}>
                    <button
                      onClick={() => toggleGroup(group.name)}
                      className={`w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-xs transition-colors ${
                        currentGroup === group.name
                          ? 'text-accent'
                          : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                      }`}
                    >
                      {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                      <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
                      {best > 0 && <span className="shrink-0 text-[10px] font-mono text-green-400">{best}ms</span>}
                      <span className="shrink-0 text-[10px] text-text-muted">{group.channels.length}</span>
                    </button>
                    {expanded && (
                      <div className="pl-2">
                        {speedFirst(group.channels).map((channel) => (
                          <ChannelItem
                            key={`${group.name}:${channel.name}:${channel.urls[0] || 'no-url'}`}
                            channel={channel}
                            isActive={currentChannel?.name === channel.name}
                            onClick={(ch) => switchChannel(ch)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            ) : displayChannels.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-text-muted text-xs">
                {isLoading && !searchKeyword ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    正在加载频道...
                  </span>
                ) : searchKeyword ? '未找到匹配频道' : '暂无可用频道'}
              </div>
            ) : (
              displayChannels.map((channel) => (
                <ChannelItem
                  key={`${channel.name}:${channel.urls[0] || 'no-url'}`}
                  channel={channel}
                  isActive={currentChannel?.name === channel.name}
                  onClick={(ch) => switchChannel(ch)}
                />
              ))
            )}
          </div>
        </div>

        {/* 拖动条：调整频道列表宽度（仅宽屏布局；双击复位） */}
        {isWideLayout && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动调整频道列表宽度"
            title="拖动调整频道列表宽度（双击复位）"
            onMouseDown={startResize}
            onDoubleClick={() => {
              setListWidth(264)
              window.localStorage.setItem('iptv.liveListWidth', '264')
            }}
            className="hidden wide:block w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-accent/40 transition-colors"
          />
        )}

        {/* 右侧 - 播放器 */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {error && <p role="alert" className="shrink-0 px-4 py-2 text-xs text-red-400 break-words">{error}</p>}
          {currentChannel && (
            <div className="shrink-0 flex flex-wrap items-center gap-3 border-b border-[#2a2a2a] bg-bg-secondary px-4 py-2">
              <span className="min-w-0 flex-1 break-words text-sm text-text-primary">{currentChannel.name}</span>
              <label htmlFor="live-line" className="shrink-0 text-xs text-text-muted">{playbackQueue.urls.length} 条线路</label>
              <RecordButton onStart={handleRecord} onStop={handleRecord} />
              <select id="live-line" value={selectedLineIndex} onChange={(event) => {
                const index = Number(event.target.value)
                if (!playbackQueue.urls[index]) return
                channelUrlIndexRef.current = index
                setSelectedLineIndex(index)
                void playLiveUrl(playbackQueue.urls[index], playbackQueue.headers[index])
              }} className="w-40 max-w-full rounded border border-[#3a3a3a] bg-bg-primary px-2 py-1 text-xs text-text-primary">
                {playbackQueue.urls.map((url, index) => {
                  // 巡检哨兵：-2=未探测（不标注）、-1=探测不通、>=0=可达
                  const line = currentChannel.lines?.[index]
                  const monitor = line
                    ? line.latency === -2
                      ? ''
                      : line.alive
                        ? ` · ${line.latency >= 0 ? `${line.latency}ms` : '可达'}`
                        : ' · 不可用'
                    : ''
                  return (
                    <option key={`${index}:${url}`} value={index}>
                      线路 {index + 1}
                      {currentChannel.lines?.length
                        ? index === 0 && currentChannel.lines[0].alive
                          ? ' (优选)'
                          : ''
                        : url === currentChannel.bestUrl
                          ? ' (优选)'
                          : ''}
                      {monitor}
                    </option>
                  )
                })}
              </select>
            </div>
          )}
          <div className="flex-1 min-h-0 bg-black relative">
            {currentChannel ? (
              <>
                <VideoPlayer kind="live" />
                {isLoading && (
                  <div className="pointer-events-none absolute right-4 top-4 z-30 inline-flex items-center gap-2 rounded-md border border-white/10 bg-black/65 px-3 py-2 text-xs text-white/80 shadow-lg backdrop-blur">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                    正在后台加载直播源
                  </div>
                )}
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-text-muted text-sm">
                {isLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    正在加载频道...
                  </span>
                ) : error || '请选择频道'}
              </div>
            )}
          </div>

          {/* EPG 信息栏 */}
          {epgData.length > 0 && (
            <div className="shrink-0 px-4 py-2 bg-bg-secondary border-t border-[#2a2a2a]">
              <div className="flex items-center gap-4 text-xs">
                {epgData.slice(0, 3).map((epg, idx) => (
                  <div key={`${epg.start}:${epg.title}`} className="flex items-center gap-1.5">
                    <span className="text-text-muted">{epg.start.slice(11, 16)}</span>
                    <span className={idx === 0 ? 'text-accent' : 'text-text-secondary'}>
                      {epg.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
