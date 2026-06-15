import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import VideoPlayer from '@/components/VideoPlayer/VideoPlayer';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { settingsApi } from '@/utils/ipc';
import { getPlayableMediaUrl } from '@/utils/media';
import { clearPlaybackMetrics, getPlaybackMetricSummary } from '@/utils/playbackMetrics';
const RESULT_KEY = '__alphaPlaybackSmokeResult';
const DEFAULT_MEDIA_URL = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
const DEFAULT_TIMEOUT_MS = 20000;
export default function AlphaPlaybackSmoke({ config }) {
    const wroteResultRef = useRef(false);
    const [lastResult, setLastResult] = useState(null);
    const { playbackPhase, playbackMessage, playbackError, playbackStartedAt, playbackFirstFrameAt, playbackDiagnostic, setVod, setVolume, reset } = usePlayerStore();
    const mediaUrl = config.mediaUrl || DEFAULT_MEDIA_URL;
    const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
    useEffect(() => {
        let cancelled = false;
        clearPlaybackMetrics();
        reset();
        setVolume(0);
        const startPlayback = async () => {
            const playableUrl = await getPlayableMediaUrl(mediaUrl);
            if (cancelled)
                return;
            setVod({
                vod_id: 'alpha-smoke',
                vod_name: 'Alpha 2.1 Playback Smoke',
                vod_pic: '',
                vod_remarks: '自动首帧验证'
            }, [{ name: '首帧验证', url: playableUrl }], 0, playableUrl, undefined, 'alpha-smoke');
        };
        void startPlayback();
        return () => {
            cancelled = true;
        };
    }, [mediaUrl, reset, setVod, setVolume]);
    useEffect(() => {
        if (wroteResultRef.current)
            return;
        const timer = window.setTimeout(() => {
            if (!wroteResultRef.current) {
                void writeResult(false, `首帧超时: ${timeoutMs}ms`);
            }
        }, timeoutMs);
        return () => window.clearTimeout(timer);
    }, [timeoutMs]);
    useEffect(() => {
        if (wroteResultRef.current)
            return;
        if (playbackFirstFrameAt > 0) {
            const elapsedMs = playbackStartedAt ? Math.max(0, playbackFirstFrameAt - playbackStartedAt) : undefined;
            void writeResult(true, '首帧播放成功', elapsedMs);
        }
        else if (playbackPhase === 'failed') {
            void writeResult(false, playbackError || playbackMessage || '播放失败');
        }
    }, [playbackError, playbackFirstFrameAt, playbackMessage, playbackPhase, playbackStartedAt]);
    async function writeResult(ok, message, elapsedMs) {
        wroteResultRef.current = true;
        const result = {
            ok,
            at: new Date().toISOString(),
            elapsedMs,
            phase: usePlayerStore.getState().playbackPhase,
            message,
            error: usePlayerStore.getState().playbackError || undefined,
            diagnostic: usePlayerStore.getState().playbackDiagnostic || undefined,
            metrics: getPlaybackMetricSummary(),
            debug: window.__alphaPlaybackDebug,
            mediaUrl,
            userAgent: navigator.userAgent
        };
        setLastResult(result);
        await settingsApi.set(RESULT_KEY, result);
    }
    return (_jsxs("div", { className: "h-screen w-screen bg-black text-white", children: [_jsx(VideoPlayer, {}), _jsxs("div", { className: "fixed left-4 top-4 z-50 max-w-lg rounded-md border border-white/20 bg-black/80 p-3 text-xs", children: [_jsx("div", { className: "font-medium", children: "Alpha 2.1 Playback Smoke" }), _jsxs("div", { className: "mt-1 text-white/70", children: ["phase=", playbackPhase] }), _jsxs("div", { className: "mt-1 text-white/70", children: ["message=", playbackMessage || '-'] }), _jsxs("div", { className: "mt-1 text-white/70", children: ["firstFrame=", playbackFirstFrameAt ? 'yes' : 'no'] }), lastResult && (_jsxs("div", { className: lastResult.ok ? 'mt-2 text-green-300' : 'mt-2 text-red-300', children: [lastResult.ok ? 'PASS' : 'FAIL', " ", lastResult.elapsedMs ? `${lastResult.elapsedMs}ms` : ''] }))] })] }));
}
