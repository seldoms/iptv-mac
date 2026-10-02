import { invoke } from './ipc'

/**
 * 把 WebView 里的报错转发到进程 stderr（应用日志）。
 *
 * 背景：前端 `console.error` 只在 WebView 控制台里，应用日志只有 Rust 侧输出，
 * 排查线上问题时等于"看不见"。这里挂 window 级错误钩子 + 包装 console.error/warn，
 * 统一走 `log:frontend` 落进 /tmp/iptv-app.log（键 `[renderer/...]`）。
 */
function stringify(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function forward(level: 'error' | 'warn', message: string, detail?: string): void {
  void invoke('log:frontend', level, message, detail).catch(() => {})
}

export function installFrontendLogBridge(): void {
  const originalError = console.error
  const originalWarn = console.warn

  console.error = (...args: unknown[]) => {
    originalError(...args)
    const [first, ...rest] = args
    forward('error', stringify(first), rest.map(stringify).join(' ').slice(0, 800))
  }
  console.warn = (...args: unknown[]) => {
    originalWarn(...args)
    const [first, ...rest] = args
    forward('warn', stringify(first), rest.map(stringify).join(' ').slice(0, 400))
  }

  window.addEventListener('error', (event) => {
    forward('error', `window.onerror: ${event.message}`, `${event.filename}:${event.lineno}:${event.colno}`)
  })
  window.addEventListener('unhandledrejection', (event) => {
    forward('error', 'unhandledrejection', stringify(event.reason).slice(0, 800))
  })
}
