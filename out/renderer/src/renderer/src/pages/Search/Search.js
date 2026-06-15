import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search as SearchIcon, X, Loader2 } from 'lucide-react';
import { useConfigStore } from '@/stores/useConfigStore';
import { siteApi, cacheApi } from '@/utils/ipc';
import VodCard from '@/components/VodCard/VodCard';
import EmptyState from '@/components/EmptyState/EmptyState';
export default function Search() {
    const navigate = useNavigate();
    const { currentConfig, sites } = useConfigStore();
    const [keyword, setKeyword] = useState('');
    const [results, setResults] = useState([]);
    const [searchHistory, setSearchHistory] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    // 加载搜索历史
    useEffect(() => {
        cacheApi.get('search_history').then((data) => {
            if (data) {
                try {
                    const parsed = JSON.parse(data);
                    if (Array.isArray(parsed))
                        setSearchHistory(parsed);
                }
                catch { }
            }
        });
    }, []);
    const saveSearchHistory = async (kw) => {
        const newHistory = [kw, ...searchHistory.filter((h) => h !== kw)].slice(0, 20);
        setSearchHistory(newHistory);
        await cacheApi.set('search_history', JSON.stringify(newHistory));
    };
    const clearHistory = async () => {
        setSearchHistory([]);
        await cacheApi.del('search_history');
    };
    const doSearch = useCallback(async (kw) => {
        if (!kw.trim())
            return;
        setKeyword(kw);
        setIsSearching(true);
        saveSearchHistory(kw);
        // 初始化所有站点的搜索结果
        const searchSites = sites.filter((s) => s.searchable !== 0);
        const initResults = searchSites.map((s) => ({
            siteKey: s.key,
            siteName: s.name,
            videos: [],
            loading: true,
            error: null
        }));
        setResults(initResults);
        // 并行搜索
        const promises = searchSites.map(async (site, idx) => {
            try {
                const res = await siteApi.searchContent(site.key, kw, true);
                const list = (res.data?.list || []);
                setResults((prev) => prev.map((r, i) => i === idx ? { ...r, videos: list, loading: false } : r));
            }
            catch (e) {
                setResults((prev) => prev.map((r, i) => i === idx ? { ...r, loading: false, error: e.message } : r));
            }
        });
        await Promise.allSettled(promises);
        setIsSearching(false);
    }, [sites]);
    const handleKeyDown = (e) => {
        if (e.key === 'Enter')
            doSearch(keyword);
    };
    const searchableSites = sites.filter((s) => s.searchable !== 0);
    if (!currentConfig) {
        return (_jsx(EmptyState, { icon: SearchIcon, title: "\u8FD8\u6CA1\u6709\u914D\u7F6E\u6E90", description: "\u5BFC\u5165\u914D\u7F6E\u540E\uFF0C\u641C\u7D22\u4F1A\u5728\u53EF\u7528\u7AD9\u70B9\u4E2D\u5E76\u884C\u67E5\u627E\u5185\u5BB9\u3002", primaryLabel: "\u53BB\u5BFC\u5165\u914D\u7F6E", onPrimaryClick: () => navigate('/onboarding') }));
    }
    if (searchableSites.length === 0) {
        return (_jsx(EmptyState, { icon: SearchIcon, title: "\u6CA1\u6709\u53EF\u641C\u7D22\u7AD9\u70B9", description: "\u5F53\u524D\u914D\u7F6E\u6E90\u6CA1\u6709\u5F00\u542F\u641C\u7D22\u80FD\u529B\u7684\u7AD9\u70B9\u3002\u53EF\u4EE5\u5207\u6362\u914D\u7F6E\u6E90\uFF0C\u6216\u68C0\u67E5\u914D\u7F6E\u4E2D\u7684 searchable \u5B57\u6BB5\u3002", primaryLabel: "\u5207\u6362\u914D\u7F6E", onPrimaryClick: () => navigate('/settings') }));
    }
    return (_jsxs("div", { className: "h-full flex flex-col", children: [_jsxs("div", { className: "shrink-0 px-6 pt-5 pb-3", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("div", { className: "flex-1 flex items-center gap-2 bg-bg-tertiary rounded-lg px-4 py-2.5", children: [_jsx(SearchIcon, { className: "w-4 h-4 text-text-muted shrink-0" }), _jsx("input", { type: "text", value: keyword, onChange: (e) => setKeyword(e.target.value), onKeyDown: handleKeyDown, placeholder: "\u641C\u7D22\u5F71\u7247...", className: "flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none", autoFocus: true }), keyword && (_jsx("button", { onClick: () => setKeyword(''), className: "text-text-muted hover:text-text-secondary", children: _jsx(X, { className: "w-4 h-4" }) }))] }), _jsx("button", { onClick: () => doSearch(keyword), disabled: !keyword.trim() || isSearching, className: "px-5 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-bg-primary text-sm font-medium rounded-lg transition-colors", children: "\u641C\u7D22" })] }), searchHistory.length > 0 && results.length === 0 && (_jsxs("div", { className: "mt-3 flex items-center gap-2 flex-wrap", children: [_jsx("span", { className: "text-xs text-text-muted", children: "\u641C\u7D22\u5386\u53F2\uFF1A" }), searchHistory.slice(0, 10).map((kw) => (_jsx("button", { onClick: () => doSearch(kw), className: "px-2.5 py-1 text-xs text-text-secondary bg-bg-tertiary rounded-full hover:text-accent hover:bg-accent-muted transition-colors", children: kw }, kw))), _jsx("button", { onClick: clearHistory, className: "text-xs text-text-muted hover:text-accent ml-2", children: "\u6E05\u9664" })] }))] }), _jsx("div", { className: "flex-1 overflow-y-auto scrollbar-dark px-6 pb-6", children: results.length === 0 ? (_jsx("div", { className: "flex items-center justify-center h-64 text-text-muted text-sm", children: "\u8F93\u5165\u5173\u952E\u8BCD\u641C\u7D22\u5F71\u7247" })) : (_jsx("div", { children: (() => {
                        const allVideos = results
                            .filter((r) => !r.loading && !r.error && r.videos.length > 0)
                            .flatMap((r) => r.videos.map((v) => ({ ...v, _siteKey: r.siteKey, _siteName: r.siteName })));
                        const pendingCount = results.filter((r) => r.loading).length;
                        return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-center gap-3 mb-4", children: [_jsx("h3", { className: "text-sm font-medium text-text-primary", children: "\u641C\u7D22\u7ED3\u679C" }), pendingCount > 0 && (_jsxs("span", { className: "inline-flex items-center gap-1.5 text-xs text-text-muted", children: [_jsx(Loader2, { className: "w-3 h-3 animate-spin" }), pendingCount, " \u4E2A\u7AD9\u70B9\u641C\u7D22\u4E2D..."] })), pendingCount === 0 && (_jsxs("span", { className: "text-xs text-text-muted", children: ["\u5171 ", allVideos.length, " \u4E2A\u7ED3\u679C"] }))] }), allVideos.length > 0 && (_jsx("div", { className: "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4", children: allVideos.map((v) => (_jsx(VodCard, { vod: v, sourceName: v._siteName, onClick: (vod) => navigate(`/vod/${v._siteKey}/${vod.vod_id}`) }, `${v._siteKey}:${v.vod_id}`))) })), pendingCount === 0 && allVideos.length === 0 && (_jsx("div", { className: "flex items-center justify-center h-48 text-text-muted text-sm", children: "\u672A\u627E\u5230\u76F8\u5173\u5F71\u7247" }))] }));
                    })() })) })] }));
}
