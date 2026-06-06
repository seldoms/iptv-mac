/**
 * 预加载脚本
 * 通过 contextBridge 暴露 IPC 方法给渲染进程
 */
import { contextBridge, ipcRenderer } from 'electron'

/**
 * 暴露给渲染进程的 API
 * 使用通用 invoke 方法，与前端 ipc.ts 的 window.api.invoke 对齐
 */
const api = {
  /**
   * 通用 IPC invoke 调用
   * 前端通过 window.api.invoke(channel, ...args) 调用
   */
  invoke: (channel: string, ...args: unknown[]) => {
    return ipcRenderer.invoke(channel, ...args)
  },

  /**
   * 监听主进程事件
   */
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const subscription = (_event: unknown, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },

  /**
   * 移除事件监听
   */
  off: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, callback)
  }
}

// 通过 contextBridge 暴露 API 为 window.api
contextBridge.exposeInMainWorld('api', api)
