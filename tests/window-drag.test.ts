import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8')

describe('窗口拖动契约', () => {
  it('用了 data-tauri-drag-region，就必须授予 core:window:allow-start-dragging', () => {
    // Tauri 的 drag.js 会 invoke('plugin:window|start_dragging')；
    // core:window:default 里没有这个权限，缺失时拖动被静默拒绝（无任何报错）。
    const app = read('src/renderer/src/App.tsx')
    expect(app).toContain('data-tauri-drag-region')

    const capabilities = JSON.parse(read('src-tauri/capabilities/default.json'))
    expect(capabilities.permissions).toContain('core:window:allow-start-dragging')
  })

  it('无边框模式要靠 start-resize-dragging 才能从边缘缩放', () => {
    const capabilities = JSON.parse(read('src-tauri/capabilities/default.json'))
    expect(capabilities.permissions).toContain('core:window:allow-start-resize-dragging')
  })

  it('拖动区用 deep，点标题文字也能拖（裸属性只认直接点击该元素）', () => {
    const app = read('src/renderer/src/App.tsx')
    expect(app).toContain('data-tauri-drag-region="deep"')
  })
})
