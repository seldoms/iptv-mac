import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { RefreshCw, Settings } from 'lucide-react';
export default function LiveRefreshBar({ isRefreshing, refreshProgress, lastRefreshTime, refreshInterval, onRefresh, onSettings }) {
    // 计算进度百分比
    const progressPercent = refreshProgress && refreshProgress.total > 0
        ? Math.round((refreshProgress.current / refreshProgress.total) * 100)
        : 0;
    // 格式化时间
    const formatTime = (timestamp) => {
        if (!timestamp)
            return '未刷新';
        const date = new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp);
        return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    };
    return (_jsxs("div", { className: "border-b border-[#2a2a2a] px-3 py-2 bg-bg-secondary", children: [_jsxs("div", { className: `flex items-center justify-between gap-2 ${isRefreshing ? 'mb-2' : ''}`, children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("button", { onClick: onRefresh, disabled: isRefreshing, className: `flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${isRefreshing
                                    ? 'bg-accent-muted text-text-muted cursor-not-allowed'
                                    : 'bg-accent text-white hover:bg-accent-hover'}`, children: [_jsx(RefreshCw, { className: `w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}` }), isRefreshing ? '刷新中' : '刷新'] }), _jsx("button", { onClick: onSettings, className: "p-1 text-text-muted hover:text-accent transition-colors", children: _jsx(Settings, { className: "w-3.5 h-3.5" }) })] }), _jsxs("div", { className: "text-[10px] text-text-muted truncate", children: [formatTime(lastRefreshTime), " \u00B7 ", refreshInterval, "\u5206\u949F"] })] }), isRefreshing && refreshProgress && (_jsxs("div", { className: "space-y-1", children: [_jsxs("div", { className: "flex items-center justify-between text-[10px] text-text-muted", children: [_jsx("span", { children: refreshProgress.message }), _jsxs("span", { children: [progressPercent, "%"] })] }), _jsx("div", { className: "h-1 bg-bg-tertiary rounded-full overflow-hidden", children: _jsx("div", { className: "h-full bg-accent transition-all duration-300", style: { width: `${progressPercent}%` } }) })] }))] }));
}
