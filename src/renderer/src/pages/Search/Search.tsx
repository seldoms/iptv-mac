import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search as SearchIcon, X, Loader2 } from 'lucide-react'
import { useConfigStore, Vod } from '@/stores/useConfigStore'
import { siteApi, cacheApi } from '@/utils/ipc'
import VodCard from '@/components/VodCard/VodCard'

interface SearchResult {
  siteKey: string
  siteName: string
  videos: Vod[]
  loading: boolean
  error: string | null
}

export default function Search() {
  const navigate = useNavigate()
  const { sites, currentSiteKey } = useConfigStore()
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searchHistory, setSearchHistory] = useState<string[]>([])
  const [isSearching, setIsSearching] = useState(false)

  // 加载搜索历史
  useState(() => {
    cacheApi.get('search_history').then((data: any) => {
      if (data) {
        try {
          setSearchHistory(JSON.parse(data))
        } catch {}
      }
    })
  })

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
      const searchSites = sites.filter((s) => s.searchable !== 0)
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
          const list = (res.data?.list || []) as Vod[]
          setResults((prev) =>
            prev.map((r, i) =>
              i === idx ? { ...r, videos: list, loading: false } : r
            )
          )
        } catch (e: any) {
          setResults((prev) =>
            prev.map((r, i) =>
              i === idx ? { ...r, loading: false, error: e.message } : r
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

  const handleVodClick = (vod: Vod, siteKey: string) => {
    navigate(`/vod/${siteKey}/${vod.vod_id}`)
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
          <div className="space-y-6">
            {results.map((result) => (
              <div key={result.siteKey}>
                {/* 站点标题 */}
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-medium text-text-primary">{result.siteName}</h3>
                  {result.loading && <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />}
                  {result.error && <span className="text-xs text-red-400">搜索失败</span>}
                  {!result.loading && !result.error && result.videos.length === 0 && (
                    <span className="text-xs text-text-muted">无结果</span>
                  )}
                </div>

                {/* 结果网格 */}
                {result.videos.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                    {result.videos.map((vod) => (
                      <VodCard
                        key={vod.vod_id}
                        vod={vod}
                        onClick={(v) => handleVodClick(v, result.siteKey)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
