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

function forward(level: 'error' | 'warn' | 'info', message: string, detail?: string): void {
  void invoke('log:frontend', level, message, detail).catch(() => {})
}

export function installFrontendLogBridge(): void {
  // 这些前缀是"启动/加载链路"的关键轨迹：出问题（比如一直转圈）时日志里必须能看到卡在哪
  const TRACED_PREFIXES = ['[ConfigStore]', '[App]', '[Live]', '[continuity]', '[stats]']
  const originalError = console.error
  const originalWarn = console.warn
  const originalLog = console.log

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

  console.log = (...args: unknown[]) => {
    originalLog(...args)
    const text = stringify(args[0])
    if (TRACED_PREFIXES.some((prefix) => text.startsWith(prefix))) {
      forward('info', text, args.slice(1).map(stringify).join(' ').slice(0, 400))
    }
  }

  window.addEventListener('error', (event) => {
    forward('error', `window.onerror: ${event.message}`, `${event.filename}:${event.lineno}:${event.colno}`)
  })
  window.addEventListener('unhandledrejection', (event) => {
    forward('error', 'unhandledrejection', stringify(event.reason).slice(0, 800))
  })
}
