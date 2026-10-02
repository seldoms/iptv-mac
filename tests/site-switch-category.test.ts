import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validActiveCategory } from '../src/renderer/src/stores/useConfigStore'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(resolve(here, '..', relative), 'utf8')

const cat = (type_id: string, type_name: string) => ({ type_id, type_name })

/** 取 from 之后、下一个 to 之前的内容（两个标记都从 from 之后再找，避免命中接口声明） */
function between(text: string, from: string, to: string): string {
  const start = text.indexOf(from)
  if (start < 0) return ''
  const end = text.indexOf(to, start + from.length)
  return end < 0 ? text.slice(start) : text.slice(start, end)
}

describe('换站点后的分类标签（暂无数据的根因）', () => {
  it('记住的分类只要还属于当前站点就保留', () => {
    const categories = [cat('1', '电影'), cat('2', '电视剧')]
    expect(validActiveCategory(categories, '2')).toBe('2')
  })

  it('分类不属于当前站点时清空，避免一直请求一个不存在的分类', () => {
    const categories = [cat('1', '电影'), cat('2', '电视剧')]
    expect(validActiveCategory(categories, '99')).toBe('')   // 旧站点的 type_id
    expect(validActiveCategory(categories, '电影')).toBe('') // 别站点的名字
  })

  it('空选中与「首页」保持原样', () => {
    expect(validActiveCategory([cat('1', '电影')], '')).toBe('')
    expect(validActiveCategory([cat('1', '电影')], '首页')).toBe('首页')
  })

  it('站点没有分类列表时不武断清空', () => {
    expect(validActiveCategory([], '5')).toBe('5')
  })
})

describe('切站时的守卫（契约）', () => {
  const store = read('src/renderer/src/stores/useConfigStore.ts')
  const home = read('src/renderer/src/pages/Home/Home.tsx')
  const tabs = read('src/renderer/src/components/CategoryTabs/CategoryTabs.tsx')

  it('切站期间忽略分类请求（屏幕上的标签还是旧站点的，发出去必然空）', () => {
    const fn = between(store, 'fetchCategoryContent: async', 'setCurrentSiteKey: (key: string) => set(')
    expect(fn).toContain('if (get().pendingSiteKey)')
    expect(fn).toContain('站点切换中，忽略分类请求')
  })

  it('分类请求打到"当前正在显示内容的站点"', () => {
    const fn = between(store, 'fetchCategoryContent: async', 'setCurrentSiteKey: (key: string) => set(')
    expect(fn).toContain('get().contentSiteKey || get().currentSiteKey')
  })

  it('新分类到达时校验 activeCategory（记住的 type_id 可能已不属于该站点）', () => {
    const matches = store.match(/activeCategory: validActiveCategory\(/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(5)
  })

  it('保留旧内容防闪白（既有行为不能被我改掉）', () => {
    const fn = between(store, 'switchSite: async', 'fetchHomeContent:')
    expect(fn).toContain('故意保留')
    // 初始 set 块（try 之前）不能清空站点级数据，否则切站会闪"暂无内容"
    const initialSet = between(fn, 'set({', 'try {')
    expect(initialSet).not.toContain('categories: []')
    expect(initialSet).not.toContain('homeVideos: []')
  })

  it('内容未就绪的站点不接受标签写入', () => {
    expect(store).toContain('if (state.contentSiteKey) {')
    expect(store).not.toContain('writeHomeTabs(state.contentSiteKey || state.currentSiteKey')
  })

  it('切站期间标签置灰，从源头杜绝点旧标签', () => {
    expect(home).toContain('disabled={Boolean(pendingSiteKey)}')
    expect(tabs).toContain('disabled = false')
    expect(tabs).toContain('disabled={disabled}')
  })
})
