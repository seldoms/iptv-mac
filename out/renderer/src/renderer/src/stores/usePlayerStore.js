import { create } from 'zustand';
const initialState = {
    isPlaying: false,
    currentUrl: '',
    playKey: 0,
    currentTime: 0,
    duration: 0,
    speed: 1,
    volume: 1,
    isDanmakuOn: true,
    isFullscreen: false,
    currentVod: null,
    episodes: [],
    currentEpisodeIndex: 0,
    currentSourceIndex: 0,
    currentSourceName: '',
    playHeader: null,
    currentSiteKey: '',
    playbackPhase: 'idle',
    playbackMessage: '',
    playbackError: '',
    playbackStartedAt: 0,
    playbackFirstFrameAt: 0,
    playbackLastErrorAt: 0,
    playbackDiagnostic: null,
    alternativeSources: [],
    brokenSources: new Set(),
    sourceSwitchState: 'idle',
    sourceSwitchMessage: '',
    autoSwitchSource: true
};
function makeSourceKey(siteKey, vodId) {
    return `${siteKey}::${vodId}`;
}
export const usePlayerStore = create()((set, get) => ({
    ...initialState,
    play: (url) => {
        if (url) {
            set((s) => ({
                currentUrl: url,
                currentTime: 0,
                duration: 0,
                isPlaying: true,
                playbackPhase: 'connecting',
                playbackMessage: '正在连接播放地址...',
                playbackError: '',
                playbackDiagnostic: null,
                playbackStartedAt: Date.now(),
                playbackFirstFrameAt: 0,
                playbackLastErrorAt: 0,
                playKey: s.playKey + 1
            }));
        }
        else {
            set((s) => ({
                isPlaying: true,
                playbackPhase: s.currentUrl ? 'connecting' : s.playbackPhase,
                playbackMessage: s.currentUrl ? '正在连接播放地址...' : s.playbackMessage,
                playbackError: '',
                playbackDiagnostic: null,
                playbackLastErrorAt: 0,
                playKey: s.playKey + 1
            }));
        }
    },
    pause: () => set({ isPlaying: false }),
    stop: () => set({
        isPlaying: false,
        currentUrl: '',
        currentTime: 0,
        duration: 0,
        playbackPhase: 'idle',
        playbackMessage: '',
        playbackError: '',
        playbackDiagnostic: null,
        playbackFirstFrameAt: 0,
        playbackLastErrorAt: 0
    }),
    setSpeed: (speed) => set({ speed }),
    setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
    setCurrentTime: (time) => set({ currentTime: time }),
    setDuration: (duration) => set({ duration }),
    setIsPlaying: (playing) => set({ isPlaying: playing }),
    toggleDanmaku: () => set((s) => ({ isDanmakuOn: !s.isDanmakuOn })),
    toggleFullscreen: () => set((s) => ({ isFullscreen: !s.isFullscreen })),
    nextEpisode: () => {
        const { episodes, currentEpisodeIndex } = get();
        if (currentEpisodeIndex < episodes.length - 1) {
            const nextIndex = currentEpisodeIndex + 0 + 1;
            set({
                currentEpisodeIndex: nextIndex,
                currentUrl: episodes[nextIndex].url,
                currentTime: 0,
                isPlaying: true
            });
        }
    },
    prevEpisode: () => {
        const { episodes, currentEpisodeIndex } = get();
        if (currentEpisodeIndex > 0) {
            const prevIndex = currentEpisodeIndex - 1;
            set({
                currentEpisodeIndex: prevIndex,
                currentUrl: episodes[prevIndex].url,
                currentTime: 0,
                isPlaying: true
            });
        }
    },
    setVod: (vod, episodes, sourceIndex = 0, resolvedUrl, header, siteKey, sourceName = '', startPositionSeconds = 0) => {
        set({
            currentVod: vod,
            episodes,
            currentSourceIndex: sourceIndex,
            currentEpisodeIndex: 0,
            currentSourceName: sourceName,
            currentUrl: resolvedUrl || (episodes.length > 0 ? episodes[0].url : ''),
            currentTime: Math.max(0, startPositionSeconds),
            duration: 0,
            isPlaying: episodes.length > 0,
            playHeader: header || null,
            currentSiteKey: siteKey || '',
            playbackPhase: resolvedUrl === '__resolving__' ? 'resolving' : episodes.length > 0 ? 'connecting' : 'idle',
            playbackMessage: resolvedUrl === '__resolving__' ? '解析播放地址中...' : episodes.length > 0 ? '正在连接播放地址...' : '',
            playbackError: '',
            playbackDiagnostic: null,
            playbackStartedAt: episodes.length > 0 ? Date.now() : 0,
            playbackFirstFrameAt: 0,
            playbackLastErrorAt: 0
        });
    },
    setCurrentEpisodeIndex: (index, resolvedUrl, startPositionSeconds = 0) => {
        const { episodes } = get();
        if (index >= 0 && index < episodes.length) {
            set({
                currentEpisodeIndex: index,
                currentUrl: resolvedUrl || episodes[index].url,
                currentTime: Math.max(0, startPositionSeconds),
                isPlaying: true,
                playbackPhase: resolvedUrl === '__resolving__' ? 'resolving' : 'connecting',
                playbackMessage: resolvedUrl === '__resolving__' ? '解析播放地址中...' : '正在连接播放地址...',
                playbackError: '',
                playbackDiagnostic: null,
                playbackStartedAt: Date.now(),
                playbackFirstFrameAt: 0,
                playbackLastErrorAt: 0
            });
        }
    },
    setCurrentSourceIndex: (index) => set({ currentSourceIndex: index }),
    setPlaybackPhase: (phase, message = '') => set({
        playbackPhase: phase,
        playbackMessage: message,
        playbackError: phase === 'failed' ? get().playbackError : '',
        playbackDiagnostic: phase === 'failed' ? get().playbackDiagnostic : null
    }),
    setPlaybackError: (message, diagnostic = {}) => set((state) => ({
        playbackPhase: 'failed',
        playbackMessage: diagnostic.stage === 'parse' ? '解析失败' : '播放失败',
        playbackError: message,
        playbackLastErrorAt: Date.now(),
        playbackDiagnostic: {
            stage: diagnostic.stage || 'unknown',
            errorKind: diagnostic.errorKind || 'unknown',
            protocol: diagnostic.protocol || 'unknown',
            httpStatus: diagnostic.httpStatus,
            elapsedMs: diagnostic.elapsedMs,
            sourceId: diagnostic.sourceId || (state.currentSiteKey && state.currentVod ? `${state.currentSiteKey}::${state.currentVod.vod_id}` : undefined),
            attempt: diagnostic.attempt ?? state.brokenSources.size + 1,
            sourceCount: diagnostic.sourceCount ?? state.alternativeSources.length + state.brokenSources.size + 1,
            nextAction: diagnostic.nextAction || (state.autoSwitchSource ? '自动尝试下一条可用线路' : '可手动重试或切换线路')
        }
    })),
    markPlaybackFirstFrame: () => set((state) => ({
        playbackPhase: 'playing',
        playbackMessage: '正在播放',
        playbackFirstFrameAt: state.playbackFirstFrameAt || Date.now(),
        playbackError: '',
        playbackDiagnostic: null
    })),
    // ==================== 换源 Actions ====================
    setAlternativeSources: (sources) => set({ alternativeSources: sources }),
    markCurrentSourceBroken: (siteKey, vodId) => {
        const { brokenSources, currentVod } = get();
        const newBroken = new Set(brokenSources);
        newBroken.add(makeSourceKey(siteKey, vodId));
        // 同时标记当前 detail 页面正在播放的源为 broken（用 siteKey + currentVod.vod_id）
        if (currentVod) {
            newBroken.add(makeSourceKey(siteKey, currentVod.vod_id));
        }
        console.log('[PlayerStore] 标记源失败:', siteKey, vodId, '已失败数:', newBroken.size);
        set({ brokenSources: newBroken });
    },
    setSourceSwitchState: (state, message = '') => set({
        sourceSwitchState: state,
        sourceSwitchMessage: message
    }),
    setAutoSwitchSource: (enabled) => set({ autoSwitchSource: enabled }),
    popNextAlternativeSource: () => {
        const { alternativeSources, brokenSources } = get();
        // 找到队列中第一个未被标记为失败的源
        while (alternativeSources.length > 0) {
            const next = alternativeSources[0];
            const key = makeSourceKey(next.siteKey, next.vodId);
            if (!brokenSources.has(key)) {
                // 弹出
                set({ alternativeSources: alternativeSources.slice(1) });
                return next;
            }
            // 跳过已失败的
            set({ alternativeSources: alternativeSources.slice(1) });
        }
        return null;
    },
    pickAlternativeSource: (index) => {
        const { alternativeSources, brokenSources } = get();
        if (index < 0 || index >= alternativeSources.length)
            return null;
        const target = alternativeSources[index];
        const key = makeSourceKey(target.siteKey, target.vodId);
        if (brokenSources.has(key))
            return null;
        // 从队列中移除该源
        const newQueue = [...alternativeSources.slice(0, index), ...alternativeSources.slice(index + 1)];
        set({ alternativeSources: newQueue });
        return target;
    },
    resetSourceSwitch: () => set({
        alternativeSources: [],
        brokenSources: new Set(),
        sourceSwitchState: 'idle',
        sourceSwitchMessage: ''
    }),
    reset: () => set({ ...initialState, brokenSources: new Set() })
}));
