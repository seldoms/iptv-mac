import { describe, expect, it } from 'vitest'
import {
  isResumable,
  pickResumeTarget,
  resumePositionForEpisode
} from '../src/renderer/src/utils/resume'

const history = (over: Partial<{ sourceIndex: number; episodeIndex: number; positionSeconds: number; completed: boolean }> = {}) => ({
  sourceIndex: 0,
  episodeIndex: 4,
  positionSeconds: 1200,
  completed: false,
  ...over
})

const base = {
  sessionActive: false,
  sessionEpisodeIndex: 0,
  sessionPositionSeconds: 0,
  episodeCount: 24,
  activeLineIsHistory: true
}

describe('isResumable', () => {
  it('未看完且进度超过 5 秒才算可续播', () => {
    expect(isResumable(history())).toBe(true)
    expect(isResumable(history({ positionSeconds: 3 }))).toBe(false)
    expect(isResumable(history({ completed: true }))).toBe(false)
    expect(isResumable(null)).toBe(false)
    expect(isResumable(undefined)).toBe(false)
  })
})

describe('pickResumeTarget — 再次点开同一部电影', () => {
  it('冷启动：回到历史那一集与进度（用户报的场景）', () => {
    expect(pickResumeTarget({ ...base, history: history() })).toEqual({
      episodeIndex: 4,
      positionSeconds: 1200
    })
  })

  it('历史已看完：从目标集开头开始', () => {
    expect(pickResumeTarget({ ...base, history: history({ completed: true, positionSeconds: 0 }) })).toEqual({
      episodeIndex: 0,
      positionSeconds: 0
    })
  })

  it('历史进度太短（≤5 秒）：不续播', () => {
    expect(pickResumeTarget({ ...base, history: history({ positionSeconds: 4 }) })).toEqual({
      episodeIndex: 0,
      positionSeconds: 0
    })
  })

  it('没有历史：从第 1 集开头开始', () => {
    expect(pickResumeTarget({ ...base, history: null })).toEqual({ episodeIndex: 0, positionSeconds: 0 })
  })

  it('没有历史且 store 里残留上一部片的集数：新片仍从第 1 集开始', () => {
    expect(
      pickResumeTarget({ ...base, history: null, sessionActive: false, sessionEpisodeIndex: 10 })
    ).toEqual({ episodeIndex: 0, positionSeconds: 0 })
  })

  it('当前线路不是历史线路：不跨线路套用进度', () => {
    expect(pickResumeTarget({ ...base, history: history(), activeLineIsHistory: false })).toEqual({
      episodeIndex: 0,
      positionSeconds: 0
    })
  })

  it('本次会话已开播：以播放器实时进度为准（挂载时的旧历史不能覆盖它）', () => {
    expect(
      pickResumeTarget({
        ...base,
        history: history({ episodeIndex: 4, positionSeconds: 1200 }),
        sessionActive: true,
        sessionEpisodeIndex: 6,
        sessionPositionSeconds: 2450
      })
    ).toEqual({ episodeIndex: 6, positionSeconds: 2450 })
  })

  it('会话刚开播不足 3 秒：不 seek', () => {
    expect(
      pickResumeTarget({ ...base, history: null, sessionActive: true, sessionEpisodeIndex: 2, sessionPositionSeconds: 1 })
    ).toEqual({ episodeIndex: 2, positionSeconds: 0 })
  })

  it('集数越界时夹紧到合法范围', () => {
    expect(pickResumeTarget({ ...base, history: history({ episodeIndex: 99 }), episodeCount: 6 })).toEqual({
      episodeIndex: 5,
      positionSeconds: 1200
    })
    expect(
      pickResumeTarget({ ...base, history: null, sessionActive: true, sessionEpisodeIndex: 99, episodeCount: 6 })
    ).toEqual({ episodeIndex: 5, positionSeconds: 0 })
  })

  it('集数为 0（线路还没解析出来）时不崩，索引归 0', () => {
    expect(pickResumeTarget({ ...base, history: history(), episodeCount: 0 })).toEqual({
      episodeIndex: 0,
      positionSeconds: 1200
    })
  })
})

describe('resumePositionForEpisode — 点击集数按钮', () => {
  it('点开历史那一集：带上进度', () => {
    expect(resumePositionForEpisode(history(), 0, 4, 0, 4)).toBe(1200)
  })

  it('点开别的集：从 0 开始', () => {
    expect(resumePositionForEpisode(history(), 0, 0, 0, 4)).toBe(0)
    expect(resumePositionForEpisode(history(), 1, 4, 0, 4)).toBe(0)
  })

  it('历史不可续播时一律从 0 开始', () => {
    expect(resumePositionForEpisode(history({ completed: true }), 0, 4, 0, 4)).toBe(0)
    expect(resumePositionForEpisode(null, 0, 4, 0, 4)).toBe(0)
  })
})
