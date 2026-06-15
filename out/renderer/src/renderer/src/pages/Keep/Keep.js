import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart, Trash2 } from 'lucide-react';
import { keepApi } from '@/utils/ipc';
import VodCard from '@/components/VodCard/VodCard';
export default function Keep() {
    const navigate = useNavigate();
    const [list, setList] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const loadKeep = async () => {
        setIsLoading(true);
        try {
            const data = (await keepApi.list());
            setList(data.sort((a, b) => (b.createTime || 0) - (a.createTime || 0)));
        }
        catch {
            setList([]);
        }
        setIsLoading(false);
    };
    useEffect(() => {
        loadKeep();
    }, []);
    const handleRemove = async (siteKey, vodId) => {
        await keepApi.delete(siteKey, vodId);
        setList((prev) => prev.filter((item) => item.siteKey !== siteKey || item.vodId !== vodId));
    };
    const handleVodClick = (vod, item) => {
        navigate(`/vod/${item.siteKey}/${item.vodId}`);
    };
    return (_jsxs("div", { className: "h-full flex flex-col", children: [_jsx("div", { className: "shrink-0 flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]", children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Heart, { className: "w-5 h-5 text-accent" }), _jsx("h2", { className: "text-lg font-medium text-text-primary", children: "\u6211\u7684\u6536\u85CF" }), _jsxs("span", { className: "text-xs text-text-muted", children: ["(", list.length, ")"] })] }) }), _jsx("div", { className: "flex-1 overflow-y-auto scrollbar-dark p-6", children: isLoading ? (_jsx("div", { className: "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4", children: Array.from({ length: 8 }).map((_, i) => (_jsx(VodCard, { vod: { vod_id: '', vod_name: '', vod_pic: '', vod_remarks: '' }, onClick: () => { }, loading: true }, i))) })) : list.length === 0 ? (_jsxs("div", { className: "flex flex-col items-center justify-center h-64 text-text-muted", children: [_jsx(Heart, { className: "w-10 h-10 mb-3 opacity-30" }), _jsx("p", { className: "text-sm", children: "\u6682\u65E0\u6536\u85CF" })] })) : (_jsx("div", { className: "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4", children: list.map((item) => (_jsxs("div", { className: "group relative", children: [_jsx(VodCard, { vod: {
                                    vod_id: item.vodId,
                                    vod_name: item.vodName,
                                    vod_pic: item.vodPic || '',
                                    vod_remarks: ''
                                }, onClick: (vod) => handleVodClick(vod, item) }), _jsx("button", { onClick: (e) => {
                                    e.stopPropagation();
                                    handleRemove(item.siteKey, item.vodId);
                                }, className: "absolute top-1 right-1 p-1 bg-black/60 rounded-full text-white/60 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all", children: _jsx(Trash2, { className: "w-3 h-3" }) })] }, `${item.siteKey}:${item.vodId}`))) })) })] }));
}
