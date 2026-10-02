import { useCallback, useEffect, useState } from 'react'
import { Download, FolderOpen, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { downloadApi, on, type DownloadTaskInfo } from '@/utils/ipc'
import { formatBytes, formatDuration } from '@/utils/format'

interface ToolInfo {
  name: string
  path?: string
  available: boolean
  bundled: boolean
}

const STATUS_TEXT: Record<string, string> = {
  running: '下载中',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消'
}

/** 下载管理页：任务表在 Rust 侧，窗口刷新/切页不丢进度。 */
export default function Downloads() {
  const [tasks, setTasks] = useState<DownloadTaskInfo[]>([])
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [defaultDir, setDefaultDir] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setTasks(await downloadApi.list())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
    downloadApi
      .tools()
      .then((info) => {
        setTools(info.tools)
        setDefaultDir(info.defaultDir)
      })
      .catch(() => {})

    const off = on('download:progress', (payload: any) => {
      const task = payload?.task as DownloadTaskInfo | undefined
      if (!task) return
      setTasks((prev) => {
        const rest = prev.filter((item) => item.id !== task.id)
        return [task, ...rest].sort((a, b) => b.started_at - a.started_at)
      })
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [refresh])

  const activeTool = tools.find((tool) => tool.available)
  const running = tasks.filter((task) => task.status === 'running').length

  return (
    <div className="h-full flex flex-col">
      {/* 标题栏 */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
        <div className="flex items-center gap-2">
          <Download className="w-5 h-5 text-accent" />
          <h2 className="text-lg font-medium text-text-primary">下载管理</h2>
          <span className="text-xs text-text-muted">({tasks.length})</span>
          {running > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-accent">
              <Loader2 className="w-3 h-3 animate-spin" />
              {running} 个进行中
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void refresh()}
            title="刷新任务列表"
            className="p-1.5 rounded-md text-text-muted transition-colors hover:text-accent hover:bg-white/5"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => void downloadApi.openDir().catch(() => {})}
            title={defaultDir ? `打开下载目录：${defaultDir}` : '打开下载目录'}
            className="p-1.5 rounded-md text-text-muted transition-colors hover:text-accent hover:bg-white/5"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
          <button
            onClick={() => void downloadApi.clearFinished().then(refresh).catch(() => {})}
            title="清除已完成/失败记录"
            className="p-1.5 rounded-md text-text-muted transition-colors hover:text-accent hover:bg-white/5"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 工具与目录 */}
      <div className="shrink-0 border-b border-[#2a2a2a] px-6 py-2 text-xs text-text-muted">
        {activeTool ? (
          <span>
            下载工具 <span className="text-text-secondary">{activeTool.name}</span>
            {activeTool.bundled ? '（内置）' : ''}
            {activeTool.path && <span className="ml-2 opacity-70">{activeTool.path}</span>}
            {defaultDir && <span className="ml-3 opacity-70">保存到 {defaultDir}</span>}
          </span>
        ) : (
          <span className="text-amber-400">未找到下载工具：请把 ffmpeg 放入应用包内 bin/，或 brew install ffmpeg</span>
        )}
      </div>

      {error && <p className="shrink-0 px-6 py-2 text-xs text-red-400">{error}</p>}

      {/* 任务列表 */}
      <div className="flex-1 overflow-y-auto scrollbar-dark px-6 py-4">
        {tasks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Download className="w-8 h-8 text-text-muted" />
            <p className="text-sm text-text-muted">暂无下载任务</p>
            <p className="text-xs text-text-muted">播放页面控制栏的「下载」按钮可以添加任务</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="rounded-xl border border-[#2a2a2a] bg-bg-secondary/60 px-4 py-3 transition-colors hover:border-[#3a3a3a]"
              >
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm text-text-primary" title={task.name}>
                    {task.name}
                  </span>
                  <span
                    className={`shrink-0 text-xs ${
                      task.status === 'done'
                        ? 'text-green-400'
                        : task.status === 'failed'
                          ? 'text-red-400'
                          : task.status === 'running'
                            ? 'text-accent'
                            : 'text-text-muted'
                    }`}
                  >
                    {STATUS_TEXT[task.status] || task.status}
                  </span>
                </div>

                {task.status === 'running' && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full bg-accent ${task.progress > 0 ? '' : 'animate-pulse'}`}
                      style={{ width: task.progress > 0 ? `${Math.round(task.progress * 100)}%` : '35%' }}
                    />
                  </div>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
                  <span>{task.tool}</span>
                  {task.status === 'running' && (
                    <>
                      <span>{task.progress > 0 ? `${Math.round(task.progress * 100)}%` : '准备中'}</span>
                      <span>{formatDuration(task.out_time_ms / 1000)}</span>
                      <span>{formatBytes(task.total_size)}</span>
                      {task.speed && <span>{task.speed}</span>}
                    </>
                  )}
                  {task.status !== 'running' && task.message && <span title={task.message}>{task.message}</span>}
                  <div className="flex-1" />
                  {task.status === 'running' ? (
                    <button
                      onClick={() => void downloadApi.cancel(task.id).then(refresh).catch(() => {})}
                      className="text-text-muted transition-colors hover:text-red-400"
                    >
                      取消
                    </button>
                  ) : (
                    <>
                      {task.status === 'done' && task.path && (
                        <button
                          onClick={() => void downloadApi.reveal(task.path).catch(() => {})}
                          className="text-text-muted transition-colors hover:text-accent"
                        >
                          打开
                        </button>
                      )}
                      <button
                        onClick={() => void downloadApi.remove(task.id).then(refresh).catch(() => {})}
                        className="text-text-muted transition-colors hover:text-red-400"
                      >
                        移除
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
