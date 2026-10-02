import { useEffect, useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Category, Filter } from '@/stores/useConfigStore'

interface CategoryTabsProps {
  categories: Category[]
  activeCategory: string
  /** 切站过程中为 true：此时标签仍属于旧站点，点它只会拿到空数据 */
  disabled?: boolean
  onSelect: (tid: string) => void
  hasFilters: boolean
  showFilter: boolean
  onToggleFilter: () => void
}

/**
 * 分类标签栏 — FongMi TV adapter_type.xml 风格
 * 28px 圆角 pill 样式, 选中黄色文字 + 半透明黑底
 */
export default function CategoryTabs({
  categories,
  activeCategory,
  disabled = false,
  onSelect,
  hasFilters,
  showFilter,
  onToggleFilter
}: CategoryTabsProps) {
  // 选中的标签自动滚到可见区域（分类很多时切到靠后的标签不会被藏在滚动区外）
  const activeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [activeCategory])

  if (categories.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hidden py-1.5">
      {categories.map((cat) => {
        const active = activeCategory === cat.type_id
        return (
          <button
            key={cat.type_id}
            ref={active ? activeRef : undefined}
            onClick={() => onSelect(cat.type_id)}
            disabled={disabled}
            aria-selected={active}
            data-active={active ? 'true' : 'false'}
            className={`shrink-0 px-3 py-1 text-xs rounded-full transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? 'bg-accent text-bg-primary font-semibold shadow-sm'
                : 'text-white/70 hover:text-white/90 hover:bg-white/[0.06]'
            }`}
          >
            {cat.type_name}
          </button>
        )
      })}
      {hasFilters && activeCategory && (
        <button
          onClick={onToggleFilter}
          aria-expanded={showFilter}
          className={`shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs rounded-full transition-all duration-200 ${
            showFilter
              ? 'bg-accent/80 text-bg-primary font-semibold'
              : 'text-white/60 hover:text-white/80 hover:bg-white/[0.06]'
          }`}
        >
          筛选
          <ChevronDown className={`w-3 h-3 transition-transform ${showFilter ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  )
}