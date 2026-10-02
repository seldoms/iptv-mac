import { create } from 'zustand'

/**
 * 直播录制状态（直播页的「录制」按钮与播放器控制栏的录制按钮共用）。
 *
 * 两个入口共用一份状态，否则会出现「播放器显示在录、直播页显示没录」这种自相矛盾。
 * 视觉约定（用户指定）：录制中 → 红色圆点**闪烁**；未在录制（含录完）→ 红色圆点**常亮**。
 */
export type RecordingStatus = 'idle' | 'recording' | 'recorded'

interface RecordingState {
  taskId: string | null
  status: RecordingStatus
  /** 当前直播频道名（播放器侧发起录制时用来命名文件） */
  sourceName: string
  startRecording: (taskId: string) => void
  /** 录制结束（用户停止 / 任务完成 / 失败）→ 常亮 */
  finishRecording: () => void
  /** 复位成"从未录制" */
  resetRecording: () => void
  setSourceName: (sourceName: string) => void
}

export const useRecordingStore = create<RecordingState>((set) => ({
  taskId: null,
  status: 'idle',
  sourceName: '',
  startRecording: (taskId) => set({ taskId, status: 'recording' }),
  finishRecording: () => set({ taskId: null, status: 'recorded' }),
  resetRecording: () => set({ taskId: null, status: 'idle' }),
  setSourceName: (sourceName) => set({ sourceName })
}))
