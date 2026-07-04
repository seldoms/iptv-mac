import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, ChevronDown, Loader2, ArrowLeft, Clock } from 'lucide-react'
import { useConfigStore } from '@/stores/useConfigStore'
import { historyApi } from '@/utils/ipc'
import VodCard from '@/components/VodCard/VodCard'
import EmptyState from '@/components/EmptyState/EmptyState'
import type { History as HistoryItem } from '@shared/types'

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
    currentConfig, sites, currentSiteKey, contentSiteKey, pendingSiteKey, categories, filters, homeVideos,
    categoryVideos, currentPage, hasMore, isLoading, error,
    switchSite, fetchCategoryContent
  } = useConfigStore()

      const [activeCategory, setActiveCategory] = useState<string>('')
      const [selectedFilters, setSelectedFilters] = useState<Record<string, string>>({})
      const [showFilterPanel, setShowFilterPanel] = useState(false)
      const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [showSiteSheet, setShowSiteSheet] = useState(false)
  const siteSheetBtnRef = useRef<HTMLButtonElement>(null)
  const siteSheetRef = useRef<HTMLDivElement>(null)
  const [siteSheetRect, setSiteSheetRect] = useState({ top: 0, left: 0 })
  const [continueItems, setContinueItems] = useState<HistoryItem[]>([])

  // 只显示可直接请求的 HTTP API 类型站点（type 0/1/4）
  const visibleSites = sites.filter((s) =>
    (s.type === 0 || s.type === 1 || s.type === 4) &&
    s.hide !== 1 &&
    Boolean(s.api?.trim())
  )

  // 获取当前分类的可用筛选器
  const activeFilters = (filters && activeCategory && filters[activeCategory]) || []

      useEffect(() => {
        setActiveCategory('')
        setSelectedFilters({})
        setShowFilterPanel(false)
        setShowSiteSheet(false)
        scrollContainerRef.current?.scrollTo({ top: 0 })
      }, [currentSiteKey, sites])

  useEffect(() => {
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

  // 分类切换
  useEffect(() => {
    if (activeCategory && activeCategory !== '首页') {
      fetchCategoryContent(activeCategory, 1, selectedFilters)
    }
  }, [activeCategory, selectedFilters])

      const handleSiteSwitch = (key: string) => {
        setActiveCategory('')
        setSelectedFilters({})
        setShowFilterPanel(false)
        switchSite(key)
        setShowSiteSheet(false)
      }

      const handleSiteSheetClick = (key: string) => {
        if (key === currentSiteKey) {
          const btn = siteSheetBtnRef.current
          if (btn) {
            const rect = btn.getBoundingClientRect()
            setSiteSheetRect({ top: rect.bottom + 4, left: rect.left })
          }
          setShowSiteSheet(prev => !prev)
        } else {
          handleSiteSwitch(key)
        }
      }

      const handleCategoryClick = (tid: string) => {
        if (tid === activeCategory) return
        setActiveCategory(tid)
        setSelectedFilters({})
        setShowFilterPanel(false)
        setShowSiteSheet(false)
      }

      const handleFilterChange = (key: string, value: string) => {
        setSelectedFilters((prev) => ({ ...prev, [key]: value }))
      }

  const handleVodClick = (vod: any) => {
    navigate(`/vod/${contentSiteKey || currentSiteKey}/${vod.vod_id}`)
  }

      // 无限滚动
      const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el || isLoading || !hasMore || !activeCategory || activeCategory === '首页') return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      fetchCategoryContent(activeCategory, currentPage + 1, selectedFilters)
    }
  }, [isLoading, hasMore, activeCategory, currentPage, selectedFilters])

  const displayVideos = activeCategory && activeCategory !== '首页'
  ? (categoryVideos.length > 0 ? categoryVideos : homeVideos)
  : homeVideos

  if (!currentConfig) {
    return (
      <EmptyState
        icon={Search}
        title="还没有配置源"
        description="先导入一个 TVBox/CatVod 兼容配置，导入成功后这里会显示可浏览的内容。"
        primaryLabel="去导入配置"
        onPrimaryClick={() => navigate('/onboarding')}
      />
    )
  }

  // 没有可见站点（type=0/1/4 都不可用）
  if (visibleSites.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="未找到可用站点"
        description="当前配置源中没有可用于点播浏览的站点。可以切换配置源，或检查配置内容和网络连接。"
        primaryLabel="切换配置"
        onPrimaryClick={() => navigate('/settings')}
        secondaryLabel="重新加载"
        onSecondaryClick={() => window.location.reload()}
      />
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* 顶部栏 */}
      <div className="shrink-0 border-b border-[#2a2a2a]">
        {/* 站点标签 */}
        <div className="flex items-center px-4 pt-3 gap-1 scrollbar-hidden overflow-x-auto">
          <button
            onClick={() => navigate(-1)}
            className="shrink-0 p-1.5 text-text-muted hover:text-accent transition-colors mr-1"
            title="返回"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          {visibleSites.map((site) => (
            <button
              key={site.key}
              onClick={() => handleSiteSwitch(site.key)}
              className={`shrink-0 px-3 py-1.5 text-sm rounded-full transition-colors ${
                currentSiteKey === site.key
                  ? 'bg-accent text-bg-primary font-medium'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
              }`}
            >
              {site.name}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={() => navigate('/search')}
            className="shrink-0 p-2 text-text-muted hover:text-accent transition-colors"
          >
            <Search className="w-5 h-5" />
          </button>
        </div>

        {/* 分类标签 */}
        {categories.length > 0 && (
          <div className="flex items-center px-4 py-2 gap-1 scrollbar-hidden overflow-x-auto">
            <div className="relative shrink-0">
              <button
                ref={siteSheetBtnRef}
                onClick={() => { setActiveCategory(''); setShowFilterPanel(false); handleSiteSheetClick(currentSiteKey) }}
                className={`shrink-0 px-3 py-1 text-xs rounded-md transition-colors ${
                  !activeCategory
                    ? 'bg-accent/20 text-accent'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                首页
              </button>
            </div>
            {categories.map((cat) => (
              <button
                key={cat.type_id}
                onClick={() => handleCategoryClick(cat.type_id)}
                className={`shrink-0 px-3 py-1 text-xs rounded-md transition-colors ${
                  activeCategory === cat.type_id
                    ? 'bg-accent/20 text-accent'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {cat.type_name}
              </button>
            ))}
            {/* 筛选按钮 */}
            {activeFilters.length > 0 && activeCategory && (
              <button
                onClick={() => setShowFilterPanel(!showFilterPanel)}
                className={`shrink-0 flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors ${
                  showFilterPanel ? 'text-accent' : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                筛选 <ChevronDown className={`w-3 h-3 transition-transform ${showFilterPanel ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>
        )}

        {/* 筛选面板 */}
        {showFilterPanel && activeFilters.length > 0 && (
          <div className="px-4 py-2 border-t border-[#2a2a2a] space-y-2">
            {activeFilters.map((filter) => (
              <div key={filter.key} className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-text-muted shrink-0 w-12">{filter.name}:</span>
                {filter.value.map((v) => (
                  <button
                    key={v.v}
                    onClick={() => handleFilterChange(filter.key, v.v)}
                    className={`px-2 py-0.5 text-xs rounded transition-colors ${
                      selectedFilters[filter.key] === v.v
                        ? 'bg-accent/20 text-accent'
                        : 'text-text-muted hover:text-text-secondary'
                    }`}
                  >
                    {v.n}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {pendingSiteKey && (
        <div className="shrink-0 flex items-center justify-center gap-2 px-4 py-2 bg-bg-secondary text-xs text-text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
          正在切换到 {visibleSites.find((site) => site.key === pendingSiteKey)?.name || '新站点'}，当前内容可继续浏览
        </div>
      )}

      {error && !isLoading && (
        <div className="shrink-0 px-4 py-2 bg-red-500/10 text-red-400 text-xs text-center">
          {error}
        </div>
      )}

      {/* 视频网格 */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto scrollbar-dark p-4"
      >
        {!activeCategory && continueItems.length > 0 && (
          <section className="mb-5">
            <div className="mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-accent" />
              <h2 className="text-sm font-medium text-text-primary">继续观看</h2>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
              {continueItems.map((item) => (
                <button
                  key={`${item.siteKey}:${item.vodId}`}
                  onClick={() => navigate(`/vod/${item.siteKey}/${item.vodId}`)}
                  className="flex min-w-0 items-center gap-3 rounded-lg bg-bg-secondary p-2 text-left transition-colors hover:bg-bg-hover"
                >
                  <div className="h-16 w-11 shrink-0 overflow-hidden rounded bg-bg-tertiary">
                    <img
                      src={item.vodPic}
                      alt={item.vodName}
                      className="h-full w-full object-cover"
                      onError={(event) => { (event.target as HTMLImageElement).style.display = 'none' }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-primary">{item.vodName}</p>
                    <p className="mt-1 truncate text-xs text-text-muted">{item.episodeName || item.source || '上次观看'}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-bg-tertiary">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${Math.max(0, Math.min(100, item.progress || 0))}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-[10px] text-text-muted">
                        {(item.positionSeconds || 0) > 0 ? formatResumeTime(item.positionSeconds) : `${item.progress || 0}%`}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {isLoading && displayVideos.length === 0 && !contentSiteKey ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <VodCard key={i} vod={{ vod_id: '', vod_name: '', vod_pic: '', vod_remarks: '' }} onClick={() => {}} loading />
            ))}
          </div>
        ) : displayVideos.length > 0 ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
            {displayVideos.map((vod) => (
              <VodCard key={vod.vod_id} vod={vod} onClick={handleVodClick} />
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 text-text-muted text-sm">
            {isLoading ? '加载中...' : '暂无内容，请尝试切换站点或配置源'}
          </div>
        )}

        {/* 加载更多 */}
        {isLoading && displayVideos.length > 0 && (
          <div className="flex justify-center py-4">
            <Loader2 className="w-5 h-5 text-accent animate-spin" />
          </div>
        )}
      </div>

      {/* 站点切换下拉菜单 - 放在 overflow 容器外避免被裁剪 */}
      {showSiteSheet && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowSiteSheet(false)} />
          <div
            ref={siteSheetRef}
            className="fixed z-50 min-w-[180px] max-h-[360px] overflow-y-auto rounded-lg border border-[#2a2a2a] bg-bg-secondary shadow-xl py-1"
            style={{ top: siteSheetRect.top, left: siteSheetRect.left }}
          >
            {visibleSites.map((site) => (
              <button
                key={site.key}
                onClick={() => handleSiteSwitch(site.key)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  currentSiteKey === site.key
                    ? 'text-accent bg-accent/10'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                }`}
              >
                {site.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
