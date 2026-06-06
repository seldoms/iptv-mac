import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Heart, Play, ArrowLeft, Loader2, RefreshCw, Globe, AlertCircle, RotateCw } from 'lucide-react'
import { useConfigStore } from '@/stores/useConfigStore'
import {
  usePlayerStore,
  VodDetail as VodDetailType,
  Episode,
  AlternativeSource
} from '@/stores/usePlayerStore'
import { historyApi, keepApi, siteApi } from '@/utils/ipc'
import VideoPlayer from '@/components/VideoPlayer/VideoPlayer'

/** 判断 URL 是否为视频流格式 */
function isVideoFormat(url: string): boolean {
  if (!url) return false
  return /\.m3u8(\?|$)|\.mp4(\?|$)|\.mpd(\?|$)|\.flv(\?|$)|\.ts(\?|$)|rtmp:\/\//i.test(url) ||
         /\/m3u8\?|\/playlist\.m3u8|\/index\.m3u8/i.test(url) ||
         /^https?:\/\/[^/]+\/.+\.(m3u8|mp4|flv|ts|mpd)(\?|$)/i.test(url)
}

interface LineSource {
  key: string         // 唯一标识: siteKey::vodId 或 'current::siteKey::vodId'
  name: string        // 站点名或线路名
  siteKey: string
  vodId: string
  episodes: Episode[]
  isCurrent: boolean  // 是否为当前页面加载的源
}

