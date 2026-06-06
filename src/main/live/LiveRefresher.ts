/**
 * 直播源刷新管理器
 * 负责定时刷新、流程协调、进度推送
 */
import { BrowserWindow } from 'electron'
import type { RefreshProgress, RefreshStatus, MergedChannel } from '../../shared/types'
import type { TestResult } from './LiveTester'
import { loadLiveSource } from '../config/LiveConfig'
import { getCurrentConfig, getConfigList } from '../config/ConfigManager'
import { loadVodConfig } from '../config/VodConfig'
import { testBatch } from './LiveTester'
import { dedupChannels } from './LiveDedup'
import { classifyChannels, buildTree } from './LiveClassifier'
import { saveLiveChannels, updateRefreshStatus } from '../store/Database'

let refreshTimer: NodeJS.Timeout | null = null
let isRefreshing = false
let refreshInterval = 30 * 60 * 1000 // 默认 30 分钟
let lastRefreshTime = 0

/**
 * 启动定时刷新
 */
export function startAutoRefresh(): void {
  stopAutoRefresh()

  refreshTimer = setInterval(async () => {
    if (!isRefreshing) {
      await doRefresh()
    }
  }, refreshInterval)

  console.log(`[LiveRefresher] 启动定时刷新，间隔: ${refreshInterval / 60000} 分钟`)
}

/**
 * 停止定时刷新
 */
export function stopAutoRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

/**
 * 设置刷新间隔（分钟）
 */
export function setRefreshInterval(minutes: number): void {
  refreshInterval = minutes * 60 * 1000
  console.log(`[LiveRefresher] 设置刷新间隔: ${minutes} 分钟`)

  if (refreshTimer) {
    startAutoRefresh()
  }

  updateRefreshStatus({ refreshIntervalMinutes: minutes })
}

/**
 * 获取刷新状态
 */
export function getRefreshStatus(): RefreshStatus {
  return {
    isRefreshing,
    lastRefreshTime,
    nextRefreshTime: lastRefreshTime + refreshInterval,
    progress: null,
    interval: Math.round(refreshInterval / 60000)
  }
}

/**
 * 手动触发刷新
 */
export async function triggerRefresh(): Promise<void> {
  if (isRefreshing) {
    console.log('[LiveRefresher] 正在刷新中，跳过')
    return
  }
  await doRefresh()
}

/**
 * 执行刷新流程
 */
