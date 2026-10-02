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
import { isResumable, pickResumeTarget, resumePositionForEpisode } from '@/utils/resume'
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
  flag?: string
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
  return isResumable(history)
}

export default function VodDetail() {
  const { siteKey, vodId } = useParams<{ siteKey: string; vodId: string }>()
  const { currentConfig } = useConfigStore()
  const {
    currentVod, episodes, currentEpisodeIndex, currentSourceIndex,
    currentTime: playerCurrentTime, currentUrl: playerCurrentUrl, currentSiteKey: playerCurrentSiteKey,
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
  const [pendingAutoPlay, setPendingAutoPlay] = useState<number | null>(null)
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
  const playRequestRef = useRef(0)
  const activeLine = lineSources[activeLineIndex]

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; playRequestRef.current += 1 }
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
            switchingRef.current = false
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
              flag: from,
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
        const nextLineIndex = prevCount + (bestNewIdx >= 0 ? bestNewIdx : 0)
        setActiveLineIndex(nextLineIndex)
        setPendingAutoPlay(nextLineIndex)
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

  // 用户手动点选一个备选源（以前 UI 只显示数量，pickAlternativeSource 从未被调用）
  const handlePickAlternative = useCallback(
    async (index: number) => {
      const picked = pickAlternativeSource(index)
      if (!picked) return
      await switchToAlternativeSource(picked)
    },
    [pickAlternativeSource, switchToAlternativeSource]
  )

  // 播放失败处理（供本页直接用，也供播放器信号触发）
  const handleVodPlayFailed = useCallback((failedSiteKey?: string, failedVodId?: string, autoSwitch?: boolean) => {
    if (failureHandledRef.current) return
    failureHandledRef.current = true
    if (failedSiteKey && failedVodId) {
      markCurrentSourceBroken(failedSiteKey, failedVodId)
    }
    setTimeout(() => { failureHandledRef.current = false }, 1000)
    if (autoSwitch !== false && autoSwitchSource) {
      void switchToNextSource()
    }
  }, [autoSwitchSource, markCurrentSourceBroken, switchToNextSource])

  // 播放器信号（显式状态，替代 window 事件）
  const playerSignal = usePlayerStore((state) => state.playerSignal)
  const playerSignalToken = playerSignal?.token ?? 0
  // 信号放在 store 里不会自动消失：挂载时先记下当前 token，避免把旧信号当新信号再处理一次
  const handledSignalRef = useRef(usePlayerStore.getState().playerSignal?.token ?? 0)
  useEffect(() => {
    if (playerSignalToken === handledSignalRef.current) return
    handledSignalRef.current = playerSignalToken
    if (!playerSignal || playerSignal.scope !== 'vod') return
    if (playerSignal.type === 'playFailed') {
      handleVodPlayFailed(playerSignal.siteKey, playerSignal.vodId, playerSignal.autoSwitch)
    } else if (playerSignal.type === 'retry') {
      if (activeLine) {
        void handlePlay(activeLineIndex, currentEpisodeIndex || 0, currentPlaybackPosition())
      }
    } else if (playerSignal.type === 'nextSource') {
      void switchToNextSource()
    }
  }, [playerSignalToken, playerSignal, handleVodPlayFailed, activeLine, activeLineIndex, currentEpisodeIndex, switchToNextSource])

  // 播放集数
  const handlePlay = async (lineIdx: number, epIdx: number, startPositionSeconds = 0) => {
    const line = lineSources[lineIdx]
    if (!line || !line.episodes[epIdx]) return
    const requestId = ++playRequestRef.current
    const subscription = useConfigStore.getState().configUrl
    const isCurrentRequest = () => mountedRef.current && requestId === playRequestRef.current && subscription === useConfigStore.getState().configUrl

    usePlayerStore.getState().sendPlayerSignal({ type: 'flushHistory', scope: 'vod' })
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
      const playerRes = await siteApi.playerContent(line.siteKey, line.flag ?? line.name, episode.url, [])
      if (!isCurrentRequest()) return
      if (playerRes.success === false) throw new Error(playerRes.error || '获取播放信息失败')
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
        if (!isCurrentRequest()) return
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
            flag: line.flag ?? line.name,
            siteKey: targetSiteKey,
            playerResult
          })
          if (!isCurrentRequest()) return

          if (parseRes.success && parseRes.data.url) {
            setPlaybackPhase('connecting', '解析成功，正在连接...')
            const url = await getPlayableMediaUrl(
              parseRes.data.url,
              parseRes.data.header || initialHeader
            )
            if (!isCurrentRequest()) return
            const header = parseRes.data.header || initialHeader
            const store = usePlayerStore.getState()
            usePlayerStore.setState({ playHeader: header || null })
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
            handleVodPlayFailed(targetSiteKey, targetVodId, true)
          }
        } catch {
          if (!isCurrentRequest()) return
          setPlaybackError('解析异常：无法完成播放地址解析', {
            stage: 'parse',
            errorKind: 'parse_failed',
            protocol: 'unknown',
            sourceId: `${targetSiteKey}::${targetVodId}`,
            nextAction: autoSwitchSource ? '自动尝试下一个备选源' : '可手动切换线路或重试当前集'
          })
          handleVodPlayFailed(targetSiteKey, targetVodId, true)
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
      if (!isCurrentRequest()) return
      setIsResolving(false)
      setLoadError(err?.message || '获取播放信息失败')
      setPlaybackError(err?.message || '获取播放信息失败', {
        stage: 'connect',
        errorKind: 'unknown',
        protocol: 'unknown',
        sourceId: `${targetSiteKey}::${targetVodId}`,
        nextAction: autoSwitchSource ? '自动尝试下一个备选源' : '可手动切换线路或重试当前集'
      })
      handleVodPlayFailed(targetSiteKey, targetVodId, true)
    }
  }

  useEffect(() => {
    if (pendingAutoPlay === null || !lineSources[pendingAutoPlay]) return
    setPendingAutoPlay(null)
    void handlePlay(pendingAutoPlay, 0)
  }, [pendingAutoPlay, lineSources])

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

  // 断点续播：本次会话已开播则以播放器实时状态为准，否则回到历史那一集和进度
  const activeEpisodeCount = activeLine?.episodes.length || 0
  const sessionActive = Boolean(
    playerCurrentUrl &&
    playerCurrentUrl !== '__resolving__' &&
    currentVod &&
    String(currentVod.vod_id) === String(vodId) &&
    (!playerCurrentSiteKey || playerCurrentSiteKey === siteKey)
  )
  const playTarget = pickResumeTarget({
    history: resumeHistory,
    sessionActive,
    sessionEpisodeIndex: currentEpisodeIndex || 0,
    sessionPositionSeconds: playerCurrentTime || 0,
    episodeCount: activeEpisodeCount,
    activeLineIsHistory: activeLineIndex === resumeLineIndex
  })
  const highlightEpisodeIndex = showPlayer
    ? currentEpisodeIndex
    : canResume(resumeHistory) || sessionActive
      ? playTarget.episodeIndex
      : -1
  /** 重试当前集时保留已看进度，避免把历史位置写成 0 */
  const currentPlaybackPosition = () => {
    const live = usePlayerStore.getState().currentTime || 0
    return live > 3 ? Math.round(live) : 0
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-dark">
      {/* 播放器 */}
      {showPlayer && (
        <div className="relative aspect-video bg-black">
          <VideoPlayer
            onSelectEpisode={(index) =>
              void handlePlay(
                currentSourceIndex,
                index,
                resumePositionForEpisode(resumeHistory, currentSourceIndex, index, resumeLineIndex, resumeEpisodeIndex)
              )
            }
          />
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
                    if (activeLine) handlePlay(activeLineIndex, currentEpisodeIndex || 0, currentPlaybackPosition())
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

      <div className="p-4 nav:p-6">
        {/* 详情信息 */}
        <div className="flex flex-col nav:flex-row gap-4 nav:gap-6">
          <div className="shrink-0 w-32 nav:w-48 self-center nav:self-auto">
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
                  if (activeLine) handlePlay(activeLineIndex, playTarget.episodeIndex, playTarget.positionSeconds)
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
                  {alternativeSources.length} 个备选源（可在下方直接切换）
                </span>
              )}
            </div>

            {/* 备选源：一字排开，点了就切（原来只显示"N 个备选源"这个数字，没有列表也切不了） */}
            {(alternativeSources.length > 0 || sourceSwitchState === 'searching') && (
              <div className="mb-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-xs text-text-muted">其他站点的同名片源</span>
                  {sourceSwitchState === 'searching' && (
                    <span className="flex items-center gap-1 text-[11px] text-text-muted">
                      <Loader2 className="h-3 w-3 animate-spin" /> 搜索中
                    </span>
                  )}
                  <button
                    onClick={() => detail?.vod_name && void fetchAlternativeSources(detail.vod_name)}
                    disabled={sourceSwitchState !== 'idle' || !detail?.vod_name}
                    className="ml-auto flex items-center gap-1 text-[11px] text-text-muted transition-colors hover:text-accent disabled:opacity-50"
                    title="重新搜索其他站点的同名片源"
                  >
                    <RefreshCw className="h-3 w-3" /> 重新搜索
                  </button>
                </div>
                <div className="flex gap-2 overflow-x-auto scrollbar-dark pb-1">
                  {alternativeSources.map((source, index) => (
                    <button
                      key={`${source.siteKey}:${source.vodId}`}
                      onClick={() => void handlePickAlternative(index)}
                      disabled={sourceSwitchState === 'switching'}
                      title={`${source.siteName} · ${source.vodName}${source.vodRemarks ? ` · ${source.vodRemarks}` : ''}（点击切换）`}
                      className="shrink-0 max-w-[220px] truncate rounded-md bg-bg-tertiary px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                    >
                      <span className="font-medium text-text-primary">{source.siteName}</span>
                      {source.vodRemarks && <span className="ml-1 text-text-muted">{source.vodRemarks}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

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
                    key={ep.url}
                    onClick={() =>
                      handlePlay(
                        activeLineIndex,
                        idx,
                        resumePositionForEpisode(resumeHistory, activeLineIndex, idx, resumeLineIndex, resumeEpisodeIndex)
                      )
                    }
                    disabled={isResolving}
                    className={`px-2 py-1.5 text-xs rounded-md truncate transition-colors disabled:opacity-50 ${
                      highlightEpisodeIndex === idx
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
