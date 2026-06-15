import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Tv, Search, Clock, Heart, Settings, ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react';
import AppLogo from '@/components/AppLogo/AppLogo';
const navItems = [
    { icon: Home, label: '首页', path: '/' },
    { icon: Tv, label: '直播', path: '/live' },
    { icon: Search, label: '搜索', path: '/search' },
    { icon: Clock, label: '历史', path: '/history' },
    { icon: Heart, label: '收藏', path: '/keep' },
    { icon: Settings, label: '设置', path: '/settings' }
];
export default function Sidebar() {
    const [collapsed, setCollapsed] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const isActive = (path) => {
        if (path === '/')
            return location.pathname === '/';
        return location.pathname.startsWith(path);
    };
    // 是否显示返回按钮（非根页面时显示）
    const showBack = !['/', '/live', '/search', '/history', '/keep', '/settings'].includes(location.pathname);
    return (_jsxs("aside", { className: `flex flex-col h-full bg-bg-secondary border-r border-[#2a2a2a] transition-all duration-300 ${collapsed ? 'w-16' : 'w-20'}`, children: [_jsx("div", { className: "flex items-center justify-center h-20 pt-6 border-b border-[#2a2a2a]", style: { WebkitAppRegion: 'drag' }, children: _jsx("div", { style: { WebkitAppRegion: 'no-drag' }, children: _jsx(AppLogo, {}) }) }), _jsxs("nav", { className: "flex-1 flex flex-col items-center py-4 gap-1", children: [showBack && (_jsxs("button", { onClick: () => navigate(-1), className: "group relative flex flex-col items-center justify-center w-14 h-14 rounded-xl transition-all duration-200 text-text-muted hover:text-text-primary hover:bg-bg-hover", title: "\u8FD4\u56DE\u4E0A\u4E00\u9875", children: [_jsx(ArrowLeft, { className: "w-5 h-5" }), _jsx("span", { className: "text-[10px] mt-1", children: "\u8FD4\u56DE" })] })), navItems.map((item) => {
                        const Icon = item.icon;
                        const active = isActive(item.path);
                        return (_jsxs("button", { onClick: () => navigate(item.path), className: `group relative flex flex-col items-center justify-center w-14 h-14 rounded-xl transition-all duration-200 ${active
                                ? 'text-accent bg-accent-muted'
                                : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'}`, title: item.label, children: [_jsx(Icon, { className: "w-5 h-5", strokeWidth: active ? 2.5 : 2 }), _jsx("span", { className: `text-[10px] mt-1 ${active ? 'font-medium' : ''}`, children: item.label }), active && (_jsx("div", { className: "absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-accent rounded-r-full" }))] }, item.path));
                    })] }), _jsx("div", { className: "flex items-center justify-center py-3 border-t border-[#2a2a2a]", children: _jsx("button", { onClick: () => setCollapsed(!collapsed), className: "p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors", children: collapsed ? (_jsx(ChevronRight, { className: "w-4 h-4" })) : (_jsx(ChevronLeft, { className: "w-4 h-4" })) }) })] }));
}
