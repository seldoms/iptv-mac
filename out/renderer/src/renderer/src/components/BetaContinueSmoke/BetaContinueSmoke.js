import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { historyApi, settingsApi } from '@/utils/ipc';
const RESULT_KEY = '__betaContinueSmokeResult';
const SMOKE_SITE_KEY = 'beta-smoke-site';
const SMOKE_VOD_ID = 'beta-smoke-vod';
const DEFAULT_POSITION_SECONDS = 372;
const DEFAULT_TOLERANCE_SECONDS = 20;
function isSmokeHistory(item) {
    return item.siteKey === SMOKE_SITE_KEY && item.vodId === SMOKE_VOD_ID;
}
export default function BetaContinueSmoke({ config }) {
    const wroteRef = useRef(false);
    const [result, setResult] = useState(null);
    const expectedPositionSeconds = config.positionSeconds || DEFAULT_POSITION_SECONDS;
    const toleranceSeconds = config.toleranceSeconds || DEFAULT_TOLERANCE_SECONDS;
    useEffect(() => {
        if (wroteRef.current)
            return;
        wroteRef.current = true;
        const run = async () => {
            if (config.phase === 'seed') {
                await historyApi.add({
                    siteKey: SMOKE_SITE_KEY,
                    vodId: SMOKE_VOD_ID,
                    vodName: 'Beta Continue Watching Smoke',
                    vodPic: '',
                    vodRemarks: '自动恢复验证',
                    source: '高清线路 · 第 3 集',
                    progress: 31,
                    episodeId: '2',
                    episodeName: '第 3 集',
                    episodeIndex: 2,
                    sourceIndex: 1,
                    sourceName: '高清线路',
                    urlIdentifier: 'smoke.example/video/index.m3u8',
                    duration: 1200,
                    positionSeconds: expectedPositionSeconds,
                    completed: false
                });
                await writeResult({
                    ok: true,
                    phase: 'seed',
                    message: 'seeded continue-watching history',
                    expectedPositionSeconds,
                    actualPositionSeconds: expectedPositionSeconds,
                    toleranceSeconds
                });
                return;
            }
            const history = (await historyApi.list()).find(isSmokeHistory);
            if (!history) {
                await writeResult({
                    ok: false,
                    phase: 'validate',
                    message: 'history item missing after force restart',
                    expectedPositionSeconds,
                    toleranceSeconds
                });
                return;
            }
            const actualPositionSeconds = history.positionSeconds || 0;
            const positionDelta = Math.abs(actualPositionSeconds - expectedPositionSeconds);
            const ok = positionDelta <= toleranceSeconds &&
                history.episodeIndex === 2 &&
                history.sourceIndex === 1 &&
                history.sourceName === '高清线路' &&
                history.completed === false;
            await writeResult({
                ok,
                phase: 'validate',
                message: ok
                    ? 'continue-watching history survived force restart'
                    : `resume mismatch: delta=${positionDelta}s`,
                expectedPositionSeconds,
                actualPositionSeconds,
                toleranceSeconds,
                history
            });
        };
        void run().catch((error) => {
            void writeResult({
                ok: false,
                phase: config.phase,
                message: error instanceof Error ? error.message : String(error),
                expectedPositionSeconds,
                toleranceSeconds
            });
        });
    }, [config.phase, expectedPositionSeconds, toleranceSeconds]);
    async function writeResult(next) {
        const result = {
            ...next,
            at: new Date().toISOString()
        };
        setResult(result);
        await settingsApi.set(RESULT_KEY, result);
    }
    return (_jsx("div", { className: "flex h-screen w-screen items-center justify-center bg-black text-white", children: _jsxs("div", { className: "max-w-lg rounded-md border border-white/20 bg-white/10 p-4 text-sm", children: [_jsx("div", { className: "font-medium", children: "Beta 1 Continue Watching Smoke" }), _jsxs("div", { className: "mt-2 text-white/70", children: ["phase=", config.phase] }), _jsxs("div", { className: "mt-1 text-white/70", children: ["expected=", expectedPositionSeconds, "s"] }), result && (_jsxs("div", { className: result.ok ? 'mt-3 text-green-300' : 'mt-3 text-red-300', children: [result.ok ? 'PASS' : 'FAIL', " ", result.message] }))] }) }));
}
