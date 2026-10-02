import { useState, useMemo, useRef, useEffect } from 'react'
import { Grid3X3, List, Search, SwitchCamera, CheckSquare, Square, Search as SearchIcon } from 'lucide-react'
import Dialog, { DialogFooter } from '@/components/Dialog/Dialog'
import { useConfigStore, type Site } from '@/stores/useConfigStore'
import { isSupportedContentSite } from '@/siteSupport'
import { sortAndFilterSites } from '@/services/sitePrefetchService'

type DialogMode = 'select' | 'search' | 'change'
type ViewMode = 'grid' | 'list'

const GRID_COLUMNS = 10

interface SiteDialogProps {
  open: boolean
  onClose: () => void
  sites: Site[]
  currentSiteKey: string
  onSelectSite: (siteKey: string) => void
  onToggleSearchable?: (siteKey: string, searchable: boolean) => void
  onToggleChangeable?: (siteKey: string, changeable: boolean) => void
  onBatchSearchable?: (siteKeys: string[], enable: boolean) => void
  onBatchChangeable?: (siteKeys: string[], enable: boolean) => void
}

/**
 * 站点选择弹窗 — FongMi TV 风格
 * 参考：SiteDialog.java + dialog_site.xml + adapter_site.xml
 * 半透明黑底 + 黄色高亮 + 圆角 pills
 */
