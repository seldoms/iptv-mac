import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(here, '..', 'src/renderer/src')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

/** 只匹配「用代码注册/派发命名空间事件」，注释里提到事件名不算 */
const PATTERNS = [
  /dispatchEvent\(\s*new\s+(?:Custom)?Event\(\s*['"]([a-zA-Z]+:[a-zA-Z]+)['"]/g,
  /addEventListener\(\s*['"]([a-zA-Z]+:[a-zA-Z]+)['"]/g
]

describe('前端不再使用 window 自定义事件做跨组件通信', () => {
  it('全部改为显式 store 状态（审计 P0）', () => {
    const offenders: string[] = []
    for (const path of walk(SRC)) {
      if (!path.endsWith('.ts') && !path.endsWith('.tsx')) continue
      const text = readFileSync(path, 'utf8')
      for (const pattern of PATTERNS) {
        for (const match of text.matchAll(pattern)) {
          offenders.push(`${relative(SRC, path)}: ${match[1]}`)
        }
      }
    }
    expect(offenders, `发现仍然使用 window 自定义事件:\n${offenders.join('\n')}`).toEqual([])
  })

  it('播放器信号与弹幕/字幕都走 player store', () => {
    const store = readFileSync(resolve(SRC, 'stores/usePlayerStore.ts'), 'utf8')
    expect(store).toContain('sendPlayerSignal')
    expect(store).toContain('playerSignal')
    expect(store).toContain('sendDanmaku')
    expect(store).toContain('loadSubtitle')
  })
})
