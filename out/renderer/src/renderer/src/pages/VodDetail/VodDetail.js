import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Heart, Play, ArrowLeft, Loader2, RefreshCw, Globe, AlertCircle, RotateCw } from 'lucide-react';
import { useConfigStore } from '@/stores/useConfigStore';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { historyApi, keepApi, siteApi } from '@/utils/ipc';
import { getPlayableMediaUrl } from '@/utils/media';
import VideoPlayer from '@/components/VideoPlayer/VideoPlayer';
/** 判断 URL 是否为视频流格式 */
function isVideoFormat(url) {
    if (!url)
        return false;
    return /\.m3u8(\?|$)|\.mp4(\?|$)|\.mpd(\?|$)|\.flv(\?|$)|\.ts(\?|$)|rtmp:\/\//i.test(url) ||
        /\/m3u8\?|\/playlist\.m3u8|\/index\.m3u8/i.test(url) ||
        /^https?:\/\/[^/]+\/.+\.(m3u8|mp4|flv|ts|mpd)(\?|$)/i.test(url);
}
export default function VodDetail() {
    const { siteKey, vodId } = useParams();
    const { currentConfig } = useConfigStore();
    const { currentVod, episodes, currentEpisodeIndex, currentSourceIndex, setVod, setCurrentEpisodeIndex, setCurrentSourceIndex, alternativeSources, sourceSwitchState, sourceSwitchMessage, autoSwitchSource, setAlternativeSources, markCurrentSourceBroken, setSourceSwitchState, popNextAlternativeSource, pickAlternativeSource, resetSourceSwitch, setPlaybackPhase, setPlaybackError } = usePlayerStore();
    const [detail, setDetail] = useState(null);
    const [lineSources, setLineSources] = useState([]);
    const [activeLineIndex, setActiveLineIndex] = useState(0);
    const [isKept, setIsKept] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [showPlayer, setShowPlayer] = useState(false);
    const [isResolving, setIsResolving] = useState(false);
    const [allSourcesExhausted, setAllSourcesExhausted] = useState(false);
    const [loadError, setLoadError] = useState(null);
    // 当前正在播放的源信息
    const [currentPlaySource, setCurrentPlaySource] = useState(null);
    const switchingRef = useRef(false);
    const failureHandledRef = useRef(false);
    const mountedRef = useRef(true);
    const activeLine = lineSources[activeLineIndex];
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);
    // 加载详情
    useEffect(() => {
        if (!siteKey || !vodId)
            return;
        setIsLoading(true);
        setLoadError(null);
        setAllSourcesExhausted(false);
        failureHandledRef.current = false;
        resetSourceSwitch();
        loadVodDetail(siteKey, vodId);
    }, [siteKey, vodId]);
    const loadVodDetail = async (sKey, vId) => {
        setIsLoading(true);
        setLoadError(null);
        try {
            const res = await siteApi.detailContent(sKey, [vId]);
            const result = res.data || res;
            const vod = result.list?.[0];
            if (!vod) {
                setLoadError('未找到该影片');
                setIsLoading(false);
                return;
            }
            setDetail(vod);
            // 解析播放源和集数
            const playFroms = (vod.vod_play_from || '').split('$$$').filter(Boolean);
            const urlGroups = (vod.vod_play_url || '').split('$$$');
            const parsedLines = [];
            if (playFroms.length > 0) {
                playFroms.forEach((from, idx) => {
                    const eps = (urlGroups[idx] || '')
                        .split('#')
                        .filter(Boolean)
                        .map((ep) => {
                        const dollarIdx = ep.indexOf('$');
                        const name = dollarIdx >= 0 ? ep.substring(0, dollarIdx) : '';
                        const url = dollarIdx >= 0 ? ep.substring(dollarIdx + 1) : ep;
                        return { name, url };
                    });
                    parsedLines.push({
                        key: `current::${sKey}::${vId}::${from}`,
                        name: from,
                        siteKey: sKey,
                        vodId: vId,
                        episodes: eps,
                        isCurrent: true
                    });
                });
            }
            else {
                const eps = (vod.vod_play_url || '')
                    .split('#')
                    .filter(Boolean)
                    .map((ep) => {
                    const dollarIdx = ep.indexOf('$');
                    const name = dollarIdx >= 0 ? ep.substring(0, dollarIdx) : '';
                    const url = dollarIdx >= 0 ? ep.substring(dollarIdx + 1) : ep;
                    return { name, url };
                });
                if (eps.length > 0) {
                    parsedLines.push({
                        key: `current::${sKey}::${vId}`,
                        name: '默认',
                        siteKey: sKey,
                        vodId: vId,
                        episodes: eps,
                        isCurrent: true
                    });
                }
            }
            setLineSources(parsedLines);
            // 优先选择含直链标识的线路（m3u8/mp4/mpd 等）
            const bestLineIdx = parsedLines.findIndex((l) => /m3u8|mp4|mpd|flv|ts/i.test(l.name) && l.episodes.length > 0);
            setActiveLineIndex(bestLineIdx >= 0 ? bestLineIdx : 0);
            setIsLoading(false);
        }
        catch (err) {
            setLoadError(err?.message || '加载失败');
            setIsLoading(false);
        }
    };
    // 检查收藏
    useEffect(() => {
        if (!vodId || !siteKey)
            return;
        keepApi.list().then((list) => {
            setIsKept(list.some((item) => item.siteKey === siteKey && item.vodId === vodId));
        });
    }, [siteKey, vodId]);
    // ==================== 换源机制 ====================
    // 搜索所有站点的同名 VOD，构建备选源队列
    const fetchAlternativeSources = useCallback(async (keyword) => {
        if (!keyword || !siteKey || !vodId)
            return;
        setSourceSwitchState('searching', `正在搜索「${keyword}」的其他站点...`);
        try {
            const res = await siteApi.findAcrossSites(keyword, {
                excludeSiteKey: siteKey,
                excludeVodId: vodId,
                limit: 20,
                timeoutMs: 8000
            });
            if (!mountedRef.current)
                return;
            if (res.success && res.data) {
                const sources = res.data;
                setAlternativeSources(sources);
                if (sources.length === 0) {
                    setSourceSwitchState('idle', '没有找到其他站点的同名资源');
                }
                else {
                    setSourceSwitchState('idle', `已找到 ${sources.length} 个备选源`);
                }
                setTimeout(() => { if (mountedRef.current)
                    setSourceSwitchState('idle', ''); }, 3000);
            }
            else {
                setSourceSwitchState('idle', `搜索失败: ${res.error || '未知'}`);
                setTimeout(() => { if (mountedRef.current)
                    setSourceSwitchState('idle', ''); }, 3000);
            }
        }
        catch (err) {
            setSourceSwitchState('idle', '跨站搜索异常');
            setTimeout(() => { if (mountedRef.current)
                setSourceSwitchState('idle', ''); }, 3000);
        }
    }, [siteKey, vodId, setAlternativeSources, setSourceSwitchState]);
    // 切换到一个备选源（在当前页面内加载，不导航）
    const switchToAlternativeSource = useCallback(async (source) => {
        if (switchingRef.current)
            return;
        switchingRef.current = true;
        try {
            setSourceSwitchState('switching', `正在加载「${source.siteName}」...`);
            markCurrentSourceBroken(source.siteKey, source.vodId);
            // 在当前页面内加载新源的详情
            try {
                const res = await siteApi.detailContent(source.siteKey, [source.vodId]);
                const result = res.data || res;
                const vod = result.list?.[0];
                if (!vod) {
                    setSourceSwitchState('idle', '加载失败，尝试下一个...');
                    setTimeout(() => { if (mountedRef.current)
                        setSourceSwitchState('idle', ''); }, 2000);
                    // 尝试队列中的下一个
                    const next = popNextAlternativeSource();
                    if (next) {
                        await switchToAlternativeSource(next);
                    }
                    else {
                        setAllSourcesExhausted(true);
                    }
                    return;
                }
                // 解析集数
                const playFroms = (vod.vod_play_from || '').split('$$$').filter(Boolean);
                const urlGroups = (vod.vod_play_url || '').split('$$$');
                const newLines = [];
                if (playFroms.length > 0) {
                    playFroms.forEach((from, idx) => {
                        const eps = (urlGroups[idx] || '')
                            .split('#')
                            .filter(Boolean)
                            .map((ep) => {
                            const dollarIdx = ep.indexOf('$');
                            const name = dollarIdx >= 0 ? ep.substring(0, dollarIdx) : '';
                            const url = dollarIdx >= 0 ? ep.substring(dollarIdx + 1) : ep;
                            return { name, url };
                        });
                        newLines.push({
                            key: `alt::${source.siteKey}::${source.vodId}::${from}`,
                            name: `${source.siteName} · ${from}`,
                            siteKey: source.siteKey,
                            vodId: source.vodId,
                            episodes: eps,
                            isCurrent: false
                        });
                    });
                }
                else {
                    const eps = (vod.vod_play_url || '')
                        .split('#')
                        .filter(Boolean)
                        .map((ep) => {
                        const dollarIdx = ep.indexOf('$');
                        const name = dollarIdx >= 0 ? ep.substring(0, dollarIdx) : '';
                        const url = dollarIdx >= 0 ? ep.substring(dollarIdx + 1) : ep;
                        return { name, url };
                    });
                    if (eps.length > 0) {
                        newLines.push({
                            key: `alt::${source.siteKey}::${source.vodId}`,
                            name: source.siteName,
                            siteKey: source.siteKey,
                            vodId: source.vodId,
                            episodes: eps,
                            isCurrent: false
                        });
                    }
                }
                if (newLines.length === 0) {
                    setSourceSwitchState('idle', '该源无播放数据');
                    setTimeout(() => { if (mountedRef.current)
                        setSourceSwitchState('idle', ''); }, 2000);
                    return;
                }
                // 将新线路添加到线路列表
                const prevCount = lineSources.length;
                setLineSources(prev => [...prev, ...newLines]);
                const bestNewIdx = newLines.findIndex((l) => /m3u8|mp4|mpd|flv|ts/i.test(l.name) && l.episodes.length > 0);
                setActiveLineIndex(prevCount + (bestNewIdx >= 0 ? bestNewIdx : 0));
                setDetail(vod);
                setSourceSwitchState('idle', `已切换到「${source.siteName}」`);
                setTimeout(() => { if (mountedRef.current)
                    setSourceSwitchState('idle', ''); }, 2000);
            }
            catch (err) {
                setSourceSwitchState('idle', '加载失败');
                setTimeout(() => { if (mountedRef.current)
                    setSourceSwitchState('idle', ''); }, 2000);
            }
        }
        finally {
            setTimeout(() => { switchingRef.current = false; }, 500);
        }
    }, [lineSources.length, markCurrentSourceBroken, popNextAlternativeSource, setSourceSwitchState]);
    // 切换到下一备选源
    const switchToNextSource = useCallback(async () => {
        if (switchingRef.current)
            return;
        const next = popNextAlternativeSource();
        if (!next) {
            setAllSourcesExhausted(true);
            setSourceSwitchState('idle', '所有备选源都已尝试');
            setTimeout(() => { if (mountedRef.current)
                setSourceSwitchState('idle', ''); }, 3000);
            return;
        }
        await switchToAlternativeSource(next);
    }, [popNextAlternativeSource, setSourceSwitchState, switchToAlternativeSource]);
    // 播放失败事件
    useEffect(() => {
        const handlePlayFailed = (event) => {
            const { siteKey: failedSiteKey, vodId: failedVodId, autoSwitch } = event.detail || {};
            if (failureHandledRef.current)
                return;
            failureHandledRef.current = true;
            if (failedSiteKey && failedVodId) {
                markCurrentSourceBroken(failedSiteKey, failedVodId);
            }
            setTimeout(() => { failureHandledRef.current = false; }, 1000);
            if (autoSwitch !== false && autoSwitchSource) {
                switchToNextSource();
            }
        };
        window.addEventListener('vod:playFailed', handlePlayFailed);
        return () => {
            window.removeEventListener('vod:playFailed', handlePlayFailed);
        };
    }, [autoSwitchSource, markCurrentSourceBroken, switchToNextSource]);
    useEffect(() => {
        const handleRetry = () => {
            if (activeLine)
                handlePlay(activeLineIndex, currentEpisodeIndex || 0);
        };
        const handleNextSource = () => {
            void switchToNextSource();
        };
        window.addEventListener('player:retry', handleRetry);
        window.addEventListener('player:nextSource', handleNextSource);
        return () => {
            window.removeEventListener('player:retry', handleRetry);
            window.removeEventListener('player:nextSource', handleNextSource);
        };
    }, [activeLine, activeLineIndex, currentEpisodeIndex, switchToNextSource]);
    // 播放集数
    const handlePlay = async (lineIdx, epIdx) => {
        const line = lineSources[lineIdx];
        if (!line || !line.episodes[epIdx])
            return;
        setIsResolving(true);
        setPlaybackPhase('resolving', '正在获取播放信息...');
        setCurrentSourceIndex(lineIdx);
        setAllSourcesExhausted(false);
        setLoadError(null);
        failureHandledRef.current = false;
        const episode = line.episodes[epIdx];
        const targetDetail = detail;
        const targetSiteKey = line.siteKey;
        const targetVodId = line.vodId;
        try {
            const playerRes = await siteApi.playerContent(line.siteKey, line.name, episode.url, []);
            const playerResult = playerRes.data || playerRes;
            setPlaybackPhase('resolving', '正在判断播放地址...');
            let initialUrl = '';
            let initialHeader = playerResult.header;
            // 尝试从 playerContent 结果中提取可播放的 URL
            if (playerResult.playUrl && isVideoFormat(playerResult.playUrl)) {
                initialUrl = playerResult.playUrl;
            }
            else if (playerResult.url && isVideoFormat(playerResult.url)) {
                initialUrl = playerResult.url;
            }
            else if (playerResult.playUrl && playerResult.url) {
                initialUrl = playerResult.playUrl + playerResult.url;
            }
            else if (playerResult.url) {
                initialUrl = playerResult.url;
            }
            setIsResolving(false);
            if (initialUrl && isVideoFormat(initialUrl)) {
                // 直接可播放，立即开始
                setPlaybackPhase('connecting', '正在连接播放地址...');
                const playableUrl = await getPlayableMediaUrl(initialUrl, initialHeader);
                setCurrentPlaySource({ siteKey: targetSiteKey, vodId: targetVodId });
                setVod(targetDetail, line.episodes, lineIdx, playableUrl, initialHeader, targetSiteKey);
                setCurrentEpisodeIndex(epIdx, playableUrl);
                setShowPlayer(true);
            }
            else {
                // 需要解析，先展示播放器加载态
                setCurrentPlaySource({ siteKey: targetSiteKey, vodId: targetVodId });
                setShowPlayer(true);
                setPlaybackPhase('resolving', '正在解析播放地址...');
                setVod(targetDetail, line.episodes, lineIdx, '__resolving__', initialHeader, targetSiteKey);
                // 异步解析
                try {
                    const parseRes = await siteApi.superParse({
                        url: episode.url,
                        flag: line.name,
                        siteKey: targetSiteKey,
                        playerResult
                    });
                    if (parseRes.success && parseRes.data.url) {
                        setPlaybackPhase('connecting', '解析成功，正在连接...');
                        const url = await getPlayableMediaUrl(parseRes.data.url, parseRes.data.header || initialHeader);
                        const header = parseRes.data.header || initialHeader;
                        const store = usePlayerStore.getState();
                        setCurrentEpisodeIndex(epIdx, url);
                        store.play(url);
                    }
                    else {
                        // 所有解析都失败
                        setPlaybackError('解析完全失败');
                        window.dispatchEvent(new CustomEvent('vod:playFailed', {
                            detail: { siteKey: targetSiteKey, vodId: targetVodId, reason: '解析完全失败', autoSwitch: true }
                        }));
                    }
                }
                catch {
                    setPlaybackError('解析异常');
                    window.dispatchEvent(new CustomEvent('vod:playFailed', {
                        detail: { siteKey: targetSiteKey, vodId: targetVodId, reason: '解析异常', autoSwitch: true }
                    }));
                }
            }
            // 搜索备选源
            if (targetDetail?.vod_name && line.isCurrent) {
                fetchAlternativeSources(targetDetail.vod_name);
            }
            historyApi.add({
                vodId: targetVodId,
                siteKey: targetSiteKey,
                vodName: targetDetail?.vod_name || '',
                vodPic: targetDetail?.vod_pic,
                source: episode.name ? `${line.name} · ${episode.name}` : line.name,
                progress: 0
            }).catch(() => { });
        }
        catch (err) {
            setIsResolving(false);
            setLoadError(err?.message || '获取播放信息失败');
            setPlaybackError(err?.message || '获取播放信息失败');
            window.dispatchEvent(new CustomEvent('vod:playFailed', {
                detail: { siteKey: targetSiteKey, vodId: targetVodId, reason: 'playerContent 失败', autoSwitch: true }
            }));
        }
    };
    // 收藏
    const handleToggleKeep = async () => {
        if (!detail || !vodId || !siteKey)
            return;
        if (isKept) {
            await keepApi.delete(siteKey, vodId);
            setIsKept(false);
        }
        else {
            await keepApi.add({
                vodId,
                siteKey,
                vodName: detail.vod_name,
                vodPic: detail.vod_pic
            });
            setIsKept(true);
        }
    };
    if (isLoading) {
        return (_jsx("div", { className: "h-full flex items-center justify-center", children: _jsx("div", { className: "w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" }) }));
    }
    if (loadError && !detail) {
        return (_jsxs("div", { className: "h-full flex flex-col items-center justify-center p-8 text-center", children: [_jsx(AlertCircle, { className: "w-12 h-12 text-red-400 mb-4" }), _jsx("h2", { className: "text-lg font-semibold text-text-primary mb-2", children: "\u65E0\u6CD5\u52A0\u8F7D\u8BE6\u60C5" }), _jsx("p", { className: "text-sm text-text-muted mb-6", children: loadError }), _jsxs("div", { className: "flex gap-3", children: [_jsx("button", { onClick: () => window.history.back(), className: "px-4 py-2 border border-[#2a2a2a] text-text-secondary rounded-lg hover:bg-bg-hover", children: "\u8FD4\u56DE" }), _jsx("button", { onClick: () => window.location.reload(), className: "px-4 py-2 bg-accent text-bg-primary rounded-lg font-medium", children: "\u91CD\u65B0\u52A0\u8F7D" })] })] }));
    }
    return (_jsxs("div", { className: "h-full overflow-y-auto scrollbar-dark", children: [showPlayer && (_jsxs("div", { className: "relative aspect-video bg-black", children: [_jsx(VideoPlayer, {}), _jsx("button", { onClick: () => setShowPlayer(false), className: "absolute top-3 left-3 z-30 p-2 bg-black/50 rounded-full text-white/80 hover:text-white", children: _jsx(ArrowLeft, { className: "w-5 h-5" }) }), allSourcesExhausted && (_jsxs("div", { className: "absolute inset-0 z-20 bg-black/85 flex flex-col items-center justify-center text-center p-6", children: [_jsx(AlertCircle, { className: "w-12 h-12 text-red-400 mb-3" }), _jsx("h3", { className: "text-lg font-semibold text-white mb-2", children: "\u6240\u6709\u6E90\u5747\u4E0D\u53EF\u7528" }), _jsx("p", { className: "text-sm text-white/70 mb-4", children: "\u5DF2\u5C1D\u8BD5\u591A\u4E2A\u6E90\uFF0C\u4ECD\u7136\u65E0\u6CD5\u64AD\u653E" }), _jsxs("div", { className: "flex gap-2", children: [_jsxs("button", { onClick: () => {
                                            if (activeLine)
                                                handlePlay(activeLineIndex, currentEpisodeIndex || 0);
                                        }, className: "flex items-center gap-2 px-4 py-2 bg-accent text-bg-primary rounded-lg font-medium hover:bg-accent-hover", children: [_jsx(RotateCw, { className: "w-4 h-4" }), "\u91CD\u8BD5\u5F53\u524D"] }), _jsxs("button", { onClick: switchToNextSource, className: "flex items-center gap-2 px-4 py-2 border border-white/30 text-white rounded-lg hover:bg-white/10", children: [_jsx(RefreshCw, { className: "w-4 h-4" }), "\u5207\u6362\u5176\u4ED6\u6E90"] })] })] }))] })), (sourceSwitchState !== 'idle' || sourceSwitchMessage) && (_jsxs("div", { className: "flex items-center gap-2 px-4 py-2 bg-bg-secondary border-b border-[#2a2a2a] text-xs", children: [sourceSwitchState === 'searching' || sourceSwitchState === 'switching' ? (_jsx(Loader2, { className: "w-3.5 h-3.5 animate-spin text-accent shrink-0" })) : (_jsx(Globe, { className: "w-3.5 h-3.5 text-text-muted shrink-0" })), _jsx("span", { className: "text-text-secondary truncate", children: sourceSwitchMessage || '加载中...' })] })), _jsxs("div", { className: "p-6", children: [_jsxs("div", { className: "flex gap-6", children: [_jsx("div", { className: "shrink-0 w-48", children: _jsx("img", { src: detail?.vod_pic, alt: detail?.vod_name, className: "w-full aspect-[2/3] object-cover rounded-lg bg-bg-tertiary", onError: (e) => { e.target.style.display = 'none'; } }) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("h1", { className: "text-2xl font-semibold text-text-primary mb-3", children: detail?.vod_name }), _jsxs("div", { className: "space-y-1.5 text-sm text-text-secondary", children: [detail?.vod_year && _jsxs("p", { children: ["\u5E74\u4EFD\uFF1A", detail.vod_year] }), detail?.vod_area && _jsxs("p", { children: ["\u5730\u533A\uFF1A", detail.vod_area] }), detail?.type_name && _jsxs("p", { children: ["\u7C7B\u578B\uFF1A", detail.type_name] }), detail?.vod_director && _jsxs("p", { children: ["\u5BFC\u6F14\uFF1A", detail.vod_director] }), detail?.vod_actor && _jsxs("p", { children: ["\u6F14\u5458\uFF1A", detail.vod_actor] })] }), _jsxs("div", { className: "flex gap-3 mt-4 flex-wrap", children: [_jsxs("button", { onClick: () => {
                                                    if (activeLine)
                                                        handlePlay(activeLineIndex, currentEpisodeIndex || 0);
                                                }, disabled: isResolving || lineSources.length === 0, className: "flex items-center gap-2 px-5 py-2 bg-accent hover:bg-accent-hover text-bg-primary rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed", children: [isResolving ? _jsx(Loader2, { className: "w-4 h-4 animate-spin" }) : _jsx(Play, { className: "w-4 h-4" }), isResolving ? '解析中...' : '播放'] }), _jsxs("button", { onClick: handleToggleKeep, className: `flex items-center gap-2 px-5 py-2 rounded-lg border transition-colors ${isKept
                                                    ? 'border-accent text-accent bg-accent-muted'
                                                    : 'border-[#2a2a2a] text-text-secondary hover:text-accent hover:border-accent'}`, children: [_jsx(Heart, { className: `w-4 h-4 ${isKept ? 'fill-accent' : ''}` }), isKept ? '已收藏' : '收藏'] })] }), detail?.vod_content && (_jsx("p", { className: "mt-4 text-sm text-text-muted leading-relaxed line-clamp-3", children: detail.vod_content.replace(/<[^>]+>/g, '') }))] })] }), lineSources.length > 0 && (_jsxs("div", { className: "mt-6", children: [_jsxs("div", { className: "flex items-center gap-2 mb-3", children: [_jsx(Globe, { className: "w-4 h-4 text-text-muted" }), _jsx("span", { className: "text-sm font-medium text-text-secondary", children: "\u591A\u7EBF\u8DEF\u7247\u6E90" }), alternativeSources.length > 0 && (_jsxs("span", { className: "text-xs text-text-muted ml-auto", children: [alternativeSources.length, " \u4E2A\u5907\u9009\u6E90"] }))] }), _jsx("div", { className: "flex gap-2 overflow-x-auto scrollbar-dark pb-1", children: lineSources.map((line, idx) => (_jsxs("button", { onClick: () => setActiveLineIndex(idx), className: `shrink-0 px-3 py-1.5 text-xs rounded-md transition-colors ${activeLineIndex === idx
                                        ? 'bg-accent/20 text-accent font-medium'
                                        : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'}`, children: [line.name, _jsxs("span", { className: "ml-1 opacity-60", children: ["(", line.episodes.length, ")"] })] }, line.key))) }), activeLine && (_jsx("div", { className: "mt-3 grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-2", children: activeLine.episodes.map((ep, idx) => (_jsx("button", { onClick: () => handlePlay(activeLineIndex, idx), disabled: isResolving, className: `px-2 py-1.5 text-xs rounded-md truncate transition-colors disabled:opacity-50 ${showPlayer && currentEpisodeIndex === idx
                                        ? 'bg-accent text-bg-primary font-medium'
                                        : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`, children: ep.name }, `${ep.name}-${idx}`))) }))] })), lineSources.length === 0 && (_jsx("div", { className: "mt-6 text-center py-8 text-text-muted", children: "\u6682\u65E0\u64AD\u653E\u6E90" }))] })] }));
}