export default function SiteDialog({
  open,
  onClose,
  sites,
  currentSiteKey,
  onSelectSite,
  onToggleSearchable,
  onToggleChangeable,
  onBatchSearchable,
  onBatchChangeable
}: SiteDialogProps) {
  const [dialogMode, setDialogMode] = useState<DialogMode>('select')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // 键盘快捷键：Ctrl+F / Cmd+F 聚焦搜索
  useEffect(() => {
    if (!open) {
      setSearchTerm('')
      return
    }
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const [filterSupportedOnly, setFilterSupportedOnly] = useState(true)

  const siteSpeeds = useConfigStore((state) => state.siteSpeeds)

  const supportedSitesCount = useMemo(() => sites.filter(isSupportedContentSite).length, [sites])
  const hasUnsupportedSites = supportedSitesCount < sites.length

  const filteredSites = useMemo(() => {
    let list = sites
    if (dialogMode === 'select') {
      // 需求：离线就不显示了，能显示的都是能打开的，优先显示速度快的
      const supported = list.filter(isSupportedContentSite)
      list = sortAndFilterSites(supported, siteSpeeds || {}, currentSiteKey)
    } else if (filterSupportedOnly && hasUnsupportedSites) {
      list = list.filter(isSupportedContentSite)
    }
    if (!searchTerm.trim()) return list
    const q = searchTerm.toLowerCase()
    return list.filter((s) => s.name.toLowerCase().includes(q))
  }, [sites, searchTerm, dialogMode, filterSupportedOnly, hasUnsupportedSites, siteSpeeds, currentSiteKey])

  const rowCount = useMemo(() => {
    if (viewMode === 'list') return 1
    const count = filteredSites.length
    if (count >= 30) return 4
    if (count >= 20) return 3
    if (count >= GRID_COLUMNS) return 2
    return 1
  }, [filteredSites.length, viewMode])

  const dialogWidth = useMemo(() => {
    if (viewMode === 'list') return 'max-w-lg'
    const count = sites.length
    if (count >= 30) return 'max-w-5xl'
    if (count >= 20) return 'max-w-4xl'
    if (count >= GRID_COLUMNS) return 'max-w-2xl'
    return 'max-w-lg'
  }, [sites.length, viewMode])

  const cols = viewMode === 'list' ? 1 : Math.min(8, Math.max(2, Math.ceil(filteredSites.length / rowCount)))

  const toggleKey = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleSelectAll = () => setSelectedKeys(new Set(sites.map((s) => s.key)))
  const handleCancelAll = () => setSelectedKeys(new Set())

  const handleItemClick = (site: Site) => {
    if (dialogMode === 'select') {
      onSelectSite(site.key)
      onClose()
    } else if (dialogMode === 'search') {
      const newVal = !site.searchable
      onToggleSearchable?.(site.key, newVal)
    } else if (dialogMode === 'change') {
      const newVal = !site.changeable
      onToggleChangeable?.(site.key, newVal)
    }
  }

  const handleBatchAction = (enable: boolean) => {
    if (dialogMode === 'search') onBatchSearchable?.(Array.from(selectedKeys), enable)
    else if (dialogMode === 'change') onBatchChangeable?.(Array.from(selectedKeys), enable)
    setSelectedKeys(new Set())
  }

  const setMode = (mode: DialogMode) => {
    setDialogMode(mode)
    setSelectedKeys(new Set())
  }

  const gridClass = cols > 6
    ? 'grid grid-cols-8 gap-1.5'
    : cols > 4
      ? 'grid grid-cols-6 gap-1.5'
      : cols > 3
        ? 'grid grid-cols-4 gap-1.5'
        : 'grid grid-cols-2 gap-1.5'

  return (
    <Dialog open={open} onClose={onClose} title="选择站点" width={dialogWidth}>
      {/* Search input & 支持站点切换 — 当站点很多时显示 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {hasUnsupportedSites && dialogMode === 'select' && (
          <div className="flex items-center gap-1 bg-white/[0.04] p-0.5 rounded-full shrink-0">
            <button
              type="button"
              onClick={() => setFilterSupportedOnly(true)}
              className={`px-3 py-1 text-xs rounded-full transition-all ${
                filterSupportedOnly
                  ? 'text-yellow-400 bg-white/10 font-medium'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              可用站点 ({supportedSitesCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterSupportedOnly(false)}
              className={`px-3 py-1 text-xs rounded-full transition-all ${
                !filterSupportedOnly
                  ? 'text-yellow-400 bg-white/10 font-medium'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              全部 ({sites.length})
            </button>
          </div>
        )}
        {sites.length > 10 && (
          <div className="relative flex-1 min-w-[160px]">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索站点名称..."
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-white/[0.06] rounded-full text-white placeholder:text-white/30 outline-none focus:ring-[1.5px] focus:ring-yellow-400/50 transition-all"
            />
          </div>
        )}
      </div>
      <div className="flex gap-4">
        {/* Site grid/list */}
        <div className="flex-1 min-w-0">
          {filteredSites.length === 0 ? (
            <p className="text-sm text-white/50 text-center py-8">无匹配站点</p>
          ) : (
          <div className={viewMode === 'list' ? 'flex flex-col gap-1' : gridClass}>
            {filteredSites.map((site) => {
              const isCurrent = site.key === currentSiteKey
              const checked = selectedKeys.has(site.key)
              const showCheckbox = dialogMode === 'search' || dialogMode === 'change'
              const isSupported = isSupportedContentSite(site)
              const speed = siteSpeeds?.[site.key]

              return (
                <button
                  key={site.key}
                  onClick={() => handleItemClick(site)}
                  disabled={dialogMode === 'select' && !isSupported}
                  title={!isSupported ? 'Android JAR 爬虫（csp_），macOS 暂不支持执行' : site.name}
                  className={`
                    flex items-center gap-2 px-2.5 py-1.5 text-sm rounded-full transition-all duration-200
                    ${viewMode === 'list' ? 'w-full text-left' : 'justify-center'}
                    ${
                      isCurrent && dialogMode === 'select'
                        ? 'text-yellow-400 bg-white/10 ring-[1.5px] ring-yellow-400/40'
                        : !isSupported
                          ? 'text-white/30 bg-white/[0.03] cursor-not-allowed opacity-60'
                          : 'text-white/70 bg-white/[0.06] hover:bg-white/10 hover:text-white/90'
                    }
                    ${showCheckbox ? '' : ''}
                  `}
                >
                  {showCheckbox && (
                    <span className={`shrink-0 w-3.5 h-3.5 rounded border ${
                      checked ? 'bg-yellow-500 border-yellow-500' : 'border-white/40'
                    } flex items-center justify-center`}>
                      {checked && <CheckSquare className="w-2.5 h-2.5 text-black" />}
                    </span>
                  )}
                  <span className="truncate">{site.name}</span>
                  {site.type === 3 && isSupported && (
                    <span className="text-[9px] text-accent/80 shrink-0 border border-accent/30 rounded px-1">JS</span>
                  )}
                  {speed && speed.ok && speed.latency > 0 && (
                    <span
                      className={`text-[9px] font-mono px-1 py-0.2 rounded shrink-0 leading-tight ${
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
                  {speed && !speed.ok && dialogMode !== 'select' && (
                    <span className="text-[9px] text-red-400 bg-red-500/15 font-mono px-1 py-0.2 rounded shrink-0">
                      离线
                    </span>
                  )}
                  {!isSupported && (
                    <span className="text-[9px] text-red-300/40 shrink-0 border border-red-400/20 rounded px-1">
                      {site.api?.startsWith('csp_') ? 'JAR' : '不支持'}
                    </span>
                  )}
                  {isCurrent && dialogMode === 'select' && (
                    <span className="text-[10px] text-yellow-400/70 shrink-0">当前</span>
                  )}
                </button>
              )
            })}
          </div>
          )}
        </div>

        {/* Actions column */}
        <div className="flex flex-col gap-2 shrink-0">
          <button
            onClick={() => setMode(dialogMode === 'search' ? 'select' : 'search')}
            className={`p-2 rounded-full transition-all duration-200 ${
              dialogMode === 'search' ? 'text-yellow-400 bg-white/10' : 'text-white/50 bg-white/[0.06] hover:text-white/80'
            }`}
            title="批量设置搜索"
          >
            <Search className="w-4 h-4" />
          </button>
          <button
            onClick={() => setMode(dialogMode === 'change' ? 'select' : 'change')}
            className={`p-2 rounded-full transition-all duration-200 ${
              dialogMode === 'change' ? 'text-yellow-400 bg-white/10' : 'text-white/50 bg-white/[0.06] hover:text-white/80'
            }`}
            title="批量设置换源"
          >
            <SwitchCamera className="w-4 h-4" />
          </button>
          {(dialogMode === 'search' || dialogMode === 'change') && (
            <>
              <button onClick={handleSelectAll}
                className="p-2 rounded-full text-white/50 bg-white/[0.06] hover:text-white/80 transition-all duration-200" title="全选">
                <CheckSquare className="w-4 h-4" />
              </button>
              <button onClick={handleCancelAll}
                className="p-2 rounded-full text-white/50 bg-white/[0.06] hover:text-white/80 transition-all duration-200" title="取消全选">
                <Square className="w-4 h-4" />
              </button>
            </>
          )}
          <div className="flex-1" />
          <button onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            className="p-2 rounded-full text-white/50 bg-white/[0.06] hover:text-white/80 transition-all duration-200" title="切换布局">
            {viewMode === 'grid' ? <List className="w-4 h-4" /> : <Grid3X3 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {selectedKeys.size > 0 && (
        <DialogFooter align="center">
          <button onClick={() => handleBatchAction(true)}
            className="px-3 py-1.5 text-xs rounded-full bg-accent text-black font-medium hover:bg-accent-hover transition-colors">
            启用 ({selectedKeys.size})
          </button>
          <button onClick={() => handleBatchAction(false)}
            className="px-3 py-1.5 text-xs rounded-full text-white/70 hover:text-white/90 transition-colors bg-white/[0.06]">
            禁用 ({selectedKeys.size})
          </button>
        </DialogFooter>
      )}
    </Dialog>
  )
}
