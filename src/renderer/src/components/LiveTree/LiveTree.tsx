import { memo, useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, Play } from 'lucide-react'

interface Channel {
  name: string
  urls: string[]
  bestUrl: string
  latency: number
  country: string
  category: string
  sortOrder: number
}

interface CategoryNode {
  name: string
  channels: Channel[]
}

interface CountryNode {
  name: string
  categories: CategoryNode[]
}

interface LiveTreeProps {
  tree: {
    countries: CountryNode[]
  }
  onChannelClick: (channel: Channel) => void
  currentChannelName?: string
}

function LiveTree({ tree, onChannelClick, currentChannelName }: LiveTreeProps) {
  const [expandedCountries, setExpandedCountries] = useState<Set<string>>(new Set())
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

  // 自动展开第一个国家节点，以及每个已展开国家的第一个分类
  useEffect(() => {
    setExpandedCountries((prev) => {
      const next = new Set(prev)
      if (tree.countries.length > 0) {
        next.add(tree.countries[0].name)
      }
      return next
    })
  }, [tree])  // eslint-disable-line react-hooks/exhaustive-deps

  // 自动展开每个已展开国家的第一个分类
  useEffect(() => {
    const initial = new Set<string>()
    for (const country of tree.countries) {
      if (expandedCountries.has(country.name) && country.categories.length > 0) {
        initial.add(country.name + '-' + country.categories[0].name)
      }
    }
    setExpandedCategories(initial)
  }, [tree])  // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCountry = (name: string) => {
    const next = new Set(expandedCountries)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setExpandedCountries(next)
  }

  const toggleCategory = (countryName: string, catName: string) => {
    const key = `${countryName}-${catName}`
    const next = new Set(expandedCategories)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setExpandedCategories(next)
  }

  if (!tree.countries || tree.countries.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-text-muted text-xs">
        暂无频道数据，请点击刷新
      </div>
    )
  }

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-dark py-2"
      data-testid="live-channel-tree"
    >
      {tree.countries.map((country) => {
        const isCountryExpanded = expandedCountries.has(country.name)
        return (
          <div key={country.name} className="mb-1">
            {/* 国家节点 */}
            <button
              onClick={() => toggleCountry(country.name)}
              className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-text-secondary hover:text-accent transition-colors"
            >
              {isCountryExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="truncate">{country.name}</span>
              <span className="text-[10px] text-text-muted ml-auto">
                {country.categories.reduce((sum, c) => sum + c.channels.length, 0)}
              </span>
            </button>

            {/* 类别节点 */}
            {isCountryExpanded && (
              <div className="ml-4">
                {country.categories.map((category) => {
                  const catKey = `${country.name}-${category.name}`
                  const isCatExpanded = expandedCategories.has(catKey)
                  return (
                    <div
                      key={catKey}
                      className="mb-0.5"
                      style={{ contentVisibility: 'auto', containIntrinsicSize: '32px' }}
                    >
                      <button
                        onClick={() => toggleCategory(country.name, category.name)}
                        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted hover:text-accent transition-colors"
                      >
                        {isCatExpanded ? (
                          <ChevronDown className="w-3 h-3 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3 h-3 shrink-0" />
                        )}
                        <span className="truncate">{category.name}</span>
                        <span className="text-[10px] text-text-muted ml-auto">
                          {category.channels.length}
                        </span>
                      </button>

                      {/* 频道列表 */}
                      {isCatExpanded && (
                        <div className="ml-4">
                          {category.channels.map((channel, channelIndex) => {
                            const isActive = channel.name === currentChannelName
                            return (
                              <button
                                key={`${channel.name}:${channel.urls?.[0] || 'no-url'}:${channelIndex}`}
                                onClick={() => onChannelClick(channel)}
                                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
                                  isActive
                                    ? 'bg-accent-muted text-accent font-medium'
                                    : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'
                                }`}
                              >
                                <Play className="w-3 h-3 shrink-0" />
                                <span className="truncate flex-1">{channel.name}</span>
                                {channel.latency !== undefined && channel.latency !== -2 && (
                                  <span
                                    className={`text-[10px] ${
                                      channel.latency === -2
                                        ? 'text-text-muted/70'
                                        : channel.latency >= 0
                                          ? 'text-text-muted'
                                          : 'text-red-400/80'
                                    }`}
                                  >
                                    {channel.latency === -2
                                      ? '未验证'
                                      : channel.latency >= 0
                                        ? `${channel.latency}ms`
                                        : '不可用'}
                                  </span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default memo(LiveTree)
