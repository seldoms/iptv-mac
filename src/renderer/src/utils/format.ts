/**
 * 共享格式化工具。
 *
 * 这些函数原先在 VideoPlayer / MiniPlayer / History / Downloads 各有一份实现
 * （见 docs/CODE_AUDIT.md P1），统一到这里，避免单位与精度分叉。
 */

/** `mm:ss`：分钟可以超过 60（播放进度、迷你播放器用，保持原有语义） */
export function formatClock(seconds: number): string {
  if (!seconds || Number.isNaN(seconds)) return '00:00'
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`
}

/** `h:mm:ss`，不足一小时为 `m:ss`（历史记录、下载时长用，保持原有语义） */
export function formatDuration(seconds = 0): string {
  const safe = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const rest = safe % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

/** 人类可读体积；0/缺省显示 `-` */
export function formatBytes(bytes: number): string {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 相对时间：刚刚 / N分钟前 / N小时前 / 本地日期 */
export function formatRelativeTime(timestamp: number): string {
  const date = new Date(timestamp)
  const diff = Date.now() - date.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`
  return date.toLocaleDateString('zh-CN')
}

/** 吞吐/码率显示：未知或异常值显示 `--`，避免出现 NaN/0/天文数字 */
export function formatThroughput(kbps: number | null | undefined): string {
  if (kbps === null || kbps === undefined || !Number.isFinite(kbps) || kbps <= 0) return '--'
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(kbps >= 10000 ? 0 : 1)} Mbps`
  return `${Math.round(kbps)} Kbps`
}

/**
 * 指数平滑吞吐值。
 * 拒绝非有限值、非正数与明显不合理的尖峰（>500Mbps，直播里通常意味着首次分片计时包含了建连时间）。
 */
export function smoothThroughput(previous: number | null, next: number | null): number | null {
  if (next === null || !Number.isFinite(next) || next <= 0 || next > 500_000) return previous
  return previous === null ? next : previous * 0.6 + next * 0.4
}
