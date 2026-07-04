import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { useLiveStore, Channel } from '@/stores/useLiveStore'
import { useConfigStore } from '@/stores/useConfigStore'
import { usePlayerStore } from '@/stores/usePlayerStore'
import ChannelItem from '@/components/ChannelItem/ChannelItem'
import VideoPlayer from '@/components/VideoPlayer/VideoPlayer'
import { Loader2, Radio, Search } from 'lucide-react'
import { getPlayableMediaUrl } from '@/utils/media'
import EmptyState from '@/components/EmptyState/EmptyState'
import { cacheApi } from '@/utils/ipc'
import { useNavigate } from 'react-router-dom'

const LAST_LIVE_SOURCE_KEY = 'iptv:last-live-source'

function getLiveSourceKey(live: { name: string; url: string }) {
  return `${live.name}\n${live.url}`
}

async function readLastLiveSourceKey() {
  try {
    const value = await cacheApi.get(LAST_LIVE_SOURCE_KEY) as string | null
    return value || ''
  } catch {
    return ''
  }
}

async function writeLastLiveSourceKey(key: string) {
  try {
    await cacheApi.set(LAST_LIVE_SOURCE_KEY, key)
  } catch {
    // ignore storage failures
  }
}

export default function Live() {
  const navigate = useNavigate()
  const {
    groups, channels, currentGroup, currentChannel, epgData,
    isLoading, error, loadLive, switchGroup, switchChannel, fetchEpg, reset,
  } = useLiveStore()
  const play = usePlayerStore((state) => state.play)
  const autoSwitchSource = usePlayerStore((state) => state.autoSwitchSource)
  const setPlaybackError = usePlayerStore((state) => state.setPlaybackError)
  const setSourceSwitchState = usePlayerStore((state) => state.setSourceSwitchState)
  const currentConfig = useConfigStore((state) => state.currentConfig)
  const liveConfig = useConfigStore((state) => state.liveConfig)

  const livesConfig = liveConfig || currentConfig

  const loadedLiveKeyRef = useRef('')
  const loadEffectRequestRef = useRef(0)
  const channelUrlIndexRef = useRef(0)
  const playRequestRef = useRef(0)
  const channelPlaybackQueueRef = useRef<string[]>([])
  const channelHeadersQueueRef = useRef<Array<Record<string, string> | undefined>>([])

  const [searchKeyword, setSearchKeyword] = useState('')
  const [selectedLiveIndex, setSelectedLiveIndex] = useState(0)

  const liveSources = useMemo(
    () => (livesConfig?.lives || []).filter((live) => live.name && live.url),
    [livesConfig?.lives]
  )

  const buildPlaybackQueue = useCallback((channel: Channel): { urls: string[]; headers: Array<Record<string, string> | undefined> } => {
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

  useEffect(() => {
    const restoreLastLiveSource = async () => {
      const savedKey = await readLastLiveSourceKey()
      const savedIndex = liveSources.findIndex((live) => getLiveSourceKey(live) === savedKey || live.url === savedKey)
      setSelectedLiveIndex(savedIndex >= 0 ? savedIndex : 0)
      loadedLiveKeyRef.current = ''
    }
    void restoreLastLiveSource()
  }, [liveSources])

  useEffect(() => {
    if (!livesConfig || liveSources.length === 0) {
      loadEffectRequestRef.current += 1
      reset()
      loadedLiveKeyRef.current = ''
      return
    }
    const live = liveSources[Math.min(selectedLiveIndex, liveSources.length - 1)]
    if (!live) return
    const liveKey = getLiveSourceKey(live)
    if (loadedLiveKeyRef.current === liveKey) return

    const loadSelected = async () => {
      const requestId = ++loadEffectRequestRef.current
      console.log('[Live] 加载当前选择的直播源:', live.name, 'url:', live.url)
      await loadLive(live.name)
      if (requestId !== loadEffectRequestRef.current) return
      loadedLiveKeyRef.current = liveKey
      await writeLastLiveSourceKey(liveKey)
    }

    void loadSelected()
  }, [livesConfig, liveSources, selectedLiveIndex, loadLive, reset])

  const playLiveUrl = useCallback(async (url: string, headers?: Record<string, string>) => {
    const requestId = ++playRequestRef.current
    const playableUrl = await getPlayableMediaUrl(url, headers)
    if (requestId !== playRequestRef.current) return
    play(playableUrl)
  }, [play])

  useEffect(() => {
    if (!currentChannel || currentChannel.urls.length === 0) return
    const queue = buildPlaybackQueue(currentChannel)
    channelPlaybackQueueRef.current = queue.urls
    channelHeadersQueueRef.current = queue.headers
    channelUrlIndexRef.current = 0
    void playLiveUrl(queue.urls[0], queue.headers[0])
  }, [buildPlaybackQueue, currentChannel, playLiveUrl])

  const switchToNextLiveLine = useCallback(() => {
      if (!currentChannel) return

      const nextIndex = channelUrlIndexRef.current + 1
      const queue = channelPlaybackQueueRef.current
      const headersQueue = channelHeadersQueueRef.current
      if (nextIndex < queue.length) {
        channelUrlIndexRef.current = nextIndex
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

  useEffect(() => {
    const handlePlayFailed = () => {
      if (autoSwitchSource) switchToNextLiveLine()
    }

    window.addEventListener('live:playFailed', handlePlayFailed)
    return () => window.removeEventListener('live:playFailed', handlePlayFailed)
  }, [autoSwitchSource, switchToNextLiveLine])

  useEffect(() => {
    const handleRetry = () => {
      const queue = channelPlaybackQueueRef.current
      const headersQueue = channelHeadersQueueRef.current
      const url = queue[channelUrlIndexRef.current]
      if (url) void playLiveUrl(url, headersQueue[channelUrlIndexRef.current])
    }
    const handleNextSource = () => switchToNextLiveLine()
    window.addEventListener('player:retry', handleRetry)
    window.addEventListener('player:nextSource', handleNextSource)
    return () => {
      window.removeEventListener('player:retry', handleRetry)
      window.removeEventListener('player:nextSource', handleNextSource)
    }
  }, [playLiveUrl, switchToNextLiveLine])

  useEffect(() => {
    const ch = currentChannel as Channel & { epgUrl?: string }
    if (ch?.epgId && ch?.epgUrl) {
      fetchEpg(ch.epgUrl, ch.epgId)
    }
  }, [currentChannel, fetchEpg])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' && e.metaKey) {
        e.preventDefault()
        const idx = channels.findIndex((c) => c.name === currentChannel?.name)
        if (idx > 0) switchChannel(channels[idx - 1])
      } else if (e.key === 'ArrowDown' && e.metaKey) {
        e.preventDefault()
        const idx = channels.findIndex((c) => c.name === currentChannel?.name)
        if (idx < channels.length - 1) switchChannel(channels[idx + 1])
      }
    },
    [channels, currentChannel]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const displayChannels = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase()
    const isVisible = (channel: Channel) =>
      (!keyword || channel.name.toLowerCase().includes(keyword))
    return keyword
      ? groups.flatMap((group) => group.channels.filter(isVisible))
      : channels.filter(isVisible)
  }, [channels, groups, searchKeyword])

  if (!currentConfig && !liveConfig) {
    return (
      <EmptyState
        icon={Radio}
        title="还没有直播配置"
        description="导入包含直播源的配置后，这里会自动加载频道列表。"
        primaryLabel="去导入配置"
        onPrimaryClick={() => navigate('/onboarding')}
      />
    )
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      {/* 主内容区 */}
      <div className="flex-1 min-h-0 flex">
        {/* 左侧 - 当前源频道 */}
        <div className="w-56 min-h-0 shrink-0 border-r border-[#2a2a2a] flex flex-col">
          <div className="px-3 py-2 border-b border-[#2a2a2a]">
            <span className="text-xs text-text-secondary font-medium">
              {searchKeyword ? `搜索: ${searchKeyword}` : currentGroup || '频道列表'}
            </span>
          </div>

          {liveSources.length > 1 && (
            <div className="px-3 py-2 border-b border-[#2a2a2a]">
              <select
                value={selectedLiveIndex}
                onChange={(event) => {
                  const nextIndex = Number(event.target.value)
                  setSelectedLiveIndex(nextIndex)
                  const live = liveSources[nextIndex]
                  if (live) void writeLastLiveSourceKey(getLiveSourceKey(live))
                }}
                className="w-full bg-bg-tertiary border border-[#2a2a2a] rounded-md px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
              >
                {liveSources.map((live, index) => (
                  <option key={`${live.name}:${live.url}:${index}`} value={index}>
                    {live.name}
                  </option>
                ))}
              </select>
            </div>
          )}

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

          {groups.length > 1 && !searchKeyword && (
            <div className="shrink-0 max-h-36 overflow-y-auto scrollbar-dark border-b border-[#2a2a2a] py-1">
              {groups.map((group) => (
                <button
                  key={group.name}
                  onClick={() => switchGroup(group.name)}
                  className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                    currentGroup === group.name
                      ? 'bg-accent-muted text-accent'
                      : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'
                  }`}
                >
                  <span className="block truncate">{group.name}</span>
                </button>
              ))}
            </div>
          )}

          {/* 当前直播源频道列表 */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-dark py-1">
            {displayChannels.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-text-muted text-xs">
                {isLoading && !searchKeyword ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    正在加载频道...
                  </span>
                ) : searchKeyword ? '未找到匹配频道' : '暂无可用频道'}
              </div>
            ) : (
              displayChannels.map((channel, index) => (
                <ChannelItem
                  key={`${channel.name}:${channel.urls[0] || 'no-url'}:${index}`}
                  channel={channel}
                  isActive={currentChannel?.name === channel.name}
                  onClick={(ch) => switchChannel(ch)}
                />
              ))
            )}
          </div>
        </div>

        {/* 右侧 - 播放器 */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 bg-black relative">
            {currentChannel ? (
              <>
                <VideoPlayer />
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
                  <div key={idx} className="flex items-center gap-1.5">
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
