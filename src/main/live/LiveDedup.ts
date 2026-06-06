/**
 * 直播频道去重选优器
 * 合并同频道多 URL，按延迟排序
 */
import type { MergedChannel } from '../../shared/types'
import type { TestResult } from './LiveTester'

/**
 * 标准化频道名（用于去重匹配）
 * 转小写、去空格、去特殊字符
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[-_\u2014\s]/g, '')
    .trim()
}

/**
 * 去重合并频道
 */
export function dedupChannels(
  channels: Array<{
    name: string
    urls: string[]
    testResults: TestResult[]
    originalGroups: string[]
  }>
): MergedChannel[] {
  // 按标准化名称分组
  const groupMap = new Map<string, Array<{
    name: string
    urls: string[]
    testResults: TestResult[]
    originalGroups: string[]
  }>>()

  for (const ch of channels) {
    const normalized = normalizeName(ch.name)
    if (!groupMap.has(normalized)) {
      groupMap.set(normalized, [])
    }
    groupMap.get(normalized)!.push(ch)
  }

  // 合并每组频道
  const merged: MergedChannel[] = []

  for (const [normalized, group] of groupMap) {
    // 使用原始名称（取第一个非空名称）
    const displayName = group.find((g) => g.name)?.name || ''

    // 合并所有测试结果
    const allResults: TestResult[] = []
    const allGroups: string[] = []
    const allUrls: string[] = []
    const seenUrls = new Set<string>()

    for (const ch of group) {
      for (const url of ch.urls) {
        if (!seenUrls.has(url)) {
          seenUrls.add(url)
          allUrls.push(url)
        }
      }
      for (const result of ch.testResults) {
        allResults.push(result)
      }
      for (const g of ch.originalGroups) {
        if (!allGroups.includes(g)) {
          allGroups.push(g)
        }
      }
    }

    // 过滤可用 URL，按延迟排序
    const availableUrls = allResults
      .filter((r) => r.alive)
      .sort((a, b) => {
        if (a.latency === -1) return 1
        if (b.latency === -1) return -1
        return a.latency - b.latency
      })
      .map((r) => r.url)

    // 跳过没有任何可用 URL 的频道
    if (availableUrls.length === 0) continue

    const bestResult = allResults
      .filter((r) => r.alive && r.url === availableUrls[0])[0]

    merged.push({
      name: displayName,
      urls: availableUrls,
      bestUrl: availableUrls[0],
      latency: bestResult ? bestResult.latency : -1,
      country: '',        // 分类器会填充
      category: '',       // 分类器会填充
      sortOrder: 0,       // 分类器会填充
      originalGroups: allGroups
    })
  }

  return merged
}
