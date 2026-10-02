import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(resolve(here, '..', relative), 'utf8')

describe('下载管理入口契约', () => {
  it('侧边栏「下载」是普通路由，而不是靠事件弹出浮层', () => {
    const sidebar = read('src/renderer/src/components/Sidebar/Sidebar.tsx')
    expect(sidebar).toContain("label: '下载', path: '/downloads'")
    expect(sidebar).not.toContain('download:openPanel')
  })

  it('App 注册了 /downloads 路由', () => {
    const app = read('src/renderer/src/App.tsx')
    expect(app).toContain('path="/downloads"')
    expect(app).toContain("import Downloads from './pages/Downloads/Downloads'")
  })

  it('播放页点下载后不再跳走或弹窗，只给就地提示', () => {
    const player = read('src/renderer/src/components/VideoPlayer/VideoPlayer.tsx')
    expect(player).toContain('downloadNotice')
    expect(player).not.toContain('download:openPanel')
  })

  it('下载页仍然读取 Rust 侧任务表与工具信息', () => {
    const page = read('src/renderer/src/pages/Downloads/Downloads.tsx')
    expect(page).toContain('downloadApi.list()')
    expect(page).toContain('.tools()')
    expect(page).toContain("on('download:progress'")
  })
})
