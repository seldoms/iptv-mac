import { getCurrentWindow } from '@tauri-apps/api/window'

type ResizeDirection =
  | 'East'
  | 'North'
  | 'NorthEast'
  | 'NorthWest'
  | 'South'
  | 'SouthEast'
  | 'SouthWest'
  | 'West'

/**
 * 无边框窗口（精简模式）没有系统缩放边框，macOS 下没法用鼠标拖边缘改大小。
 * 这里铺 8 条透明热区，按下时交给系统开始一次缩放拖拽。
 * 只在精简模式下渲染；有系统边框时由系统自己处理，不叠加。
 *
 * 需要 capabilities/default.json 里的 `core:window:allow-start-resize-dragging`。
 */
const HANDLES: Array<{ direction: ResizeDirection; className: string }> = [
  { direction: 'North', className: 'top-0 left-3 right-3 h-1.5 cursor-ns-resize' },
  { direction: 'South', className: 'bottom-0 left-3 right-3 h-1.5 cursor-ns-resize' },
  { direction: 'West', className: 'left-0 top-3 bottom-3 w-1.5 cursor-ew-resize' },
  { direction: 'East', className: 'right-0 top-3 bottom-3 w-1.5 cursor-ew-resize' },
  { direction: 'NorthWest', className: 'left-0 top-0 w-3 h-3 cursor-nwse-resize' },
  { direction: 'NorthEast', className: 'right-0 top-0 w-3 h-3 cursor-nesw-resize' },
  { direction: 'SouthWest', className: 'left-0 bottom-0 w-3 h-3 cursor-nesw-resize' },
  { direction: 'SouthEast', className: 'right-0 bottom-0 w-3 h-3 cursor-nwse-resize' }
]

export default function WindowResizeHandles() {
  return (
    <>
      {HANDLES.map((handle) => (
        <div
          key={handle.direction}
          data-resize-handle={handle.direction}
          onMouseDown={(event) => {
            event.preventDefault()
            void getCurrentWindow()
              .startResizeDragging(handle.direction)
              .catch((error) => {
                console.warn('[WindowResizeHandles] 启动缩放失败:', error)
              })
          }}
          className={`fixed z-[60] ${handle.className}`}
        />
      ))}
    </>
  )
}
