import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search as SearchIcon, X, Loader2 } from 'lucide-react'
import { useConfigStore, Vod } from '@/stores/useConfigStore'
import { siteApi, cacheApi } from '@/utils/ipc'
import VodCard from '@/components/VodCard/VodCard'
import EmptyState from '@/components/EmptyState/EmptyState'
import { isSupportedContentSite } from '@/siteSupport'

interface SearchResult {
  siteKey: string
  siteName: string
  videos: Vod[]
  loading: boolean
  error: string | null
}

export default function Search() {
  const navigate = useNavigate()
  const { currentConfig, sites } = useConfigStore()
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searchHistory, setSearchHistory] = useState<string[]>([])
  const [isSearching, setIsSearching] = useState(false)

  // 加载搜索历史（带大小和格式校验）
  useEffect(() => {
    cacheApi.get('search_history').then((data: any) => {
      if (!data || typeof data !== 'string') return
      if (data.length > 100 * 1024) return // 拒绝超过 100KB 的缓存
      try {
        const parsed = JSON.parse(data)
        if (Array.isArray(parsed) && parsed.every((s): s is string => typeof s === 'string')) {
          setSearchHistory(parsed.slice(0, 20))
        }
      } catch { /* 无效缓存，静默忽略 */ }
    })
  }, [])

  const saveSearchHistory = async (kw: string) => {
    const newHistory = [kw, ...searchHistory.filter((h) => h !== kw)].slice(0, 20)
    setSearchHistory(newHistory)
    await cacheApi.set('search_history', JSON.stringify(newHistory))
  }

  const clearHistory = async () => {
    setSearchHistory([])
    await cacheApi.del('search_history')
  }

  const doSearch = useCallback(
    async (kw: string) => {
      if (!kw.trim()) return
      setKeyword(kw)
      setIsSearching(true)
      saveSearchHistory(kw)

      // 初始化所有站点的搜索结果
      const searchSites = sites.filter((s) => s.searchable !== 0 && isSupportedContentSite(s))
      const initResults: SearchResult[] = searchSites.map((s) => ({
        siteKey: s.key,
        siteName: s.name,
        videos: [],
        loading: true,
        error: null
      }))
      setResults(initResults)

      // 并行搜索
      const promises = searchSites.map(async (site, idx) => {
        try {
          const res = await siteApi.searchContent(site.key, kw, true) as { success: boolean; data?: any; error?: string }
          if (!res.success) throw new Error(res.error || '搜索失败')
          const list = (res.data?.list || []) as Vod[]
          setResults((prev) =>
            prev.map((r, i) =>
              i === idx ? { ...r, videos: list, loading: false } : r
            )
          )
        } catch (e: any) {
          setResults((prev) =>
            prev.map((r, i) =>
              i === idx ? { ...r, loading: false, error: typeof e === 'string' ? e : e.message || '搜索失败' } : r
            )
          )
        }
      })

      await Promise.allSettled(promises)
      setIsSearching(false)
    },
    [sites]
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') doSearch(keyword)
  }

  const searchableSites = sites.filter((s) => s.searchable !== 0 && isSupportedContentSite(s))

  if (!currentConfig) {
    return (
      <EmptyState
        icon={SearchIcon}
        title="还没有配置源"
        description="导入配置后，搜索会在可用站点中并行查找内容。"
        primaryLabel="去导入配置"
        onPrimaryClick={() => navigate('/onboarding')}
      />
    )
  }

  if (searchableSites.length === 0) {
    return (
      <EmptyState
        icon={SearchIcon}
        title="没有可搜索站点"
        description="当前配置源没有开启搜索能力的站点。可以切换配置源，或检查配置中的 searchable 字段。"
        primaryLabel="切换配置"
        onPrimaryClick={() => navigate('/settings')}
      />
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* 搜索栏 */}
      <div className="shrink-0 px-6 pt-5 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2 bg-bg-tertiary rounded-lg px-4 py-2.5">
            <SearchIcon className="w-4 h-4 text-text-muted shrink-0" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="搜索影片..."
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
              autoFocus
            />
            {keyword && (
              <button onClick={() => setKeyword('')} className="text-text-muted hover:text-text-secondary">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => doSearch(keyword)}
            disabled={!keyword.trim() || isSearching}
            className="px-5 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-bg-primary text-sm font-medium rounded-lg transition-colors"
          >
            搜索
          </button>
        </div>

        {/* 搜索历史 */}
        {searchHistory.length > 0 && results.length === 0 && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-text-muted">搜索历史：</span>
            {searchHistory.slice(0, 10).map((kw) => (
              <button
                key={kw}
                onClick={() => doSearch(kw)}
                className="px-2.5 py-1 text-xs text-text-secondary bg-bg-tertiary rounded-full hover:text-accent hover:bg-accent-muted transition-colors"
              >
                {kw}
              </button>
            ))}
            <button
              onClick={clearHistory}
              className="text-xs text-text-muted hover:text-accent ml-2"
            >
              清除
            </button>
          </div>
        )}
      </div>

      {/* 搜索结果 */}
      <div className="flex-1 overflow-y-auto scrollbar-dark px-6 pb-6">
        {results.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-text-muted text-sm">
            输入关键词搜索影片
          </div>
        ) : (
          <div>
            {(() => {
              const allVideos = results
                .filter((r) => !r.loading && !r.error && r.videos.length > 0)
                .flatMap((r) => r.videos.map((v) => ({ ...v, _siteKey: r.siteKey, _siteName: r.siteName })))
              const pendingCount = results.filter((r) => r.loading).length

              return (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <h3 className="text-sm font-medium text-text-primary">
                      搜索结果
                    </h3>
                    {pendingCount > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {pendingCount} 个站点搜索中...
                      </span>
                    )}
                    {pendingCount === 0 && (
                      <span className="text-xs text-text-muted">
                        共 {allVideos.length} 个结果
                      </span>
                    )}
                  </div>

                  {allVideos.length > 0 && (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                      {allVideos.map((v: any) => (
                        <VodCard
                          key={`${v._siteKey}:${v.vod_id}`}
                          vod={v}
                          sourceName={v._siteName}
                          onClick={(vod) => navigate(`/vod/${encodeURIComponent(v._siteKey)}/${encodeURIComponent(vod.vod_id)}`)}
                        />
                      ))}
                    </div>
                  )}

                  {pendingCount === 0 && allVideos.length === 0 && (
                    <div className="flex items-center justify-center h-48 text-text-muted text-sm">
                      未找到相关影片
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}
