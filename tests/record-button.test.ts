import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(resolve(here, '..', relative), 'utf8')

describe('直播录制按钮（红色：录制中闪烁 / 其余常亮）', () => {
  const button = read('src/renderer/src/components/RecordButton/RecordButton.tsx')
  const store = read('src/renderer/src/stores/useRecordingStore.ts')

  it('始终是红色圆点；只有录制中才闪烁', () => {
    expect(button).toContain('text-red-500')
    expect(button).toContain("fill-current ${recording ? 'animate-pulse' : ''}")
  })

  it('录制中点击 = 停止，未录制点击 = 开始', () => {
    expect(button).toContain('if (recording)')
    expect(button).toContain('void onStop()')
    expect(button).toContain('void onStart()')
    expect(button).toContain("aria-pressed={recording}")
  })

  it('录制状态集中在一个 store，直播页与播放器共用', () => {
    expect(store).toContain("export type RecordingStatus = 'idle' | 'recording' | 'recorded'")
    const live = read('src/renderer/src/pages/Live/Live.tsx')
    const player = read('src/renderer/src/components/VideoPlayer/VideoPlayer.tsx')
    expect(live).toContain('RecordButton')
    expect(live).toContain('useRecordingStore')
    expect(player).toContain('RecordButton')
    expect(player).toContain('useRecordingStore')
    // 直播页原来的两套状态（recordingId）必须清干净，否则会各说各话
    expect(live).not.toContain('recordingId')
  })

  it('播放器：直播显示录制按钮、点播显示下载按钮，且都只放图标', () => {
    const player = read('src/renderer/src/components/VideoPlayer/VideoPlayer.tsx')
    expect(player).toContain('isLivePlayback ? (')
    expect(player).toContain('compact')
    expect(player).toContain('下载当前媒体（m3u8/HLS）')
    // 下载/录制按钮不再带可见文字（窄屏被挤占的根因）
    expect(player).not.toContain('>下载\n')
  })
})
