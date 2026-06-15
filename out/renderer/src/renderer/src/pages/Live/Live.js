import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { useLiveStore } from '@/stores/useLiveStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { usePlayerStore } from '@/stores/usePlayerStore';
import ChannelItem from '@/components/ChannelItem/ChannelItem';
import VideoPlayer from '@/components/VideoPlayer/VideoPlayer';
import { Radio, Search } from 'lucide-react';
import { configApi, on } from '@/utils/ipc';
import { getPlayableMediaUrl } from '@/utils/media';
import LiveTree from '@/components/LiveTree/LiveTree';
import LiveRefreshBar from '@/components/LiveRefreshBar/LiveRefreshBar';
import EmptyState from '@/components/EmptyState/EmptyState';
import { useNavigate } from 'react-router-dom';
function getEquivalentChannelKey(name) {
    const cctv = name.match(/cctv[-_\s]*0?(\d{1,2})(?!\d)/i);
    return cctv ? `cctv${Number(cctv[1])}` : name.trim().toLowerCase();
}
function scoreLiveUrl(url) {
    const lower = url.toLowerCase();
    let score = 0;
    if (/videocodec=h264|\/h264\/|avc|kankanlive/i.test(lower))
        score -= 80;
    if (/videocodec=h265|h265|hevc/i.test(lower))
        score += 140;
    if (/\.m3u8(?:\?|$)/i.test(lower))
        score -= 20;
    if (/miguvideo\.com/i.test(lower))
        score += 10;
    return score;
}
export default function Live() {
    const navigate = useNavigate();
    const { groups, channels, currentGroup, currentChannel, epgData, isPlaying, isLoading, error, loadLiveByUrl, switchGroup, switchChannel, fetchEpg, getChannelTree, triggerRefresh, getRefreshStatus, applyRefreshProgress, isRefreshing, refreshProgress, lastRefreshTime, refreshInterval, } = useLiveStore();
    const play = usePlayerStore((state) => state.play);
    const autoSwitchSource = usePlayerStore((state) => state.autoSwitchSource);
    const setPlaybackError = usePlayerStore((state) => state.setPlaybackError);
    const currentConfig = useConfigStore((state) => state.currentConfig);
    const liveConfig = useConfigStore((state) => state.liveConfig);
    const livesConfig = liveConfig || currentConfig;
    const hasLoadedRef = useRef(false);
    const triedIndexRef = useRef(0);
    const otherQueueRef = useRef([]);
    const otherFetchingRef = useRef(false);
    const loadingRef = useRef(false);
    const channelUrlIndexRef = useRef(0);
    const playRequestRef = useRef(0);
    const channelPlaybackQueueRef = useRef([]);
    const channelHeadersQueueRef = useRef([]);
    const [channelTree, setChannelTree] = useState(null);
    const [searchKeyword, setSearchKeyword] = useState('');
    const equivalentChannels = useMemo(() => {
        const index = new Map();
        for (const country of channelTree?.countries || []) {
            for (const category of country.categories || []) {
                for (const channel of category.channels || []) {
                    const key = getEquivalentChannelKey(channel.name);
                    const items = index.get(key) || [];
                    items.push(channel);
                    index.set(key, items);
                }
            }
        }
        return index;
    }, [channelTree]);
    const buildPlaybackQueue = useCallback((channel) => {
        const candidates = [];
        const key = getEquivalentChannelKey(channel.name);
        const bestUrl = channel.bestUrl;
        const channelUrlHeaders = channel.urlHeaders;
        if (bestUrl) {
            candidates.push({ url: bestUrl, latency: 0, preferred: true, best: true, headers: channelUrlHeaders?.[bestUrl] });
        }
        for (const url of channel.urls) {
            candidates.push({ url, latency: 0, preferred: true, best: url === bestUrl, headers: channelUrlHeaders?.[url] });
        }
        for (const item of equivalentChannels.get(key) || []) {
            const itemUrlHeaders = item.urlHeaders;
            if (item.bestUrl) {
                candidates.push({
                    url: item.bestUrl,
                    latency: Number(item.latency) || Number.MAX_SAFE_INTEGER,
                    preferred: item.name === channel.name,
                    best: true,
                    headers: itemUrlHeaders?.[item.bestUrl]
                });
            }
            for (const url of item.urls || []) {
                candidates.push({
                    url,
                    latency: Number(item.latency) || Number.MAX_SAFE_INTEGER,
                    preferred: item.name === channel.name,
                    best: url === item.bestUrl,
                    headers: itemUrlHeaders?.[url]
                });
            }
        }
        candidates.sort((a, b) => {
            if (a.best !== b.best)
                return a.best ? -1 : 1;
            if (a.preferred !== b.preferred)
                return a.preferred ? -1 : 1;
            const scoreDelta = scoreLiveUrl(a.url) - scoreLiveUrl(b.url);
            if (scoreDelta !== 0)
                return scoreDelta;
            return a.latency - b.latency;
        });
        const uniqueUrls = [];
        const uniqueHeaders = [];
        const seen = new Set();
        for (const candidate of candidates) {
            if (!seen.has(candidate.url)) {
                seen.add(candidate.url);
                uniqueUrls.push(candidate.url);
                uniqueHeaders.push(candidate.headers);
            }
        }
        return { urls: uniqueUrls, headers: uniqueHeaders };
    }, [equivalentChannels]);
    // IPC 进度监听 + 加载频道树
    useEffect(() => {
        const handleProgress = (progress) => {
            applyRefreshProgress(progress);
            if (progress.phase === 'done') {
                getChannelTree().then(setChannelTree);
            }
        };
        const cleanup = on('live:refreshProgress', handleProgress);
        getChannelTree().then(setChannelTree);
        void getRefreshStatus();
        return cleanup;
    }, [applyRefreshProgress, getChannelTree, getRefreshStatus]);
    // 自动加载直播源（保留原有逻辑）
    useEffect(() => {
        if (hasLoadedRef.current)
            return;
        if (groups.length > 0) {
            hasLoadedRef.current = true;
            return;
        }
        if (isLoading || loadingRef.current)
            return;
        if (!livesConfig)
            return;
        const tryNext = async () => {
            loadingRef.current = true;
            const lives = livesConfig?.lives;
            if (lives && lives.length > 0) {
                while (triedIndexRef.current < lives.length) {
                    const live = lives[triedIndexRef.current];
                    triedIndexRef.current++;
                    if (live.name && live.url) {
                        console.log('[Live] 尝试当前配置直播源:', live.name, 'url:', live.url);
                        await loadLiveByUrl(live.url, live.name);
                        hasLoadedRef.current = useLiveStore.getState().groups.length > 0;
                        loadingRef.current = false;
                        return;
                    }
                }
            }
            while (otherQueueRef.current.length > 0) {
                const live = otherQueueRef.current.shift();
                if (live.name && live.url) {
                    console.log('[Live] 尝试其他配置直播源:', live.name, 'url:', live.url);
                    await loadLiveByUrl(live.url, live.name);
                    hasLoadedRef.current = useLiveStore.getState().groups.length > 0;
                    loadingRef.current = false;
                    return;
                }
            }
            if (!otherFetchingRef.current) {
                otherFetchingRef.current = true;
                try {
                    const configList = await configApi.list();
                    for (const cfg of configList) {
                        try {
                            const res = await configApi.peekLives(cfg.url);
                            if (res.success && res.data) {
                                for (const live of res.data) {
                                    if (live.name && live.url) {
                                        otherQueueRef.current.push({ name: live.name, url: live.url });
                                    }
                                }
                            }
                        }
                        catch {
                            // 跳过失败的配置
                        }
                    }
                }
                catch (err) {
                    console.error('[Live] 获取其他配置失败:', err);
                }
                otherFetchingRef.current = false;
                while (otherQueueRef.current.length > 0) {
                    const live = otherQueueRef.current.shift();
                    if (live.name && live.url) {
                        console.log('[Live] 尝试其他配置直播源:', live.name, 'url:', live.url);
                        await loadLiveByUrl(live.url, live.name);
                        hasLoadedRef.current = useLiveStore.getState().groups.length > 0;
                        loadingRef.current = false;
                        return;
                    }
                }
            }
            console.log('[Live] 所有配置的直播源均不可用');
            hasLoadedRef.current = true;
            loadingRef.current = false;
        };
        tryNext();
    }, [livesConfig, livesConfig?.lives, groups.length, isLoading, error]);
    const playLiveUrl = useCallback(async (url, headers) => {
        const requestId = ++playRequestRef.current;
        const playableUrl = await getPlayableMediaUrl(url, headers);
        if (requestId !== playRequestRef.current)
            return;
        play(playableUrl);
    }, [play]);
    useEffect(() => {
        if (!currentChannel || currentChannel.urls.length === 0)
            return;
        const queue = buildPlaybackQueue(currentChannel);
        channelPlaybackQueueRef.current = queue.urls;
        channelHeadersQueueRef.current = queue.headers;
        channelUrlIndexRef.current = 0;
        void playLiveUrl(queue.urls[0], queue.headers[0]);
    }, [buildPlaybackQueue, currentChannel, playLiveUrl]);
    const switchToNextLiveLine = useCallback(() => {
        if (!currentChannel)
            return;
        const nextIndex = channelUrlIndexRef.current + 1;
        const queue = channelPlaybackQueueRef.current;
        const headersQueue = channelHeadersQueueRef.current;
        if (nextIndex < queue.length) {
            channelUrlIndexRef.current = nextIndex;
            console.warn(`[Live] 当前线路失败，切换备用线路 ${nextIndex + 1}/${queue.length}:`, currentChannel.name);
            void playLiveUrl(queue[nextIndex], headersQueue[nextIndex]);
            return;
        }
        console.error('[Live] 当前频道所有线路均不可用:', currentChannel.name);
        setPlaybackError('当前频道所有线路均不可用');
    }, [currentChannel, playLiveUrl, setPlaybackError]);
    useEffect(() => {
        const handlePlayFailed = () => {
            if (autoSwitchSource)
                switchToNextLiveLine();
        };
        window.addEventListener('live:playFailed', handlePlayFailed);
        return () => window.removeEventListener('live:playFailed', handlePlayFailed);
    }, [autoSwitchSource, switchToNextLiveLine]);
    useEffect(() => {
        const handleRetry = () => {
            const queue = channelPlaybackQueueRef.current;
            const headersQueue = channelHeadersQueueRef.current;
            const url = queue[channelUrlIndexRef.current];
            if (url)
                void playLiveUrl(url, headersQueue[channelUrlIndexRef.current]);
        };
        const handleNextSource = () => switchToNextLiveLine();
        window.addEventListener('player:retry', handleRetry);
        window.addEventListener('player:nextSource', handleNextSource);
        return () => {
            window.removeEventListener('player:retry', handleRetry);
            window.removeEventListener('player:nextSource', handleNextSource);
        };
    }, [playLiveUrl, switchToNextLiveLine]);
    useEffect(() => {
        const ch = currentChannel;
        if (ch?.epgId && ch?.epgUrl) {
            fetchEpg(ch.epgUrl, ch.epgId);
        }
    }, [currentChannel, fetchEpg]);
    const handleKeyDown = useCallback((e) => {
        if (e.key === 'ArrowUp' && e.metaKey) {
            e.preventDefault();
            const idx = channels.findIndex((c) => c.name === currentChannel?.name);
            if (idx > 0)
                switchChannel(channels[idx - 1]);
        }
        else if (e.key === 'ArrowDown' && e.metaKey) {
            e.preventDefault();
            const idx = channels.findIndex((c) => c.name === currentChannel?.name);
            if (idx < channels.length - 1)
                switchChannel(channels[idx + 1]);
        }
    }, [channels, currentChannel]);
    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);
    const handleChannelClick = useCallback((channel) => {
        switchChannel({
            name: channel.name,
            urls: channel.bestUrl ? [channel.bestUrl, ...(channel.urls || [])] : channel.urls,
            number: channel.number,
            logo: channel.logo,
            format: channel.format,
            epgId: channel.epgId,
            bestUrl: channel.bestUrl,
            urlHeaders: channel.urlHeaders,
            epgUrl: channel.epgUrl
        });
    }, [switchChannel]);
    const verifiedChannelNames = useMemo(() => {
        const names = new Set();
        for (const country of channelTree?.countries || []) {
            for (const category of country.categories || []) {
                for (const channel of category.channels || []) {
                    names.add(channel.name);
                }
            }
        }
        return names;
    }, [channelTree]);
    const displayChannels = useMemo(() => {
        const keyword = searchKeyword.trim().toLowerCase();
        const isVisible = (channel) => (verifiedChannelNames.size === 0 || verifiedChannelNames.has(channel.name)) &&
            (!keyword || channel.name.toLowerCase().includes(keyword));
        return keyword
            ? groups.flatMap((group) => group.channels.filter(isVisible))
            : channels.filter(isVisible);
    }, [channels, groups, searchKeyword, verifiedChannelNames]);
    const filteredChannelTree = useMemo(() => {
        const keyword = searchKeyword.trim().toLowerCase();
        if (!channelTree || !keyword)
            return channelTree;
        return {
            countries: channelTree.countries.map((country) => ({
                ...country,
                categories: country.categories.map((category) => ({
                    ...category,
                    channels: category.channels.filter((channel) => channel.name.toLowerCase().includes(keyword))
                })).filter((category) => category.channels.length > 0)
            })).filter((country) => country.categories.length > 0)
        };
    }, [channelTree, searchKeyword]);
    const handleRetry = () => {
        hasLoadedRef.current = false;
        triedIndexRef.current = 0;
        otherQueueRef.current = [];
        otherFetchingRef.current = false;
        loadingRef.current = false;
        loadLiveByUrl(livesConfig?.lives?.[0]?.url || '', livesConfig?.lives?.[0]?.name);
    };
    if (!currentConfig && !liveConfig) {
        return (_jsx(EmptyState, { icon: Radio, title: "\u8FD8\u6CA1\u6709\u76F4\u64AD\u914D\u7F6E", description: "\u5BFC\u5165\u5305\u542B\u76F4\u64AD\u6E90\u7684\u914D\u7F6E\u540E\uFF0C\u8FD9\u91CC\u4F1A\u81EA\u52A8\u52A0\u8F7D\u9891\u9053\u5217\u8868\u3002", primaryLabel: "\u53BB\u5BFC\u5165\u914D\u7F6E", onPrimaryClick: () => navigate('/onboarding') }));
    }
    return (_jsx("div", { className: "h-full min-h-0 flex flex-col", children: _jsxs("div", { className: "flex-1 min-h-0 flex", children: [_jsxs("div", { className: "w-56 min-h-0 shrink-0 border-r border-[#2a2a2a] flex flex-col", children: [_jsx("div", { className: "px-3 py-2 border-b border-[#2a2a2a]", children: _jsx("span", { className: "text-xs text-text-secondary font-medium", children: searchKeyword ? `搜索: ${searchKeyword}` : currentGroup || '频道列表' }) }), _jsx(LiveRefreshBar, { isRefreshing: isRefreshing, refreshProgress: refreshProgress, lastRefreshTime: lastRefreshTime, refreshInterval: refreshInterval, onRefresh: () => void triggerRefresh(), onSettings: () => navigate('/settings') }), _jsx("div", { className: "px-3 py-2 border-b border-[#2a2a2a]", children: _jsxs("div", { className: "relative", children: [_jsx(Search, { className: "absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" }), _jsx("input", { type: "text", value: searchKeyword, onChange: (e) => setSearchKeyword(e.target.value), placeholder: "\u641C\u7D22\u9891\u9053...", className: "w-full pl-7 pr-2 py-1.5 text-xs bg-bg-tertiary rounded-md border border-[#2a2a2a] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent" })] }) }), channelTree && channelTree.countries.length > 0 ? (filteredChannelTree?.countries.length > 0 ? (_jsx(LiveTree, { tree: filteredChannelTree, onChannelClick: handleChannelClick, currentChannelName: currentChannel?.name })) : (_jsx("div", { className: "flex-1 min-h-0 flex items-center justify-center px-3 text-text-muted text-xs", children: "\u672A\u627E\u5230\u5339\u914D\u9891\u9053" }))) : (
                        /* 传统列表展示（无树形数据时） */
                        _jsx("div", { className: "flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-dark py-1", children: displayChannels.length === 0 ? (_jsx("div", { className: "flex items-center justify-center py-8 text-text-muted text-xs", children: searchKeyword ? '未找到匹配频道' : '暂无可用频道' })) : (displayChannels.map((channel, index) => (_jsx(ChannelItem, { channel: channel, isActive: currentChannel?.name === channel.name, onClick: (ch) => switchChannel(ch) }, `${channel.name}:${channel.urls[0] || 'no-url'}:${index}`)))) }))] }), _jsxs("div", { className: "flex-1 min-w-0 min-h-0 flex flex-col", children: [_jsx("div", { className: "flex-1 min-h-0 bg-black relative", children: currentChannel ? (_jsx(VideoPlayer, {})) : (_jsx("div", { className: "h-full flex items-center justify-center text-text-muted text-sm", children: isLoading ? '加载频道中...' : error || '请选择频道' })) }), epgData.length > 0 && (_jsx("div", { className: "shrink-0 px-4 py-2 bg-bg-secondary border-t border-[#2a2a2a]", children: _jsx("div", { className: "flex items-center gap-4 text-xs", children: epgData.slice(0, 3).map((epg, idx) => (_jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("span", { className: "text-text-muted", children: epg.start.slice(11, 16) }), _jsx("span", { className: idx === 0 ? 'text-accent' : 'text-text-secondary', children: epg.title })] }, idx))) }) }))] })] }) }));
}