async function doRefresh(): Promise<void> {
  if (isRefreshing) return
  isRefreshing = true

  const startTime = Date.now()
  console.log('[LiveRefresher] 开始刷新直播源...')

  await updateRefreshStatus({ status: 'refreshing' })

  try {
    // 1. 加载所有配置的直播源
    await sendProgress({
      phase: 'loading',
      current: 0,
      total: 0,
      message: '正在加载直播源...'
    })

    const allChannels = await loadAllLiveSources()
    const totalUrls = allChannels.reduce((sum, ch) => sum + ch.urls.length, 0)

    console.log(`[LiveRefresher] 加载完成: ${allChannels.length} 个频道, ${totalUrls} 个 URL`)

    if (allChannels.length === 0) {
      console.log('[LiveRefresher] 无可用直播源')
      await sendProgress({
        phase: 'error',
        current: 0,
        total: 0,
        message: '无可用直播源'
      })
      return
    }

    // 2. 连通性测试
    await sendProgress({
      phase: 'testing',
      current: 0,
      total: totalUrls,
      message: `正在测试 URL 连通性 (0/${totalUrls})`
    })

    const testResults = await testAllUrls(allChannels, (current, total) => {
      sendProgress({
        phase: 'testing',
        current,
        total,
        message: `正在测试 URL 连通性 (${current}/${total})`
      })
    })

    // 3. 去重选优
    await sendProgress({
      phase: 'dedup',
      current: 0,
      total: 1,
      message: '正在去重选优...'
    })

    const mergedChannels = dedupChannels(
      allChannels.map((ch, idx) => ({
        name: ch.name,
        urls: ch.urls,
        testResults: testResults[idx] || [],
        originalGroups: []
      }))
    )

    console.log(`[LiveRefresher] 去重完成: ${mergedChannels.length} 个频道`)

    // 4. 智能分类
    await sendProgress({
      phase: 'classifying',
      current: 0,
      total: 1,
      message: '正在智能分类...'
    })

    const classifiedChannels = classifyChannels(mergedChannels)
    const tree = buildTree(classifiedChannels)

    console.log(`[LiveRefresher] 分类完成: ${tree.countries.length} 个国家`)

    // 5. 存入数据库
    await sendProgress({
      phase: 'saving',
      current: 0,
      total: 1,
      message: '正在保存...'
    })

    await saveLiveChannels(
      classifiedChannels.map((ch) => ({
        name: ch.name,
        urls: ch.urls,
        bestUrl: ch.bestUrl,
        country: ch.country,
        category: ch.category,
        sortOrder: ch.sortOrder,
        latency: ch.latency,
        originalGroups: ch.originalGroups
      }))
    )

    lastRefreshTime = Date.now()

    await updateRefreshStatus({
      lastRefreshTime,
      nextRefreshTime: lastRefreshTime + refreshInterval,
      totalChannels: classifiedChannels.length,
      aliveChannels: classifiedChannels.length,
      status: 'idle'
    })

    // 6. 通知渲染进程刷新完成
    await sendProgress({
      phase: 'done',
      current: classifiedChannels.length,
      total: classifiedChannels.length,
      message: `刷新完成，共 ${classifiedChannels.length} 个频道`
    })

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[LiveRefresher] 刷新完成，耗时 ${elapsed}s`)

  } catch (err) {
    console.error('[LiveRefresher] 刷新失败:', err)
    await updateRefreshStatus({ status: 'error' })
    await sendProgress({
      phase: 'error',
      current: 0,
      total: 0,
      message: `刷新失败: ${(err as Error).message}`
    })
  } finally {
    isRefreshing = false
  }
}

/**
 * 加载所有配置的直播源
 */
async function loadAllLiveSources(): Promise<Array<{ name: string; urls: string[] }>> {
  const allChannels: Array<{ name: string; urls: string[] }> = []
  const seen = new Set<string>()

  // 获取当前配置
  const currentConfig = getCurrentConfig()
  if (currentConfig?.lives) {
    for (const live of currentConfig.lives) {
      try {
        const groups = await loadLiveSource(live)
        for (const group of groups) {
          for (const ch of group.channel || []) {
            if (!seen.has(ch.name)) {
              seen.add(ch.name)
              allChannels.push({
                name: ch.name,
                urls: ch.urls || []
              })
            }
          }
        }
      } catch (err) {
        console.warn(`[LiveRefresher] 加载直播源失败 [${live.name}]:`, err)
      }
    }
  }

  // 获取其他配置的直播源
  try {
    const configList = getConfigList()

    for (const cfg of configList) {
      if (currentConfig && cfg.url === currentConfig.url) continue

      try {
        const vodConfig = await loadVodConfig(cfg.url)
        if (vodConfig.lives) {
          for (const live of vodConfig.lives) {
            try {
              const groups = await loadLiveSource(live)
              for (const group of groups) {
                for (const ch of group.channel || []) {
                  if (!seen.has(ch.name)) {
                    seen.add(ch.name)
                    allChannels.push({
                      name: ch.name,
                      urls: ch.urls || []
                    })
                  }
                }
              }
            } catch (err) {
              console.warn(`[LiveRefresher] 加载直播源失败 [${live.name}]:`, err)
            }
          }
        }
      } catch (err) {
        console.warn(`[LiveRefresher] 加载配置失败 [${cfg.url}]:`, err)
      }
    }
  } catch (err) {
    console.warn('[LiveRefresher] 获取配置列表失败:', err)
  }

  return allChannels
}

/**
 * 测试所有 URL
 */
async function testAllUrls(
  channels: Array<{ name: string; urls: string[] }>,
  onProgress: (current: number, total: number) => void
): Promise<TestResult[][]> {
  const allUrls: string[] = []

  for (let i = 0; i < channels.length; i++) {
    for (const url of channels[i].urls) {
      allUrls.push(url)
    }
  }

  if (allUrls.length === 0) return []

  const results = await testBatch(allUrls, { concurrency: 10, retries: 1, timeout: 5000 }, onProgress)

  const grouped: TestResult[][] = []
  let urlIdx = 0
  for (let i = 0; i < channels.length; i++) {
    const chResults: TestResult[] = []
    for (let j = 0; j < channels[i].urls.length; j++) {
      if (urlIdx < results.length) {
        chResults.push(results[urlIdx])
        urlIdx++
      }
    }
    grouped.push(chResults)
  }

  return grouped
}

/**
 * 发送进度到渲染进程
 */
async function sendProgress(progress: RefreshProgress): Promise<void> {
  const win = BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) {
    win.webContents.send('live:refreshProgress', progress)
  }
}
