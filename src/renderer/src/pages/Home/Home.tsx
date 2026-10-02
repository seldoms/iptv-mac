import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Loader2, ArrowLeft } from 'lucide-react'
import { useConfigStore } from '@/stores/useConfigStore'
import { isSupportedContentSite } from '@/siteSupport'
import { historyApi } from '@/utils/ipc'
import ProgressLayout from '@/components/ProgressLayout/ProgressLayout'
import CategoryTabs from '@/components/CategoryTabs/CategoryTabs'
import FilterPanel from '@/components/FilterPanel/FilterPanel'
import HistoryCarousel from '@/components/HistoryCarousel/HistoryCarousel'
import VideoGrid from '@/components/VideoGrid/VideoGrid'
import ErrorBanner from '@/components/ErrorBanner/ErrorBanner'
import SiteDialog from '@/components/SiteDialog/SiteDialog'
import { useKeyboardNav, useRefreshCooldown } from '@/hooks/useKeyboardNav'
import type { History as HistoryItem } from '@shared/types'
import { DEFAULT_SOURCES } from '@/defaultSources'

function formatResumeTime(seconds = 0): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const h = Math.floor(safeSeconds / 3600)
  const m = Math.floor((safeSeconds % 3600) / 60)
  const s = safeSeconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function Home() {
  const navigate = useNavigate()
  const {
    currentConfig, sites, siteSpeeds, isStartupReady, currentSiteKey, contentSiteKey, pendingSiteKey, categories, filters, homeVideos,
    startupAttempt,
    categoryVideos, currentPage, hasMore, isLoading, error, liveConfig,
    switchSite, fetchCategoryContent, fetchHomeContent, loadConfig
  } = useConfigStore()

  // Site Dialog state
  const [showSiteDialog, setShowSiteDialog] = useState(false)

  // Category / filter state（放 store：从播放页返回时保持原来选中的标签）
  const activeCategory = useConfigStore((state) => state.activeCategory)
  const setActiveCategory = useConfigStore((state) => state.setActiveCategory)
  const selectedFilters = useConfigStore((state) => state.selectedFilters)
  const setSelectedFilters = useConfigStore((state) => state.setSelectedFilters)
  const [showFilterPanel, setShowFilterPanel] = useState(false)

  // Scroll state
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)

  // History state
  const [continueItems, setContinueItems] = useState<HistoryItem[]>([])

  // Loading state (for default source click)
  const [loadingSourceUrl, setLoadingSourceUrl] = useState('')

  // Refresh cooldown (FongMi pattern: 3s cooldown)
  const handleRefresh = useCallback(() => {
    fetchHomeContent()
    loadHistory()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSiteKey])
  const refreshWithCooldown = useRefreshCooldown(handleRefresh)

  const visibleSites = useMemo(() => sites.filter(isSupportedContentSite), [sites])

  // 所有非隐藏站点
  const allSites = useMemo(() => sites.filter((s) => s.hide !== 1), [sites])

  // 首页站点 tab 保持配置顺序，避免后台测速更新时按钮位置跳动。
  // 健康状态仍通过右侧延迟标识展示，详细筛选交给站点弹窗处理。
  const tabSites = useMemo(
    () => (visibleSites.length > 0 ? visibleSites : allSites),
    [visibleSites, allSites]
  )

  // Active category filters
  const activeFilters = (filters && activeCategory && filters[activeCategory]) || []

  // Has live sources for func button
  const hasLiveSources = Boolean(liveConfig?.lives?.length)

  // Display videos
  const displayVideos = activeCategory && activeCategory !== '首页'
    ? categoryVideos
    : homeVideos

  // Page state for ProgressLayout
  const pageState = !currentConfig
    ? 'empty' as const
    : (isLoading && displayVideos.length === 0 && !contentSiteKey)
      ? 'loading' as const
      : 'content' as const

  // ── Effects ──

  // 站点切换：收起筛选面板 + 列表回顶。
  // 分类标签/筛选**不在这里清空**——由 store 按站点记忆恢复（useConfigStore 的订阅）。
  // 原来依赖 [currentSiteKey, sites]，而后台测速会不断替换 sites 数组，
  // 于是用户刚选好的标签会被反复冲掉。
  const prevSiteKeyRef = useRef(currentSiteKey)
  useEffect(() => {
    if (prevSiteKeyRef.current === currentSiteKey) return
    prevSiteKeyRef.current = currentSiteKey
    setShowFilterPanel(false)
    scrollContainerRef.current?.scrollTo({ top: 0 })
  }, [currentSiteKey])

  // 当站点无首页推荐视频（homeVideos 为空）但有分类时，自动选中并加载第一个分类的内容
  useEffect(() => {
    if (!activeCategory && homeVideos.length === 0 && categories.length > 0) {
      setActiveCategory(categories[0].type_id)
    }
  }, [activeCategory, homeVideos.length, categories])

  // Load history
  const loadHistory = useCallback(() => {
    if (!currentConfig) {
      setContinueItems([])
      return
    }
    historyApi.list()
      .then((items: HistoryItem[]) => {
        setContinueItems(
          items
            .filter((item) => !item.completed && (item.positionSeconds || item.progress || 0) > 0)
            .sort((a, b) => (b.updateTime || 0) - (a.updateTime || 0))
            .slice(0, 8)
        )
      })
      .catch(() => setContinueItems([]))
  }, [currentConfig])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  // Category content fetching
  useEffect(() => {
    if (activeCategory && activeCategory !== '首页') {
      fetchCategoryContent(activeCategory, 1, selectedFilters)
    }
  }, [activeCategory, selectedFilters, fetchCategoryContent])

  // Scroll detection for toolbar
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const handler = () => {
      setScrolled(el.scrollTop > 10)
    }
    el.addEventListener('scroll', handler)
    return () => el.removeEventListener('scroll', handler)
  }, [])

  // ── Handlers ──

  const handleSiteSwitch = (key: string) => {
    setActiveCategory('')
    setSelectedFilters({})
    setShowFilterPanel(false)
    switchSite(key)
    setShowSiteDialog(false)
  }

  const handleCategoryClick = (tid: string) => {
    if (tid === activeCategory) return
    setActiveCategory(tid)
    setSelectedFilters({})
    setShowFilterPanel(false)
    setShowSiteDialog(false)
  }

  const handleFilterChange = (key: string, value: string) => {
    setSelectedFilters((prev) => ({ ...prev, [key]: value }))
  }

  const handleDefaultSourceClick = async (url: string) => {
    if (loadingSourceUrl) return
    setShowSiteDialog(false)
    setLoadingSourceUrl(url)
    try {
      await loadConfig(url)
    } finally {
      setLoadingSourceUrl('')
    }
  }

  const handleVodClick = (vod: any) => {
    navigate(`/vod/${encodeURIComponent(contentSiteKey || currentSiteKey)}/${encodeURIComponent(vod.vod_id)}`)
  }

  // Infinite scroll
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el || isLoading || !hasMore || !activeCategory || activeCategory === '首页') return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      fetchCategoryContent(activeCategory, currentPage + 1, selectedFilters)
    }
  }, [isLoading, hasMore, activeCategory, currentPage, selectedFilters, fetchCategoryContent])

  // Keyboard navigation: LEFT/RIGHT to cycle sites (when title focused)
  const handleSiteCycle = (direction: 'prev' | 'next') => {
    const sites = tabSites
    if (sites.length <= 1) return
    const currentIdx = sites.findIndex((s) => s.key === currentSiteKey)
    if (currentIdx === -1) return
    const nextIdx = direction === 'next'
      ? (currentIdx + 1) % sites.length
      : (currentIdx - 1 + sites.length) % sites.length
    handleSiteSwitch(sites[nextIdx].key)
  }

  useKeyboardNav({
    onEscape: () => setShowSiteDialog(false),
    onRefresh: () => refreshWithCooldown(),
    enabled: Boolean(currentConfig)
  })

  // ── History handlers ──
  const handleHistoryClick = (item: HistoryItem) => {
    navigate(`/vod/${encodeURIComponent(item.siteKey)}/${encodeURIComponent(item.vodId)}`)
  }

  // ── Clear all history ──
  const handleClearHistory = () => {
    setContinueItems([])
  }

  // ── STARTUP LOADING (解决冷启动时闪烁源选择卡片的问题) ──
  // 仅在未就绪、无配置且尚无明确错误时展示启动加载动画；如果有错误则展示空配置态下的错误提示
  if (!isStartupReady && !currentConfig && !error) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent mb-3" />
        <p className="text-sm text-text-muted">正在载入订阅配置...</p>
      </div>
    )
  }

  // ── NO CONFIG ──
  if (!currentConfig) {
    return (
      <div className="h-full overflow-y-auto scrollbar-dark px-8 py-10">
        <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-center">
          <div className="mb-8 flex flex-col items-center text-center">
            <Search className="mb-4 h-12 w-12 text-text-muted" />
            <h2 className="mb-2 text-lg font-semibold text-text-primary">还没有配置源</h2>
            <p className="max-w-md text-sm leading-6 text-text-muted">
              先选一个推荐资源，加载成功后首页会直接显示可浏览内容。
            </p>
            {error && !isLoading && (
              <div
                role="alert"
                className="mt-4 max-w-md rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm leading-6 text-red-400"
              >
                {error}
              </div>
            )}
            <button
              onClick={() => navigate('/onboarding')}
              className="mt-5 rounded-lg bg-accent px-4 py-2 font-medium text-bg-primary transition-colors hover:bg-accent-hover"
            >
              手动导入配置
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 nav:grid-cols-6">
            {DEFAULT_SOURCES.map((source) => {
              const loadingSource = loadingSourceUrl === source.url
              return (
                <button
                  key={source.url}
                  onClick={() => handleDefaultSourceClick(source.url)}
                  disabled={Boolean(loadingSourceUrl)}
                  className="rounded-lg border border-[#2a2a2a] bg-bg-secondary p-3 text-left transition-all hover:border-accent/40 hover:bg-bg-hover disabled:opacity-60"
                >
                  <p className="truncate text-sm font-medium text-text-primary">{source.name}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{source.desc}</p>
                  {loadingSource && (
                    <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      加载中...
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // ── NO VISIBLE SITES ──
  if (visibleSites.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <Search className="w-12 h-12 text-text-muted mb-4" />
        <h2 className="text-lg font-semibold text-text-primary mb-2">未找到可用站点</h2>
        <p className="text-sm text-text-muted mb-6 max-w-md leading-6">
          {error || '当前订阅没有兼容的点播站点，请切换订阅。'}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/settings')}
            className="px-4 py-2 bg-accent text-bg-primary rounded-lg font-medium hover:bg-accent-hover transition-colors"
          >
            切换配置
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 border border-[#2a2a2a] text-text-secondary rounded-lg hover:bg-bg-hover transition-colors"
          >
            重新加载
          </button>
          {hasLiveSources && <button onClick={() => navigate('/live')} className="px-4 py-2 border border-[#2a2a2a] rounded-lg">查看直播</button>}
        </div>
      </div>
    )
  }

  // ── NORMAL HOME LAYOUT ──
  // Reference: FongMi TV HomeActivity.java layout
  return (
    <div className="h-full flex flex-col">
      {/* ===== Toolbar (FongMi: 半透明黑底, 24dp padding) ===== */}
      <header
        className={`shrink-0 transition-all duration-200 ${
          scrolled
            ? 'opacity-0 pointer-events-none h-0 overflow-hidden py-0'
            : 'opacity-100 py-1'
        }`}
      >
        <div className="flex items-center px-6 py-2">
          {/* Back button */}
          <button
            onClick={() => navigate(-1)}
            className="shrink-0 p-1.5 text-white/50 hover:text-accent transition-colors mr-1"
            title="返回"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          {/* Site title — FongMi: 白24sp, 可点击, ←→切换 */}
          <h1
            className="flex-1 text-xl text-white font-medium cursor-pointer hover:text-accent transition-colors truncate"
            onClick={() => setShowSiteDialog(true)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') { e.preventDefault(); handleSiteCycle('prev') }
              if (e.key === 'ArrowRight') { e.preventDefault(); handleSiteCycle('next') }
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowSiteDialog(true) }
            }}
            title="点击切换站点（← → 方向键切换）"
          >
            {allSites.find((s) => s.key === currentSiteKey)?.name || '站点'}
          </h1>

          {/* Clock — FongMi: 白24sp */}
          <span className="text-base text-white/70 shrink-0 ml-3 font-mono">
            {new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </header>

      {/* ===== Site Tab Bar — 可见站点切换入口 ===== */}
      <div className="shrink-0 flex items-center gap-1.5 px-6 pb-2 overflow-x-auto scrollbar-hidden">
        {tabSites.map((site) => {
          const speed = siteSpeeds?.[site.key]
          return (
            <button
              key={site.key}
              onClick={() => handleSiteSwitch(site.key)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1 text-xs rounded-full transition-all duration-200 ${
                currentSiteKey === site.key
                  ? 'text-yellow-400 bg-white/10 font-medium shadow-sm'
                  : 'text-white/60 hover:text-white/80 hover:bg-white/[0.06]'
              }`}
            >
              <span>{site.name}</span>
              {speed && speed.ok && speed.latency > 0 && (
                <span
                  className={`text-[9px] font-mono px-1 py-0.2 rounded leading-tight ${
                    speed.latency < 500
                      ? 'text-emerald-400 bg-emerald-500/15'
                      : speed.latency < 1500
                        ? 'text-amber-400 bg-amber-500/15'
                        : 'text-orange-400 bg-orange-500/15'
                  }`}
                >
                  {speed.latency}ms
                </span>
              )}
            </button>
          )
        })}
        <div className="flex-1" />
        <button
          onClick={() => navigate('/search')}
          className="shrink-0 p-1.5 text-white/50 hover:text-accent transition-colors"
          title="搜索"
        >
          <Search className="w-4 h-4" />
        </button>
      </div>

      {/* ===== Content area with ProgressLayout ===== */}
      {/* FongMi: ProgressLayout wrapping VerticalGridView */}
      <ProgressLayout
        state={pageState}
        loadingMessage={
          startupAttempt
            ? `正在尝试第 ${startupAttempt.index}/${startupAttempt.total} 个站点：${startupAttempt.siteName}…`
            : '正在加载首页内容...'
        }
        emptyTitle="暂无内容"
        emptyDescription=""
      >
        <div
          ref={scrollContainerRef}
          onScroll={(e) => {
            handleScroll()
            setScrolled(e.currentTarget.scrollTop > 10)
          }}
          className="flex-1 overflow-y-auto scrollbar-dark px-6 pb-8"
        >
          {/* Row 1 功能按钮整排已移除，为影片网格腾出首页空间 */}

          {/* Row 2: Continue Watching — FongMi: getHistory() + HistoryPresenter */}
          <HistoryCarousel
            items={continueItems}
            onItemClick={handleHistoryClick}
            onClearAll={handleClearHistory}
          />

          {/* Row 3: Category tabs — FongMi: adapter_type.xml */}
          <CategoryTabs
            categories={categories}
            activeCategory={activeCategory}
            onSelect={handleCategoryClick}
            hasFilters={activeFilters.length > 0}
            showFilter={showFilterPanel}
            onToggleFilter={() => setShowFilterPanel(!showFilterPanel)}
          />

          {/* Filter panel — FongMi: FilterDialog */}
          {showFilterPanel && (
            <FilterPanel
              filters={activeFilters}
              selectedFilters={selectedFilters}
              onChange={handleFilterChange}
            />
          )}

          {/* Pending site indicator — FongMi: progress indicator */}
          {pendingSiteKey && (
            <div className="flex items-center justify-center gap-2 py-2 text-xs text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
              正在切换到 {visibleSites.find((site) => site.key === pendingSiteKey)?.name || '新站点'}
            </div>
          )}

          {/* Row 4: Video Grid — FongMi: addVideo() + VodPresenter */}
          <div className="pt-1">
            <VideoGrid
              videos={displayVideos}
              isLoading={isLoading}
              onVodClick={handleVodClick}
              contentSiteKey={contentSiteKey}
            />
          </div>
        </div>
      </ProgressLayout>

      {/* Error banner — FongMi: Notify.show() */}
      {error && !isLoading && (
        <ErrorBanner message={error} />
      )}

      {/* ===== SiteDialog — FongMi: SiteDialog.java ===== */}
      <SiteDialog
        open={showSiteDialog}
        onClose={() => setShowSiteDialog(false)}
        sites={allSites}
        currentSiteKey={currentSiteKey}
        onSelectSite={handleSiteSwitch}
      />
    </div>
  )
}
