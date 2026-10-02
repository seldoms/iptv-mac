import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(resolve(here, '..', relative), 'utf8')

describe('设置页「关于」区块契约', () => {
  it('只保留版本号，不再展示其它信息', () => {
    const settings = read('src/renderer/src/pages/Settings/Settings.tsx')
    const start = settings.indexOf("{activeTab === 'about'")
    expect(start).toBeGreaterThan(-1)
    const about = settings.slice(start, settings.indexOf('{/* Delete confirmation dialog */}', start))

    expect(about).toContain('版本 {version}')
    expect(about).toContain('文波事业部荣誉出品，感谢文波先生对本项目的全资赞助')
    for (const removed of ['检查更新', 'FomgMi', 'FongMi', '本地服务', 'API Token', 'text-lg font-semibold']) {
      expect(about).not.toContain(removed)
    }
  })
})
