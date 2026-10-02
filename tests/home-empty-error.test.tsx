import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Home from '../src/renderer/src/pages/Home/Home'

vi.mock('@/stores/useConfigStore', () => ({
  useConfigStore: () => ({
    currentConfig: null,
    sites: [],
    currentSiteKey: '',
    contentSiteKey: '',
    pendingSiteKey: '',
    categories: [],
    filters: {},
    homeVideos: [],
    categoryVideos: [],
    currentPage: 1,
    hasMore: false,
    isLoading: false,
    error: '加载配置失败：网络不可用',
    switchSite: vi.fn(),
    fetchCategoryContent: vi.fn(),
    loadConfig: vi.fn()
  })
}))

describe('Home empty config state', () => {
  it('shows config load errors when no config has been loaded yet', () => {
    const html = renderToString(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    )

    expect(html).toContain('加载配置失败：网络不可用')
  })
})
