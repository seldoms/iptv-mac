import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronDown, Loader2, ArrowLeft } from 'lucide-react';
import { useConfigStore } from '@/stores/useConfigStore';
import VodCard from '@/components/VodCard/VodCard';
import EmptyState from '@/components/EmptyState/EmptyState';
export default function Home() {
    const navigate = useNavigate();
    const { currentConfig, sites, currentSiteKey, categories, filters, homeVideos, categoryVideos, currentPage, hasMore, isLoading, error, switchSite, fetchCategoryContent } = useConfigStore();
    const [activeCategory, setActiveCategory] = useState('');
    const [selectedFilters, setSelectedFilters] = useState({});
    const [showFilterPanel, setShowFilterPanel] = useState(false);
    const scrollContainerRef = useRef(null);
    const [showSiteSheet, setShowSiteSheet] = useState(false);
    const siteSheetRef = useRef(null);
    // 只显示 HTTP API 类型的站点（type 0/1/4）
    const visibleSites = sites.filter((s) => s.type === 0 || s.type === 1 || s.type === 4);
    // 获取当前分类的可用筛选器
    const activeFilters = (filters && activeCategory && filters[activeCategory]) || [];
    useEffect(() => {
        setActiveCategory('');
        setSelectedFilters({});
        setShowFilterPanel(false);
        setShowSiteSheet(false);
        scrollContainerRef.current?.scrollTo({ top: 0 });
    }, [currentSiteKey, sites]);
    // 分类切换
    useEffect(() => {
        if (activeCategory && activeCategory !== '首页') {
            fetchCategoryContent(activeCategory, 1, selectedFilters);
        }
    }, [activeCategory, selectedFilters]);
    const handleSiteSwitch = (key) => {
        setActiveCategory('');
        setSelectedFilters({});
        setShowFilterPanel(false);
        switchSite(key);
        setShowSiteSheet(false);
    };
    const handleSiteSheetClick = (key) => {
        if (key === currentSiteKey) {
            setShowSiteSheet(prev => !prev);
        }
        else {
            handleSiteSwitch(key);
        }
    };
    const handleCategoryClick = (tid) => {
        if (tid === activeCategory)
            return;
        setActiveCategory(tid);
        setSelectedFilters({});
        setShowFilterPanel(false);
        setShowSiteSheet(false);
    };
    const handleFilterChange = (key, value) => {
        setSelectedFilters((prev) => ({ ...prev, [key]: value }));
    };
    const handleVodClick = (vod) => {
        navigate(`/vod/${currentSiteKey}/${vod.vod_id}`);
    };
    // 无限滚动
    const handleScroll = useCallback(() => {
        const el = scrollContainerRef.current;
        if (!el || isLoading || !hasMore || !activeCategory || activeCategory === '首页')
            return;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
            fetchCategoryContent(activeCategory, currentPage + 1, selectedFilters);
        }
    }, [isLoading, hasMore, activeCategory, currentPage, selectedFilters]);
    const displayVideos = activeCategory && activeCategory !== '首页' ? categoryVideos : homeVideos;
    if (!currentConfig) {
        return (_jsx(EmptyState, { icon: Search, title: "\u8FD8\u6CA1\u6709\u914D\u7F6E\u6E90", description: "\u5148\u5BFC\u5165\u4E00\u4E2A TVBox/CatVod \u517C\u5BB9\u914D\u7F6E\uFF0C\u5BFC\u5165\u6210\u529F\u540E\u8FD9\u91CC\u4F1A\u663E\u793A\u53EF\u6D4F\u89C8\u7684\u5185\u5BB9\u3002", primaryLabel: "\u53BB\u5BFC\u5165\u914D\u7F6E", onPrimaryClick: () => navigate('/onboarding') }));
    }
    // 没有可见站点（type=0/1/4 都不可用）
    if (visibleSites.length === 0) {
        return (_jsx(EmptyState, { icon: Search, title: "\u672A\u627E\u5230\u53EF\u7528\u7AD9\u70B9", description: "\u5F53\u524D\u914D\u7F6E\u6E90\u4E2D\u6CA1\u6709\u53EF\u7528\u4E8E\u70B9\u64AD\u6D4F\u89C8\u7684\u7AD9\u70B9\u3002\u53EF\u4EE5\u5207\u6362\u914D\u7F6E\u6E90\uFF0C\u6216\u68C0\u67E5\u914D\u7F6E\u5185\u5BB9\u548C\u7F51\u7EDC\u8FDE\u63A5\u3002", primaryLabel: "\u5207\u6362\u914D\u7F6E", onPrimaryClick: () => navigate('/settings'), secondaryLabel: "\u91CD\u65B0\u52A0\u8F7D", onSecondaryClick: () => window.location.reload() }));
    }
    return (_jsxs("div", { className: "h-full flex flex-col", children: [_jsxs("div", { className: "shrink-0 border-b border-[#2a2a2a]", children: [_jsxs("div", { className: "flex items-center px-4 pt-3 gap-1 scrollbar-hidden overflow-x-auto", children: [_jsx("button", { onClick: () => navigate(-1), className: "shrink-0 p-1.5 text-text-muted hover:text-accent transition-colors mr-1", title: "\u8FD4\u56DE", children: _jsx(ArrowLeft, { className: "w-4 h-4" }) }), visibleSites.map((site) => (_jsx("button", { onClick: () => handleSiteSwitch(site.key), className: `shrink-0 px-3 py-1.5 text-sm rounded-full transition-colors ${currentSiteKey === site.key
                                    ? 'bg-accent text-bg-primary font-medium'
                                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'}`, children: site.name }, site.key))), _jsx("div", { className: "flex-1" }), _jsx("button", { onClick: () => navigate('/search'), className: "shrink-0 p-2 text-text-muted hover:text-accent transition-colors", children: _jsx(Search, { className: "w-5 h-5" }) })] }), categories.length > 0 && (_jsxs("div", { className: "flex items-center px-4 py-2 gap-1 scrollbar-hidden overflow-x-auto", children: [_jsxs("div", { className: "relative shrink-0", children: [_jsx("button", { onClick: () => { setActiveCategory(''); setShowFilterPanel(false); handleSiteSheetClick(currentSiteKey); }, className: `shrink-0 px-3 py-1 text-xs rounded-md transition-colors ${!activeCategory
                                            ? 'bg-accent/20 text-accent'
                                            : 'text-text-muted hover:text-text-secondary'}`, children: "\u9996\u9875" }), showSiteSheet && (_jsx("div", { className: "fixed inset-0 z-40", onClick: () => setShowSiteSheet(false) })), showSiteSheet && (_jsx("div", { className: "absolute z-50 top-full left-0 mt-1 min-w-[180px] max-h-[360px] overflow-y-auto rounded-lg border border-[#2a2a2a] bg-bg-secondary shadow-xl py-1", children: visibleSites.map((site) => (_jsx("button", { onClick: () => handleSiteSwitch(site.key), className: `w-full text-left px-3 py-2 text-sm transition-colors ${currentSiteKey === site.key
                                                ? 'text-accent bg-accent/10'
                                                : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'}`, children: site.name }, site.key))) }))] }), categories.map((cat) => (_jsx("button", { onClick: () => handleCategoryClick(cat.type_id), className: `shrink-0 px-3 py-1 text-xs rounded-md transition-colors ${activeCategory === cat.type_id
                                    ? 'bg-accent/20 text-accent'
                                    : 'text-text-muted hover:text-text-secondary'}`, children: cat.type_name }, cat.type_id))), activeFilters.length > 0 && activeCategory && (_jsxs("button", { onClick: () => setShowFilterPanel(!showFilterPanel), className: `shrink-0 flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors ${showFilterPanel ? 'text-accent' : 'text-text-muted hover:text-text-secondary'}`, children: ["\u7B5B\u9009 ", _jsx(ChevronDown, { className: `w-3 h-3 transition-transform ${showFilterPanel ? 'rotate-180' : ''}` })] }))] })), showFilterPanel && activeFilters.length > 0 && (_jsx("div", { className: "px-4 py-2 border-t border-[#2a2a2a] space-y-2", children: activeFilters.map((filter) => (_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsxs("span", { className: "text-xs text-text-muted shrink-0 w-12", children: [filter.name, ":"] }), filter.value.map((v) => (_jsx("button", { onClick: () => handleFilterChange(filter.key, v.v), className: `px-2 py-0.5 text-xs rounded transition-colors ${selectedFilters[filter.key] === v.v
                                        ? 'bg-accent/20 text-accent'
                                        : 'text-text-muted hover:text-text-secondary'}`, children: v.n }, v.v)))] }, filter.key))) }))] }), error && !isLoading && (_jsx("div", { className: "shrink-0 px-4 py-2 bg-red-500/10 text-red-400 text-xs text-center", children: error })), _jsxs("div", { ref: scrollContainerRef, onScroll: handleScroll, className: "flex-1 overflow-y-auto scrollbar-dark p-4", children: [isLoading && displayVideos.length === 0 ? (_jsx("div", { className: "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4", children: Array.from({ length: 12 }).map((_, i) => (_jsx(VodCard, { vod: { vod_id: '', vod_name: '', vod_pic: '', vod_remarks: '' }, onClick: () => { }, loading: true }, i))) })) : displayVideos.length > 0 ? (_jsx("div", { className: "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4", children: displayVideos.map((vod) => (_jsx(VodCard, { vod: vod, onClick: handleVodClick }, vod.vod_id))) })) : (_jsx("div", { className: "flex items-center justify-center h-64 text-text-muted text-sm", children: isLoading ? '加载中...' : '暂无内容，请尝试切换站点或配置源' })), isLoading && displayVideos.length > 0 && (_jsx("div", { className: "flex justify-center py-4", children: _jsx(Loader2, { className: "w-5 h-5 text-accent animate-spin" }) }))] })] }));
}