export default function VodDetail() {
  const { siteKey, vodId } = useParams<{ siteKey: string; vodId: string }>()
  const { currentConfig } = useConfigStore()
  const {
    currentVod, episodes, currentEpisodeIndex, currentSourceIndex,
    setVod, setCurrentEpisodeIndex, setCurrentSourceIndex,
    alternativeSources, sourceSwitchState, sourceSwitchMessage,
    setAlternativeSources, markCurrentSourceBroken,
    setSourceSwitchState, popNextAlternativeSource,
    pickAlternativeSource, resetSourceSwitch
  } = usePlayerStore()

  const [detail, setDetail] = useState<VodDetailType | null>(null)
  const [lineSources, setLineSources] = useState<LineSource[]>([])
  const [activeLineIndex, setActiveLineIndex] = useState(0)
  const [isKept, setIsKept] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [showPlayer, setShowPlayer] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const [allSourcesExhausted, setAllSourcesExhausted] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // 当前正在播放的源信息
  const [currentPlaySource, setCurrentPlaySource] = useState<{ siteKey: string; vodId: string } | null>(null)

  const switchingRef = useRef(false)
  const failureHandledRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // 加载详情
  useEffect(() => {
    if (!siteKey || !vodId) return
    setIsLoading(true)
    setLoadError(null)
    setAllSourcesExhausted(false)
    failureHandledRef.current = false
    resetSourceSwitch()

    loadVodDetail(siteKey, vodId)
  }, [siteKey, vodId])

  const loadVodDetail = async (sKey: string, vId: string) => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const res = await siteApi.detailContent(sKey, [vId]) as any
      const result = res.data || res
      const vod = result.list?.[0]
      if (!vod) {
        setLoadError('未找到该影片')
        setIsLoading(false)
        return
      }
      setDetail(vod)

      // 解析播放源和集数
      const playFroms = (vod.vod_play_from || '').split('$$$').filter(Boolean)
      const urlGroups = (vod.vod_play_url || '').split('$$$')
      const parsedLines: LineSource[] = []

      if (playFroms.length > 0) {
        playFroms.forEach((from: string, idx: number) => {
          const eps = (urlGroups[idx] || '')
            .split('#')
            .filter(Boolean)
            .map((ep: string) => {
              const dollarIdx = ep.indexOf('$')
              const name = dollarIdx >= 0 ? ep.substring(0, dollarIdx) : ''
              const url = dollarIdx >= 0 ? ep.substring(dollarIdx + 1) : ep
              return { name, url }
            })
          parsedLines.push({
            key: `current::${sKey}::${vId}::${from}`,
            name: from,
            siteKey: sKey,
            vodId: vId,
            episodes: eps,
            isCurrent: true
          })
        })
      } else {
        const eps = (vod.vod_play_url || '')
          .split('#')
          .filter(Boolean)
          .map((ep: string) => {
            const dollarIdx = ep.indexOf('$')
            const name = dollarIdx >= 0 ? ep.substring(0, dollarIdx) : ''
            const url = dollarIdx >= 0 ? ep.substring(dollarIdx + 1) : ep
            return { name, url }
          })
        if (eps.length > 0) {
          parsedLines.push({
            key: `current::${sKey}::${vId}`,
            name: '默认',
            siteKey: sKey,
            vodId: vId,
            episodes: eps,
            isCurrent: true
          })
        }
      }

      setLineSources(parsedLines)
      setActiveLineIndex(0)
      setIsLoading(false)
    } catch (err: any) {
      setLoadError(err?.message || '加载失败')
      setIsLoading(false)
    }
  }

  // 检查收藏
  useEffect(() => {
    if (!vodId) return
    keepApi.list().then((list: any[]) => {
      setIsKept(list.some((item) => item.vod_id === vodId))
    })
  }, [vodId])

  // ==================== 换源机制 ====================
  // 搜索所有站点的同名 VOD，构建备选源队列
  const fetchAlternativeSources = useCallback(async (keyword: string) => {
    if (!keyword || !siteKey || !vodId) return
    setSourceSwitchState('searching', `正在搜索「${keyword}」的其他站点...`)
    try {
      const res = await siteApi.findAcrossSites(keyword, {
        excludeSiteKey: siteKey,
        excludeVodId: vodId,
        limit: 20,
        timeoutMs: 8000
      })
      if (!mountedRef.current) return
      if (res.success && res.data) {
        const sources = res.data as AlternativeSource[]
        setAlternativeSources(sources)
        if (sources.length === 0) {
          setSourceSwitchState('idle', '没有找到其他站点的同名资源')
        } else {
          setSourceSwitchState('idle', `已找到 ${sources.length} 个备选源`)
        }
        setTimeout(() => { if (mountedRef.current) setSourceSwitchState('idle', '') }, 3000)
      } else {
        setSourceSwitchState('idle', `搜索失败: ${res.error || '未知'}`)
        setTimeout(() => { if (mountedRef.current) setSourceSwitchState('idle', '') }, 3000)
      }
    } catch (err) {
      setSourceSwitchState('idle', '跨站搜索异常')
      setTimeout(() => { if (mountedRef.current) setSourceSwitchState('idle', '') }, 3000)
    }
  }, [siteKey, vodId, setAlternativeSources, setSourceSwitchState])

  // 切换到一个备选源（在当前页面内加载，不导航）
  const switchToAlternativeSource = useCallback(async (source: AlternativeSource) => {
    if (switchingRef.current) return
    switchingRef.current = true
    try {
      setSourceSwitchState('switching', `正在加载「${source.siteName}」...`)
      markCurrentSourceBroken(source.siteKey, source.vodId)

      // 在当前页面内加载新源的详情
      try {
        const res = await siteApi.detailContent(source.siteKey, [source.vodId]) as any
        const result = res.data || res
        const vod = result.list?.[0]
        if (!vod) {
          setSourceSwitchState('idle', '加载失败，尝试下一个...')
          setTimeout(() => { if (mountedRef.current) setSourceSwitchState('idle', '') }, 2000)
          // 尝试队列中的下一个
          const next = popNextAlternativeSource()
          if (next) {
            await switchToAlternativeSource(next)
          } else {
            setAllSourcesExhausted(true)
          }
          return
        }

        // 解析集数
        const playFroms = (vod.vod_play_from || '').split('$$$').filter(Boolean)
        const urlGroups = (vod.vod_play_url || '').split('$$$')
        const newLines: LineSource[] = []

        if (playFroms.length > 0) {
          playFroms.forEach((from: string, idx: number) => {
            const eps = (urlGroups[idx] || '')
              .split('#')
              .filter(Boolean)
              .map((ep: string) => {
                const dollarIdx = ep.indexOf('$')
                const name = dollarIdx >= 0 ? ep.substring(0, dollarIdx) : ''
                const url = dollarIdx >= 0 ? ep.substring(dollarIdx + 1) : ep
                return { name, url }
              })
            newLines.push({
              key: `alt::${source.siteKey}::${source.vodId}::${from}`,
              name: `${source.siteName} · ${from}`,
              siteKey: source.siteKey,
              vodId: source.vodId,
              episodes: eps,
              isCurrent: false
            })
          })
        } else {
          const eps = (vod.vod_play_url || '')
            .split('#')
            .filter(Boolean)
            .map((ep: string) => {
              const dollarIdx = ep.indexOf('$')
              const name = dollarIdx >= 0 ? ep.substring(0, dollarIdx) : ''
              const url = dollarIdx >= 0 ? ep.substring(dollarIdx + 1) : ep
              return { name, url }
            })
          if (eps.length > 0) {
            newLines.push({
              key: `alt::${source.siteKey}::${source.vodId}`,
              name: source.siteName,
              siteKey: source.siteKey,
              vodId: source.vodId,
              episodes: eps,
              isCurrent: false
            })
          }
        }

        if (newLines.length === 0) {
          setSourceSwitchState('idle', '该源无播放数据')
          setTimeout(() => { if (mountedRef.current) setSourceSwitchState('idle', '') }, 2000)
          return
        }

        // 将新线路添加到线路列表
        setLineSources(prev => [...prev, ...newLines])
        setActiveLineIndex(lineSources.length) // 切换到新添加的第一个线路
        setDetail(vod)
        setSourceSwitchState('idle', `已切换到「${source.siteName}」`)
        setTimeout(() => { if (mountedRef.current) setSourceSwitchState('idle', '') }, 2000)
      } catch (err) {
        setSourceSwitchState('idle', '加载失败')
        setTimeout(() => { if (mountedRef.current) setSourceSwitchState('idle', '') }, 2000)
      }
    } finally {
      setTimeout(() => { switchingRef.current = false }, 500)
    }
  }, [lineSources.length, markCurrentSourceBroken, popNextAlternativeSource, setSourceSwitchState])

  // 切换到下一备选源
  const switchToNextSource = useCallback(async () => {
    if (switchingRef.current) return
    const next = popNextAlternativeSource()
    if (!next) {
      setAllSourcesExhausted(true)
      setSourceSwitchState('idle', '所有备选源都已尝试')
      setTimeout(() => { if (mountedRef.current) setSourceSwitchState('idle', '') }, 3000)
      return
    }
    await switchToAlternativeSource(next)
  }, [popNextAlternativeSource, setSourceSwitchState, switchToAlternativeSource])

  // 播放失败事件
  useEffect(() => {
    const handlePlayFailed = (event: CustomEvent) => {
      const { siteKey: failedSiteKey, vodId: failedVodId, autoSwitch } = event.detail || {}
      if (failureHandledRef.current) return
      failureHandledRef.current = true
      if (failedSiteKey && failedVodId) {
        markCurrentSourceBroken(failedSiteKey, failedVodId)
      }
      setTimeout(() => { failureHandledRef.current = false }, 1000)
      if (autoSwitch !== false) {
        switchToNextSource()
      }
    }
    window.addEventListener('vod:playFailed', handlePlayFailed as EventListener)
    return () => {
      window.removeEventListener('vod:playFailed', handlePlayFailed as EventListener)
    }
  }, [markCurrentSourceBroken, switchToNextSource])

  // 播放集数
  const handlePlay = async (lineIdx: number, epIdx: number) => {
    const line = lineSources[lineIdx]
    if (!line || !line.episodes[epIdx]) return

    setIsResolving(true)
    setCurrentSourceIndex(lineIdx)
    setAllSourcesExhausted(false)
    setLoadError(null)
    failureHandledRef.current = false

    const episode = line.episodes[epIdx]
    try {
      const playerRes = await siteApi.playerContent(line.siteKey, line.name, episode.url, [])
      const playerResult = playerRes.data || playerRes

      const parseRes = await siteApi.superParse({
        url: episode.url,
        flag: line.name,
        siteKey: line.siteKey,
        playerResult
      })

      let resolvedUrl = ''
      let resolvedHeader: Record<string, string> | undefined

      if (parseRes.success) {
        resolvedUrl = parseRes.data.url
        resolvedHeader = parseRes.data.header
      } else {
        if (playerResult.playUrl && isVideoFormat(playerResult.playUrl)) {
          resolvedUrl = playerResult.playUrl
          resolvedHeader = playerResult.header
        } else if (playerResult.url && isVideoFormat(playerResult.url)) {
          resolvedUrl = playerResult.url
          resolvedHeader = playerResult.header
        } else {
          setIsResolving(false)
          setLoadError('当前线路无法解析，将自动尝试其他源...')
          window.dispatchEvent(new CustomEvent('vod:playFailed', {
            detail: {
              siteKey: line.siteKey,
              vodId: line.vodId,
              reason: '解析完全失败',
              autoSwitch: true
            }
          }))
          return
        }
      }

      setCurrentPlaySource({ siteKey: line.siteKey, vodId: line.vodId })
      setVod(detail!, line.episodes, lineIdx, resolvedUrl, resolvedHeader, line.siteKey)
      setCurrentEpisodeIndex(epIdx, resolvedUrl)
      setShowPlayer(true)

      // 启动后立即异步搜索备选源
      if (detail?.vod_name && line.isCurrent) {
        fetchAlternativeSources(detail.vod_name)
      }
    } catch (err: any) {
      setIsResolving(false)
      setLoadError(err?.message || '获取播放信息失败')
      window.dispatchEvent(new CustomEvent('vod:playFailed', {
        detail: {
          siteKey: line.siteKey,
          vodId: line.vodId,
          reason: 'playerContent 失败',
          autoSwitch: true
        }
      }))
      return
    } finally {
      setIsResolving(false)
    }

    historyApi.add({
      vod_id: vodId,
      site_key: siteKey,
      vod_name: detail?.vod_name,
      vod_pic: detail?.vod_pic,
      source_name: line.name,
      episode_name: episode.name,
      episode_url: episode.url,
      position: 0,
      duration: 0,
      updated_at: Date.now()
    }).catch(() => {})
  }

  // 收藏
  const handleToggleKeep = async () => {
    if (!detail || !vodId || !siteKey) return
    if (isKept) {
      await keepApi.delete(vodId)
      setIsKept(false)
    } else {
      await keepApi.add({
        vod_id: vodId,
        site_key: siteKey,
        vod_name: detail.vod_name,
        vod_pic: detail.vod_pic,
        created_at: Date.now()
      })
      setIsKept(true)
    }
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (loadError && !detail) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
        <h2 className="text-lg font-semibold text-text-primary mb-2">无法加载详情</h2>
        <p className="text-sm text-text-muted mb-6">{loadError}</p>
        <div className="flex gap-3">
          <button
            onClick={() => window.history.back()}
            className="px-4 py-2 border border-[#2a2a2a] text-text-secondary rounded-lg hover:bg-bg-hover"
          >
            返回
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-accent text-bg-primary rounded-lg font-medium"
          >
            重新加载
          </button>
        </div>
      </div>
    )
  }

  const activeLine = lineSources[activeLineIndex]

  return (
    <div className="h-full overflow-y-auto scrollbar-dark">
      {/* 播放器 */}
      {showPlayer && (
        <div className="relative aspect-video bg-black">
          <VideoPlayer />
          <button
            onClick={() => setShowPlayer(false)}
            className="absolute top-3 left-3 z-30 p-2 bg-black/50 rounded-full text-white/80 hover:text-white"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          {/* 换源状态提示 */}
          {(sourceSwitchState !== 'idle' || sourceSwitchMessage) && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 bg-accent/90 text-bg-primary rounded-full text-xs font-medium flex items-center gap-2 shadow-lg max-w-[80%] truncate">
              {sourceSwitchState === 'searching' || sourceSwitchState === 'switching' ? (
                <Loader2 className="w-3 h-3 animate-spin shrink-0" />
              ) : (
                <Globe className="w-3 h-3 shrink-0" />
              )}
              <span className="truncate">{sourceSwitchMessage || '加载中...'}</span>
            </div>
          )}

          {/* 所有源耗尽 */}
          {allSourcesExhausted && (
            <div className="absolute inset-0 z-20 bg-black/85 flex flex-col items-center justify-center text-center p-6">
              <AlertCircle className="w-12 h-12 text-red-400 mb-3" />
              <h3 className="text-lg font-semibold text-white mb-2">所有源均不可用</h3>
              <p className="text-sm text-white/70 mb-4">已尝试多个源，仍然无法播放</p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (activeLine) handlePlay(activeLineIndex, currentEpisodeIndex || 0)
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-accent text-bg-primary rounded-lg font-medium hover:bg-accent-hover"
                >
                  <RotateCw className="w-4 h-4" />
                  重试当前
                </button>
                <button
                  onClick={switchToNextSource}
                  className="flex items-center gap-2 px-4 py-2 border border-white/30 text-white rounded-lg hover:bg-white/10"
                >
                  <RefreshCw className="w-4 h-4" />
                  切换其他源
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="p-6">
        {/* 详情信息 */}
        <div className="flex gap-6">
          <div className="shrink-0 w-48">
            <img
              src={detail?.vod_pic}
              alt={detail?.vod_name}
              className="w-full aspect-[2/3] object-cover rounded-lg bg-bg-tertiary"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold text-text-primary mb-3">
              {detail?.vod_name}
            </h1>
            <div className="space-y-1.5 text-sm text-text-secondary">
              {detail?.vod_year && <p>年份：{detail.vod_year}</p>}
              {detail?.vod_area && <p>地区：{detail.vod_area}</p>}
              {detail?.type_name && <p>类型：{detail.type_name}</p>}
              {detail?.vod_director && <p>导演：{detail.vod_director}</p>}
              {detail?.vod_actor && <p>演员：{detail.vod_actor}</p>}
            </div>
            <div className="flex gap-3 mt-4 flex-wrap">
              <button
                onClick={() => {
                  if (activeLine) handlePlay(activeLineIndex, currentEpisodeIndex || 0)
                }}
                disabled={isResolving || lineSources.length === 0}
                className="flex items-center gap-2 px-5 py-2 bg-accent hover:bg-accent-hover text-bg-primary rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isResolving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {isResolving ? '解析中...' : '播放'}
              </button>
              <button
                onClick={handleToggleKeep}
                className={`flex items-center gap-2 px-5 py-2 rounded-lg border transition-colors ${
                  isKept
                    ? 'border-accent text-accent bg-accent-muted'
                    : 'border-[#2a2a2a] text-text-secondary hover:text-accent hover:border-accent'
                }`}
              >
                <Heart className={`w-4 h-4 ${isKept ? 'fill-accent' : ''}`} />
                {isKept ? '已收藏' : '收藏'}
              </button>
            </div>
            {detail?.vod_content && (
              <p className="mt-4 text-sm text-text-muted leading-relaxed line-clamp-3">
                {detail.vod_content.replace(/<[^>]+>/g, '')}
              </p>
            )}
          </div>
        </div>

        {/* 多线路片源 Tab */}
        {lineSources.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-4 h-4 text-text-muted" />
              <span className="text-sm font-medium text-text-secondary">多线路片源</span>
              {alternativeSources.length > 0 && (
                <span className="text-xs text-text-muted ml-auto">
                  {alternativeSources.length} 个备选源
                </span>
              )}
            </div>

            {/* 线路 Tab 列表 */}
            <div className="flex gap-2 overflow-x-auto scrollbar-dark pb-1">
              {lineSources.map((line, idx) => (
                <button
                  key={line.key}
                  onClick={() => setActiveLineIndex(idx)}
                  className={`shrink-0 px-3 py-1.5 text-xs rounded-md transition-colors ${
                    activeLineIndex === idx
                      ? 'bg-accent/20 text-accent font-medium'
                      : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'
                  }`}
                >
                  {line.name}
                  <span className="ml-1 opacity-60">({line.episodes.length})</span>
                </button>
              ))}
            </div>

            {/* 当前线路的集数列表 */}
            {activeLine && (
              <div className="mt-3 grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-2">
                {activeLine.episodes.map((ep, idx) => (
                  <button
                    key={`${ep.name}-${idx}`}
                    onClick={() => handlePlay(activeLineIndex, idx)}
                    disabled={isResolving}
                    className={`px-2 py-1.5 text-xs rounded-md truncate transition-colors disabled:opacity-50 ${
                      showPlayer && currentEpisodeIndex === idx
                        ? 'bg-accent text-bg-primary font-medium'
                        : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                    }`}
                  >
                    {ep.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {lineSources.length === 0 && (
          <div className="mt-6 text-center py-8 text-text-muted">
            暂无播放源
          </div>
        )}
      </div>
    </div>
  )
}
