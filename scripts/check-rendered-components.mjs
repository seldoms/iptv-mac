#!/usr/bin/env node
/**
 * 巡检「import 了组件却从没在 JSX 里渲染」的问题。
 *
 * 这类 bug 在本项目里出现过 3 次（MiniPlayer、DownloadPanel、以及订阅栏早期版本），
 * 表现都极其隐蔽：代码看起来齐全（import、state、事件监听都在），
 * 但漏了最后那一行 `<Component ... />`，于是「点了没反应」，且 tsc/vitest 都不会报错。
 *
 * 用法：node scripts/check-rendered-components.mjs   （有发现时退出码 1）
 */
import { readFileSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SRC = join(ROOT, 'src/renderer/src')
/** 这些包的默认导出不是 JSX 组件，或本就通过命名空间使用 */
const IGNORED_MODULES = ['react', 'react-dom/client', 'react-dom/server', 'zustand', 'hls.js', 'dashjs']

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const problems = []
for (const path of walk(SRC)) {
  if (!path.endsWith('.tsx')) continue
  const text = readFileSync(path, 'utf8')
  const importPattern = /^import\s+([A-Z][A-Za-z0-9_]*)\s+from\s+['"]([^'"]+)['"]/gm
  for (const match of text.matchAll(importPattern)) {
    const [, name, module] = match
    if (IGNORED_MODULES.some((ignored) => module.startsWith(ignored))) continue
    const rendered = new RegExp(`<${name}[\\s/>]`).test(text)
    if (!rendered) problems.push(`${relative(ROOT, path)}: 导入 ${name}（来自 ${module}）但从未以 <${name} … /> 渲染`)
  }
}

if (problems.length === 0) {
  console.log('✅ 没有「导入但未渲染」的组件')
  process.exit(0)
}

console.error('❌ 发现「导入但未渲染」的组件：')
for (const problem of problems) console.error(`  - ${problem}`)
process.exit(1)
