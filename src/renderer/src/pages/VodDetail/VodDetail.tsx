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
import { getPlayableMediaUrl } from '@/utils/media'
import VideoPlayer from '@/components/VideoPlayer/VideoPlayer'
import type { History as HistoryItem } from '@shared/types'

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

function formatResumeTime(seconds = 0): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const h = Math.floor(safeSeconds / 3600)
  const m = Math.floor((safeSeconds % 3600) / 60)
  const s = safeSeconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function canResume(history: HistoryItem | null): history is HistoryItem {
  return Boolean(history && !history.completed && (history.positionSeconds || 0) > 5)
}

export default function VodDetail() {
  const { siteKey, vodId } = useParams<{ siteKey: string; vodId: string }>()
  const { currentConfig } = useConfigStore()
  const {
    currentVod, episodes, currentEpisodeIndex, currentSourceIndex,
    setVod, setCurrentEpisodeIndex, setCurrentSourceIndex,
    alternativeSources, sourceSwitchState, sourceSwitchMessage, autoSwitchSource,
    setAlternativeSources, markCurrentSourceBroken,
    setSourceSwitchState, popNextAlternativeSource,
    pickAlternativeSource, resetSourceSwitch,
    setPlaybackPhase, setPlaybackError
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
  const [resumeHistory, setResumeHistory] = useState<HistoryItem | null>(null)

  // 当前正在播放的源信息
  const [currentPlaySource, setCurrentPlaySource] = useState<{ siteKey: string; vodId: string } | null>(null)

  const switchingRef = useRef(false)
  const failureHandledRef = useRef(false)
  const mountedRef = useRef(true)
  const activeLine = lineSources[activeLineIndex]

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
    setResumeHistory(null)
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
      let savedHistory: HistoryItem | null = null
      try {
        const historyList = (await historyApi.list()) as HistoryItem[]
        savedHistory = historyList.find((item) => item.siteKey === sKey && item.vodId === vId) || null
        setResumeHistory(savedHistory)
      } catch {
        setResumeHistory(null)
      }

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
      // 优先选择含直链标识的线路（m3u8/mp4/mpd 等）
      const bestLineIdx = parsedLines.findIndex((l) =>
        /m3u8|mp4|mpd|flv|ts/i.test(l.name) && l.episodes.length > 0
      )
      const resumeLineIdx = canResume(savedHistory)
        ? Math.min(Math.max(savedHistory.sourceIndex || 0, 0), Math.max(0, parsedLines.length - 1))
        : -1
      setActiveLineIndex(resumeLineIdx >= 0 ? resumeLineIdx : bestLineIdx >= 0 ? bestLineIdx : 0)
      setIsLoading(false)
    } catch (err: any) {
      setLoadError(err?.message || '加载失败')
      setIsLoading(false)
    }
  }

  // 检查收藏
  useEffect(() => {
    if (!vodId || !siteKey) return
    keepApi.list().then((list: Array<{ siteKey: string; vodId: string }>) => {
      setIsKept(list.some((item) => item.siteKey === siteKey && item.vodId === vodId))
    })
  }, [siteKey, vodId])

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

      // 在当前页面内加载新源的详情
      try {
        const res = await siteApi.detailContent(source.siteKey, [source.vodId]) as any
        const result = res.data || res
        const vod = result.list?.[0]
        if (!vod) {
          markCurrentSourceBroken(source.siteKey, source.vodId)
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
          markCurrentSourceBroken(source.siteKey, source.vodId)
          setSourceSwitchState('idle', '该源无播放数据')
          setTimeout(() => { if (mountedRef.current) setSourceSwitchState('idle', '') }, 2000)
          return
        }

        // 将新线路添加到线路列表
        const prevCount = lineSources.length
        setLineSources(prev => [...prev, ...newLines])
        const bestNewIdx = newLines.findIndex((l) => /m3u8|mp4|mpd|flv|ts/i.test(l.name) && l.episodes.length > 0)
        setActiveLineIndex(prevCount + (bestNewIdx >= 0 ? bestNewIdx : 0))
        setDetail(vod)
        setSourceSwitchState('idle', `已切换到「${source.siteName}」`)
        setTimeout(() => { if (mountedRef.current) setSourceSwitchState('idle', '') }, 2000)
      } catch (err) {
        markCurrentSourceBroken(source.siteKey, source.vodId)
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
      if (autoSwitch !== false && autoSwitchSource) {
        switchToNextSource()
      }
    }
    window.addEventListener('vod:playFailed', handlePlayFailed as EventListener)
    return () => {
      window.removeEventListener('vod:playFailed', handlePlayFailed as EventListener)
    }
  }, [autoSwitchSource, markCurrentSourceBroken, switchToNextSource])

  useEffect(() => {
    const handleRetry = () => {
      if (activeLine) handlePlay(activeLineIndex, currentEpisodeIndex || 0)
    }
    const handleNextSource = () => {
      void switchToNextSource()
    }
    window.addEventListener('player:retry', handleRetry)
    window.addEventListener('player:nextSource', handleNextSource)
    return () => {
      window.removeEventListener('player:retry', handleRetry)
      window.removeEventListener('player:nextSource', handleNextSource)
    }
  }, [activeLine, activeLineIndex, currentEpisodeIndex, switchToNextSource])

  // 播放集数
  const handlePlay = async (lineIdx: number, epIdx: number, startPositionSeconds = 0) => {
    const line = lineSources[lineIdx]
    if (!line || !line.episodes[epIdx]) return

    window.dispatchEvent(new Event('player:flushHistory'))
    setIsResolving(true)
    setPlaybackPhase('resolving', '正在获取播放信息...')
    setCurrentSourceIndex(lineIdx)
    setAllSourcesExhausted(false)
    setLoadError(null)
    failureHandledRef.current = false

    const episode = line.episodes[epIdx]
    const targetDetail = detail
    const targetSiteKey = line.siteKey
    const targetVodId = line.vodId

    try {
      const playerRes = await siteApi.playerContent(line.siteKey, line.name, episode.url, [])
      const playerResult = playerRes.data || playerRes
      setPlaybackPhase('resolving', '正在判断播放地址...')

      let initialUrl = ''
      let initialHeader: Record<string, string> | undefined = playerResult.header

      // 尝试从 playerContent 结果中提取可播放的 URL
      if (playerResult.playUrl && isVideoFormat(playerResult.playUrl)) {
        initialUrl = playerResult.playUrl
      } else if (playerResult.url && isVideoFormat(playerResult.url)) {
        initialUrl = playerResult.url
      } else if (playerResult.playUrl && playerResult.url) {
        initialUrl = playerResult.playUrl + playerResult.url
      } else if (playerResult.url) {
        initialUrl = playerResult.url
      }

      setIsResolving(false)

      if (initialUrl && isVideoFormat(initialUrl)) {
        // 直接可播放，立即开始
        setPlaybackPhase('connecting', '正在连接播放地址...')
        const playableUrl = await getPlayableMediaUrl(initialUrl, initialHeader)
        setCurrentPlaySource({ siteKey: targetSiteKey, vodId: targetVodId })
        setVod(targetDetail!, line.episodes, lineIdx, playableUrl, initialHeader, targetSiteKey, line.name, startPositionSeconds)
        setCurrentEpisodeIndex(epIdx, playableUrl, startPositionSeconds)
        setShowPlayer(true)
      } else {
        // 需要解析，先展示播放器加载态
        setCurrentPlaySource({ siteKey: targetSiteKey, vodId: targetVodId })
        setShowPlayer(true)
        setPlaybackPhase('resolving', '正在解析播放地址...')
        setVod(targetDetail!, line.episodes, lineIdx, '__resolving__', initialHeader, targetSiteKey, line.name, startPositionSeconds)

        // 异步解析
        try {
          const parseRes = await siteApi.superParse({
            url: episode.url,
            flag: line.name,
            siteKey: targetSiteKey,
            playerResult
          })

          if (parseRes.success && parseRes.data.url) {
            setPlaybackPhase('connecting', '解析成功，正在连接...')
            const url = await getPlayableMediaUrl(
              parseRes.data.url,
              parseRes.data.header || initialHeader
            )
            const header = parseRes.data.header || initialHeader
            const store = usePlayerStore.getState()
            setCurrentEpisodeIndex(epIdx, url, startPositionSeconds)
            store.play(url)
            if (startPositionSeconds > 0) store.setCurrentTime(startPositionSeconds)
          } else {
            // 所有解析都失败
            setPlaybackError(parseRes.error || '解析失败：未找到可播放地址', {
              stage: 'parse',
              errorKind: 'parse_failed',
              protocol: 'unknown',
              sourceId: `${targetSiteKey}::${targetVodId}`,
              nextAction: autoSwitchSource ? '自动尝试下一个备选源' : '可手动切换线路或重试当前集'
            })
            window.dispatchEvent(new CustomEvent('vod:playFailed', {
              detail: { siteKey: targetSiteKey, vodId: targetVodId, reason: '解析失败：未找到可播放地址', autoSwitch: true }
            }))
          }
        } catch {
          setPlaybackError('解析异常：无法完成播放地址解析', {
            stage: 'parse',
            errorKind: 'parse_failed',
            protocol: 'unknown',
            sourceId: `${targetSiteKey}::${targetVodId}`,
            nextAction: autoSwitchSource ? '自动尝试下一个备选源' : '可手动切换线路或重试当前集'
          })
          window.dispatchEvent(new CustomEvent('vod:playFailed', {
            detail: { siteKey: targetSiteKey, vodId: targetVodId, reason: '解析异常：无法完成播放地址解析', autoSwitch: true }
          }))
        }
      }

      // 搜索备选源
      if (targetDetail?.vod_name && line.isCurrent) {
        fetchAlternativeSources(targetDetail.vod_name)
      }

      historyApi.add({
        vodId: targetVodId,
        siteKey: targetSiteKey,
        vodName: targetDetail?.vod_name || '',
        vodPic: targetDetail?.vod_pic,
        vodRemarks: targetDetail?.vod_remarks,
        source: episode.name ? `${line.name} · ${episode.name}` : line.name,
        progress: startPositionSeconds > 0 && resumeHistory?.duration
          ? Math.max(0, Math.min(100, Math.round((startPositionSeconds / resumeHistory.duration) * 100)))
          : 0,
        episodeId: String(epIdx),
        episodeName: episode.name || `第 ${epIdx + 1} 集`,
        episodeIndex: epIdx,
        sourceIndex: lineIdx,
        sourceName: line.name,
        urlIdentifier: episode.url.split('?')[0].slice(0, 240),
        duration: resumeHistory?.duration || 0,
        positionSeconds: startPositionSeconds,
        completed: false
      }).catch(() => {})
    } catch (err: any) {
      setIsResolving(false)
      setLoadError(err?.message || '获取播放信息失败')
      setPlaybackError(err?.message || '获取播放信息失败', {
        stage: 'connect',
        errorKind: 'unknown',
        protocol: 'unknown',
        sourceId: `${targetSiteKey}::${targetVodId}`,
        nextAction: autoSwitchSource ? '自动尝试下一个备选源' : '可手动切换线路或重试当前集'
      })
      window.dispatchEvent(new CustomEvent('vod:playFailed', {
        detail: { siteKey: targetSiteKey, vodId: targetVodId, reason: 'playerContent 失败', autoSwitch: true }
      }))
    }
  }

  // 收藏
  const handleToggleKeep = async () => {
    if (!detail || !vodId || !siteKey) return
    if (isKept) {
      await keepApi.delete(siteKey, vodId)
      setIsKept(false)
    } else {
      await keepApi.add({
        vodId,
        siteKey,
        vodName: detail.vod_name,
        vodPic: detail.vod_pic
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

  const resumeLineIndex = canResume(resumeHistory)
    ? Math.min(Math.max(resumeHistory.sourceIndex || 0, 0), Math.max(0, lineSources.length - 1))
    : -1
  const resumeEpisodeIndex = canResume(resumeHistory)
    ? Math.min(
        Math.max(resumeHistory.episodeIndex || 0, 0),
        Math.max(0, (lineSources[resumeLineIndex]?.episodes.length || 1) - 1)
      )
    : -1
  const resumeEpisodeName = resumeEpisodeIndex >= 0
    ? lineSources[resumeLineIndex]?.episodes[resumeEpisodeIndex]?.name || resumeHistory?.episodeName
    : ''

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

      {/* 换源状态栏 */}
      {(sourceSwitchState !== 'idle' || sourceSwitchMessage) && (
        <div className="flex items-center gap-2 px-4 py-2 bg-bg-secondary border-b border-[#2a2a2a] text-xs">
          {sourceSwitchState === 'searching' || sourceSwitchState === 'switching' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent shrink-0" />
          ) : (
            <Globe className="w-3.5 h-3.5 text-text-muted shrink-0" />
          )}
          <span className="text-text-secondary truncate">{sourceSwitchMessage || '加载中...'}</span>
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
              {canResume(resumeHistory) && resumeLineIndex >= 0 && resumeEpisodeIndex >= 0 && (
                <button
                  onClick={() => handlePlay(resumeLineIndex, resumeEpisodeIndex, resumeHistory.positionSeconds || 0)}
                  disabled={isResolving || lineSources.length === 0}
                  className="flex items-center gap-2 px-5 py-2 bg-accent hover:bg-accent-hover text-bg-primary rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isResolving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  继续 {resumeEpisodeName || resumeHistory.episodeName || '上次观看'} · {formatResumeTime(resumeHistory.positionSeconds)}
                </button>
              )}
              <button
                onClick={() => {
                  if (activeLine) handlePlay(activeLineIndex, currentEpisodeIndex || 0)
                }}
                disabled={isResolving || lineSources.length === 0}
                className={`flex items-center gap-2 px-5 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  canResume(resumeHistory)
                    ? 'border border-[#2a2a2a] text-text-secondary hover:text-accent hover:border-accent'
                    : 'bg-accent hover:bg-accent-hover text-bg-primary'
                }`}
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
