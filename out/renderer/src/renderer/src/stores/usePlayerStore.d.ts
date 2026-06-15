export interface VodDetail {
    vod_id: string;
    vod_name: string;
    vod_pic: string;
    vod_remarks?: string;
    type_name?: string;
    vod_year?: string;
    vod_area?: string;
    vod_director?: string;
    vod_actor?: string;
    vod_content?: string;
    vod_play_from?: string;
    vod_play_url?: string;
}
export interface Episode {
    name: string;
    url: string;
}
/** 跨站点的备选源（换源用） */
export interface AlternativeSource {
    siteKey: string;
    siteName: string;
    vodId: string;
    vodName: string;
    vodPic?: string;
    vodRemarks?: string;
}
export type PlaybackPhase = 'idle' | 'resolving' | 'connecting' | 'buffering' | 'playing' | 'recovering' | 'failed';
export interface PlaybackDiagnostic {
    stage: 'parse' | 'connect' | 'manifest' | 'buffer' | 'media' | 'network' | 'unknown';
    errorKind: 'parse_failed' | 'timeout' | 'http' | 'hls' | 'media' | 'unsupported' | 'unknown';
    protocol?: 'hls' | 'dash' | 'native' | 'unknown';
    httpStatus?: number;
    elapsedMs?: number;
    sourceId?: string;
    attempt?: number;
    sourceCount?: number;
    nextAction?: string;
}
interface PlayerState {
    isPlaying: boolean;
    currentUrl: string;
    playKey: number;
    currentTime: number;
    duration: number;
    speed: number;
    volume: number;
    isDanmakuOn: boolean;
    isFullscreen: boolean;
    currentVod: VodDetail | null;
    episodes: Episode[];
    currentEpisodeIndex: number;
    currentSourceIndex: number;
    currentSourceName: string;
    playHeader: Record<string, string> | null;
    currentSiteKey: string;
    playbackPhase: PlaybackPhase;
    playbackMessage: string;
    playbackError: string;
    playbackStartedAt: number;
    playbackFirstFrameAt: number;
    playbackLastErrorAt: number;
    playbackDiagnostic: PlaybackDiagnostic | null;
    /** 备选源队列（来自其他站点的同名 VOD） */
    alternativeSources: AlternativeSource[];
    /** 已失败的源 key 集合（siteKey + vodId） */
    brokenSources: Set<string>;
    /** 换源状态：idle / searching / switching */
    sourceSwitchState: 'idle' | 'searching' | 'switching';
    /** 换源提示信息（给用户看） */
    sourceSwitchMessage: string;
    /** 是否启用自动换源 */
    autoSwitchSource: boolean;
}
interface PlayerActions {
    play: (url?: string) => void;
    pause: () => void;
    stop: () => void;
    setSpeed: (speed: number) => void;
    setVolume: (volume: number) => void;
    setCurrentTime: (time: number) => void;
    setDuration: (duration: number) => void;
    setIsPlaying: (playing: boolean) => void;
    toggleDanmaku: () => void;
    toggleFullscreen: () => void;
    nextEpisode: () => void;
    prevEpisode: () => void;
    setVod: (vod: VodDetail, episodes: Episode[], sourceIndex?: number, resolvedUrl?: string, header?: Record<string, string>, siteKey?: string, sourceName?: string, startPositionSeconds?: number) => void;
    setCurrentEpisodeIndex: (index: number, resolvedUrl?: string, startPositionSeconds?: number) => void;
    setCurrentSourceIndex: (index: number) => void;
    setPlaybackPhase: (phase: PlaybackPhase, message?: string) => void;
    setPlaybackError: (message: string, diagnostic?: Partial<PlaybackDiagnostic>) => void;
    markPlaybackFirstFrame: () => void;
    /** 设置备选源队列 */
    setAlternativeSources: (sources: AlternativeSource[]) => void;
    /** 标记当前源为失败，加入 brokenSources 集合 */
    markCurrentSourceBroken: (siteKey: string, vodId: string) => void;
    /** 设置换源状态 */
    setSourceSwitchState: (state: 'idle' | 'searching' | 'switching', message?: string) => void;
    /** 设置是否启用自动换源 */
    setAutoSwitchSource: (enabled: boolean) => void;
    /** 从备选队列取下一个源（弹出第一个） */
    popNextAlternativeSource: () => AlternativeSource | null;
    /** 手动切换到指定备选源 */
    pickAlternativeSource: (index: number) => AlternativeSource | null;
    /** 重置换源状态 */
    resetSourceSwitch: () => void;
    reset: () => void;
}
export declare const usePlayerStore: import("zustand").UseBoundStore<import("zustand").StoreApi<PlayerState & PlayerActions>>;
export {};
