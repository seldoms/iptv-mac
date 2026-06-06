import { useEffect, useCallback, useRef, useState } from 'react'
import { useLiveStore, Channel } from '@/stores/useLiveStore'
import { useConfigStore } from '@/stores/useConfigStore'
import { usePlayerStore } from '@/stores/usePlayerStore'
import ChannelItem from '@/components/ChannelItem/ChannelItem'
import VideoPlayer from '@/components/VideoPlayer/VideoPlayer'
import { Search } from 'lucide-react'
import { configApi } from '@/utils/ipc'
import LiveTree from '@/components/LiveTree/LiveTree'

export default function Live() {
  const {
    groups, channels, currentGroup, currentChannel, epgData,
    isPlaying, isLoading, error, loadLiveByUrl, switchGroup, switchChannel, fetchEpg,
    getChannelTree,
  } = useLiveStore()
  const { play } = usePlayerStore()
  const { currentConfig, liveConfig } = useConfigStore()

  const livesConfig = liveConfig || currentConfig

  const hasLoadedRef = useRef(false)
  const triedIndexRef = useRef(0)
  const otherQueueRef = useRef<{ name: string; url: string }[]>([])
  const otherFetchingRef = useRef(false)
  const loadingRef = useRef(false)

  const [channelTree, setChannelTree] = useState<any>(null)
  const [searchKeyword, setSearchKeyword] = useState('')

  // IPC 进度监听 + 加载频道树
  useEffect(() => {
    const handleProgress = (progress: any) => {
      if (progress.phase === 'done') {
        getChannelTree().then(setChannelTree)
      }
    }

    const cleanup = window.api.on('live:refreshProgress', handleProgress)

    getChannelTree().then(setChannelTree)

    return cleanup as () => void
  }, [])

  // 自动加载直播源（保留原有逻辑）
  useEffect(() => {
    if (hasLoadedRef.current) return
    if (groups.length > 0) {
      hasLoadedRef.current = true
      return
    }
    if (isLoading || loadingRef.current) return
    if (!livesConfig) return

    const tryNext = async () => {
      loadingRef.current = true
      const lives = livesConfig?.lives

      if (lives && lives.length > 0) {
        while (triedIndexRef.current < lives.length) {
          const live = lives[triedIndexRef.current]
          triedIndexRef.current++
          if (live.name && live.url) {
            console.log('[Live] 尝试当前配置直播源:', live.name, 'url:', live.url)
            loadLiveByUrl(live.url, live.name)
            loadingRef.current = false
            return
          }
        }
      }

      while (otherQueueRef.current.length > 0) {
        const live = otherQueueRef.current.shift()!
        if (live.name && live.url) {
          console.log('[Live] 尝试其他配置直播源:', live.name, 'url:', live.url)
          loadLiveByUrl(live.url, live.name)
          loadingRef.current = false
          return
        }
      }

      if (!otherFetchingRef.current) {
        otherFetchingRef.current = true
        try {
          const configList = await configApi.list() as { url: string; name: string }[]
          for (const cfg of configList) {
            try {
              const res = await configApi.peekLives(cfg.url) as { success: boolean; data?: any[]; error?: string }
              if (res.success && res.data) {
                for (const live of res.data) {
                  if (live.name && live.url) {
                    otherQueueRef.current.push({ name: live.name, url: live.url })
                  }
                }
              }
            } catch {
              // 跳过失败的配置
            }
          }
        } catch (err) {
          console.error('[Live] 获取其他配置失败:', err)
        }
        otherFetchingRef.current = false

        while (otherQueueRef.current.length > 0) {
          const live = otherQueueRef.current.shift()!
          if (live.name && live.url) {
            console.log('[Live] 尝试其他配置直播源:', live.name, 'url:', live.url)
            loadLiveByUrl(live.url, live.name)
            loadingRef.current = false
            return
          }
        }
      }

      console.log('[Live] 所有配置的直播源均不可用')
      hasLoadedRef.current = true
      loadingRef.current = false
    }

    tryNext()
  }, [livesConfig, livesConfig?.lives, groups.length, isLoading, error])

  useEffect(() => {
    if (currentChannel && currentChannel.urls.length > 0) {
      play(currentChannel.urls[0])
    }
  }, [currentChannel])

  useEffect(() => {
    if (currentChannel?.epgId) {
      fetchEpg('', currentChannel.epgId)
    }
  }, [currentChannel])

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

  const handleChannelClick = (channel: any) => {
    switchChannel({
      name: channel.name,
      urls: channel.urls,
      number: channel.number,
      logo: channel.logo,
      format: channel.format,
      epgId: channel.epgId
    })
  }

  // 只展示频道树中已验证可用的频道
  const verifiedChannelNames = new Set<string>()
  if (channelTree) {
    for (const country of channelTree.countries) {
      for (const category of country.categories) {
        for (const ch of category.channels) {
          verifiedChannelNames.add(ch.name)
        }
      }
    }
  }

  const filteredChannels = searchKeyword
    ? channels.filter((c) => c.name.toLowerCase().includes(searchKeyword.toLowerCase()) && (verifiedChannelNames.size === 0 || verifiedChannelNames.has(c.name)))
    : channels.filter((c) => verifiedChannelNames.size === 0 || verifiedChannelNames.has(c.name))

  const filteredGroups = searchKeyword
    ? groups.map((g) => ({
        ...g,
        channels: g.channels.filter((c) => c.name.toLowerCase().includes(searchKeyword.toLowerCase()) && (verifiedChannelNames.size === 0 || verifiedChannelNames.has(c.name)))
      })).filter((g) => g.channels.length > 0)
    : groups.map((g) => ({
        ...g,
        channels: g.channels.filter((c) => verifiedChannelNames.size === 0 || verifiedChannelNames.has(c.name))
      })).filter((g) => g.channels.length > 0)

  const displayChannels = searchKeyword
    ? filteredGroups.flatMap((g) => g.channels)
    : filteredChannels

  const handleRetry = () => {
    hasLoadedRef.current = false
    triedIndexRef.current = 0
    otherQueueRef.current = []
    otherFetchingRef.current = false
    loadingRef.current = false
    loadLiveByUrl(livesConfig?.lives?.[0]?.url || '', livesConfig?.lives?.[0]?.name)
  }

  return (
    <div className="h-full flex flex-col">
      {/* 主内容区 */}
      <div className="flex-1 flex">
        {/* 左侧 - 频道树 */}
        <div className="w-56 shrink-0 border-r border-[#2a2a2a] flex flex-col">
          <div className="px-3 py-2 border-b border-[#2a2a2a]">
            <span className="text-xs text-text-secondary font-medium">
              {searchKeyword ? `搜索: ${searchKeyword}` : currentGroup || '频道列表'}
            </span>
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

          {/* 树形展示或传统列表 */}
          {channelTree && channelTree.countries.length > 0 ? (
            <LiveTree
              tree={channelTree}
              onChannelClick={handleChannelClick}
              currentChannelName={currentChannel?.name}
            />
          ) : (
            /* 传统列表展示（无树形数据时） */
            <div className="flex-1 overflow-y-auto scrollbar-dark py-1">
              {displayChannels.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-text-muted text-xs">
                  {searchKeyword ? '未找到匹配频道' : '暂无可用频道'}
                </div>
              ) : (
                displayChannels.map((channel) => (
                  <ChannelItem
                    key={channel.name}
                    channel={channel}
                    isActive={currentChannel?.name === channel.name}
                    onClick={(ch) => switchChannel(ch)}
                  />
                ))
              )}
            </div>
          )}
        </div>

        {/* 右侧 - 播放器 */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 bg-black relative">
            {currentChannel ? (
              <VideoPlayer />
            ) : (
              <div className="h-full flex items-center justify-center text-text-muted text-sm">
                {isLoading ? '加载频道中...' : error || '请选择频道'}
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
