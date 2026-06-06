/**
 * 全局类型声明
 * window.api 由 preload 脚本注入
 */
export {}

declare global {
  interface Window {
    api: {
      invoke: (channel: string, ...args: unknown[]) => Promise<any>
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void
      off: (channel: string, callback: (...args: unknown[]) => void) => void
    }
  }
}
