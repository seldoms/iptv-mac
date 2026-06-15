import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Trash2 } from 'lucide-react';
import { historyApi } from '@/utils/ipc';
export default function History() {
    const navigate = useNavigate();
    const [list, setList] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const loadHistory = async () => {
        setIsLoading(true);
        try {
            const data = (await historyApi.list());
            setList(data.sort((a, b) => (b.updateTime || 0) - (a.updateTime || 0)));
        }
        catch {
            setList([]);
        }
        setIsLoading(false);
    };
    useEffect(() => {
        loadHistory();
    }, []);
    const handleDelete = async (siteKey, vodId) => {
        await historyApi.delete(siteKey, vodId);
        setList((prev) => prev.filter((item) => item.siteKey !== siteKey || item.vodId !== vodId));
    };
    const handleClearAll = async () => {
        for (const item of list) {
            await historyApi.delete(item.siteKey, item.vodId);
        }
        setList([]);
    };
    const handleClick = (item) => {
        navigate(`/vod/${item.siteKey}/${item.vodId}`);
    };
    const formatDate = (timestamp) => {
        const d = new Date(timestamp);
        const now = new Date();
        const diff = now.getTime() - d.getTime();
        if (diff < 60000)
            return '刚刚';
        if (diff < 3600000)
            return `${Math.floor(diff / 60000)}分钟前`;
        if (diff < 86400000)
            return `${Math.floor(diff / 3600000)}小时前`;
        return d.toLocaleDateString('zh-CN');
    };
    return (_jsxs("div", { className: "h-full flex flex-col", children: [_jsxs("div", { className: "shrink-0 flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Clock, { className: "w-5 h-5 text-accent" }), _jsx("h2", { className: "text-lg font-medium text-text-primary", children: "\u89C2\u770B\u5386\u53F2" }), _jsxs("span", { className: "text-xs text-text-muted", children: ["(", list.length, ")"] })] }), list.length > 0 && (_jsxs("button", { onClick: handleClearAll, className: "flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted hover:text-red-400 rounded-md hover:bg-bg-hover transition-colors", children: [_jsx(Trash2, { className: "w-3.5 h-3.5" }), " \u6E05\u7A7A\u5168\u90E8"] }))] }), _jsx("div", { className: "flex-1 overflow-y-auto scrollbar-dark p-6", children: isLoading ? (_jsx("div", { className: "flex items-center justify-center h-32 text-text-muted text-sm", children: "\u52A0\u8F7D\u4E2D..." })) : list.length === 0 ? (_jsx("div", { className: "flex items-center justify-center h-32 text-text-muted text-sm", children: "\u6682\u65E0\u89C2\u770B\u8BB0\u5F55" })) : (_jsx("div", { className: "space-y-3", children: list.map((item) => (_jsxs("div", { className: "flex items-center gap-4 p-3 rounded-lg bg-bg-secondary hover:bg-bg-hover cursor-pointer transition-colors group", onClick: () => handleClick(item), children: [_jsx("div", { className: "shrink-0 w-16 h-22 rounded overflow-hidden bg-bg-tertiary", children: _jsx("img", { src: item.vodPic, alt: item.vodName, className: "w-full h-full object-cover", onError: (e) => {
                                        ;
                                        e.target.style.display = 'none';
                                    } }) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("h3", { className: "text-sm font-medium text-text-primary truncate group-hover:text-accent transition-colors", children: item.vodName }), _jsx("p", { className: "text-xs text-text-muted mt-1", children: item.source || '未知播放源' }), _jsxs("div", { className: "flex items-center gap-2 mt-2", children: [_jsx("div", { className: "flex-1 h-1 bg-bg-tertiary rounded-full overflow-hidden", children: _jsx("div", { className: "h-full bg-accent rounded-full transition-all", style: { width: `${Math.max(0, Math.min(100, item.progress || 0))}%` } }) }), _jsxs("span", { className: "text-[10px] text-text-muted shrink-0", children: [Math.max(0, Math.min(100, item.progress || 0)).toFixed(0), "%"] })] })] }), _jsxs("div", { className: "shrink-0 flex flex-col items-end gap-2", children: [_jsx("span", { className: "text-[10px] text-text-muted", children: formatDate((item.updateTime || 0) * 1000) }), _jsx("button", { onClick: (e) => {
                                            e.stopPropagation();
                                            handleDelete(item.siteKey, item.vodId);
                                        }, className: "p-1 text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all", children: _jsx(Trash2, { className: "w-3.5 h-3.5" }) })] })] }, `${item.siteKey}:${item.vodId}`))) })) })] }));
}
