import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(resolve(here, '..', relative), 'utf8')

describe('首页分类标签的记忆与选中态', () => {
  it('标签状态放在 store（而不是组件 useState），才能扛过进播放页/详情页/返回', () => {
    const home = read('src/renderer/src/pages/Home/Home.tsx')
    expect(home).toContain('useConfigStore((state) => state.activeCategory)')
    expect(home).toContain('useConfigStore((state) => state.selectedFilters)')
    expect(home).not.toContain("useState<string>('')")
  })

  it('后台测速替换 sites 数组时不得清空用户选的标签', () => {
    const home = read('src/renderer/src/pages/Home/Home.tsx')
    // 重置 effect 只允许依赖站点 key，不能依赖 sites
    expect(home).not.toContain('}, [currentSiteKey, sites])')
    expect(home).toContain('prevSiteKeyRef')
  })

  it('按站点持久化，切站恢复该站点自己的标签', () => {
    const store = read('src/renderer/src/stores/useConfigStore.ts')
    expect(store).toContain('iptv.homeTabs:')
    expect(store).toContain('readHomeTabs')
    expect(store).toContain('writeHomeTabs')
    expect(store).toContain('useConfigStore.subscribe')
  })

  it('选中标签有明确的选中态与无障碍属性', () => {
    const tabs = read('src/renderer/src/components/CategoryTabs/CategoryTabs.tsx')
    expect(tabs).toContain('aria-selected={active}')
    expect(tabs).toContain('data-active')
    expect(tabs).toContain('bg-accent text-bg-primary font-semibold')
  })
})
