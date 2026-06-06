import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, ChevronDown, Loader2, ArrowLeft } from 'lucide-react'
import { useConfigStore } from '@/stores/useConfigStore'
import VodCard from '@/components/VodCard/VodCard'

export default function Home() {
  const navigate = useNavigate()
  const {
    sites, currentSiteKey, categories, filters, homeVideos,
    categoryVideos, currentPage, hasMore, isLoading, error,
    switchSite, fetchCategoryContent
  } = useConfigStore()

  const [activeCategory, setActiveCategory] = useState<string>('')
  const [selectedFilters, setSelectedFilters] = useState<Record<string, string>>({})
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // 只显示 HTTP API 类型的站点（type 0/1/4）
  const visibleSites = sites.filter((s) => s.type === 0 || s.type === 1 || s.type === 4)

  // 获取当前分类的可用筛选器
  const activeFilters = (filters && activeCategory && filters[activeCategory]) || []

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
  }

  const handleCategoryClick = (tid: string) => {
    if (tid === activeCategory) return
    setActiveCategory(tid)
    setSelectedFilters({})
    setShowFilterPanel(false)
  }

  const handleFilterChange = (key: string, value: string) => {
    setSelectedFilters((prev) => ({ ...prev, [key]: value }))
  }

  const handleVodClick = (vod: any) => {
    navigate(`/vod/${currentSiteKey}/${vod.vod_id}`)
  }

  // 无限滚动
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el || isLoading || !hasMore || !activeCategory || activeCategory === '首页') return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      fetchCategoryContent(activeCategory, currentPage + 1, selectedFilters)
    }
  }, [isLoading, hasMore, activeCategory, currentPage, selectedFilters])

  const displayVideos = activeCategory && activeCategory !== '首页' ? categoryVideos : homeVideos

  // 没有可见站点（type=0/1/4 都不可用）
  if (visibleSites.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <Search className="w-12 h-12 text-text-muted mb-4" />
        <h2 className="text-lg font-semibold text-text-primary mb-2">未找到可用站点</h2>
        <p className="text-sm text-text-muted mb-6 max-w-md">
          当前配置源中没有可用的 type=0/1/4 站点。请尝试切换配置源或检查网络连接。
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/settings')}
            className="px-4 py-2 bg-accent text-bg-primary rounded-lg font-medium hover:bg-accent-hover"
          >
            切换配置
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 border border-[#2a2a2a] text-text-secondary rounded-lg hover:bg-bg-hover"
          >
            重新加载
          </button>
        </div>
      </div>
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
            <button
              onClick={() => { setActiveCategory(''); setShowFilterPanel(false) }}
              className={`shrink-0 px-3 py-1 text-xs rounded-md transition-colors ${
                !activeCategory
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              首页
            </button>
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
        {isLoading && displayVideos.length === 0 ? (
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
    </div>
  )
}
