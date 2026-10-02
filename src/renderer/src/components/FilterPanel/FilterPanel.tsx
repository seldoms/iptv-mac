import type { Filter } from '@/stores/useConfigStore'

interface FilterPanelProps {
  filters: Filter[]
  selectedFilters: Record<string, string>
  onChange: (key: string, value: string) => void
}

/**
 * 筛选面板 — FongMi TV 风格
 * 半透明底 + 黄色高亮 + pill 按钮
 */
export default function FilterPanel({ filters, selectedFilters, onChange }: FilterPanelProps) {
  if (filters.length === 0) return null

  return (
    <div className="py-2 space-y-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      {filters.map((filter) => (
        <div key={filter.key} className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-white/50 shrink-0 w-12">{filter.name}:</span>
          {filter.value.map((v) => (
            <button
              key={v.v}
              onClick={() => onChange(filter.key, v.v)}
              className={`px-2 py-0.5 text-xs rounded-full transition-all duration-200 ${
                selectedFilters[filter.key] === v.v
                  ? 'text-yellow-400 bg-white/10'
                  : 'text-white/60 hover:text-white/80 bg-white/[0.04] hover:bg-white/[0.08]'
              }`}
            >
              {v.n}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}