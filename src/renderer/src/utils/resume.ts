/**
 * 断点续播的目标选择（纯函数，便于回归测试）。
 *
 * 背景：此前详情页只有「继续 第X集 · 时间」按钮会带上历史进度，主「播放」按钮与集数按钮
 * 固定传 `startPositionSeconds = 0`，而 `handlePlay` 又会把 0 写回历史，
 * 于是"再次点开同一部电影"既不续播、还会把已保存的进度清零。
 *
 * 规则：
 * 1. 本次会话已经开播这部片 → 以播放器实时状态为准（挂载时读到的数据库历史可能已过期）；
 * 2. 冷启动且历史可续播、当前线路就是历史线路 → 回到历史那一集与进度；
 * 3. 其它情况 → 从目标集开头开始。
 */

export interface ResumeHistoryLike {
  sourceIndex?: number | null
  episodeIndex?: number | null
  positionSeconds?: number | null
  completed?: boolean
}

/** 与 `VodDetail`、`HistoryCarousel` 一致的口径：未看完且进度超过 5 秒才值得续播 */
export function isResumable(history?: ResumeHistoryLike | null): boolean {
  return Boolean(history && !history.completed && (history.positionSeconds || 0) > 5)
}

function clampIndex(value: number, count: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(Math.floor(value), Math.max(0, count - 1))
}

/**
 * 点开的就是历史那一集（同一线路、同一集）时才带上进度，
 * 否则"看了第 5 集却点第 1 集"会莫名其妙跳到 20 分钟处。
 */
export function resumePositionForEpisode(
  history: ResumeHistoryLike | null | undefined,
  lineIndex: number,
  episodeIndex: number,
  resumeLineIndex: number,
  resumeEpisodeIndex: number
): number {
  if (!isResumable(history)) return 0
  if (lineIndex !== resumeLineIndex || episodeIndex !== resumeEpisodeIndex) return 0
  return Math.max(0, Math.round(history?.positionSeconds || 0))
}

export interface ResumeTargetInput {
  history?: ResumeHistoryLike | null
  /** 本次会话是否已经开播这部片（播放器 store 持有实时状态） */
  sessionActive: boolean
  /** 播放器 store 当前集 */
  sessionEpisodeIndex: number
  /** 播放器 store 当前进度（秒） */
  sessionPositionSeconds: number
  /** 当前线路的集数，用于把索引夹紧到合法范围 */
  episodeCount: number
  /** 当前选中的线路是否就是历史线路 */
  activeLineIsHistory: boolean
}

export interface ResumeTarget {
  episodeIndex: number
  positionSeconds: number
}

/** 主「播放」按钮应该从哪里开始播 */
export function pickResumeTarget(input: ResumeTargetInput): ResumeTarget {
  const {
    history,
    sessionActive,
    sessionEpisodeIndex,
    sessionPositionSeconds,
    episodeCount,
    activeLineIsHistory
  } = input

  if (sessionActive) {
    return {
      episodeIndex: clampIndex(sessionEpisodeIndex, episodeCount),
      // 刚开播时不足 3 秒，没必要 seek
      positionSeconds: sessionPositionSeconds > 3 ? Math.round(sessionPositionSeconds) : 0
    }
  }

  if (isResumable(history) && activeLineIsHistory) {
    return {
      episodeIndex: clampIndex(history?.episodeIndex || 0, episodeCount),
      positionSeconds: Math.max(0, Math.round(history?.positionSeconds || 0))
    }
  }

  // 既没在播这部片、也没有可续播的历史：从第 1 集开始。
  // 注意不能用 sessionEpisodeIndex —— 那是"上一部片"留下的索引，会让新片从第 N 集开播。
  return { episodeIndex: 0, positionSeconds: 0 }
}
