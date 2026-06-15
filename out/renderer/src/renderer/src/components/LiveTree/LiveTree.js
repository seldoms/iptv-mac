import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, Play } from 'lucide-react';
function LiveTree({ tree, onChannelClick, currentChannelName }) {
    const [expandedCountries, setExpandedCountries] = useState(new Set());
    const [expandedCategories, setExpandedCategories] = useState(new Set());
    // 自动展开第一个国家节点，以及每个已展开国家的第一个分类
    useEffect(() => {
        setExpandedCountries((prev) => {
            const next = new Set(prev);
            if (tree.countries.length > 0) {
                next.add(tree.countries[0].name);
            }
            return next;
        });
    }, [tree]); // eslint-disable-line react-hooks/exhaustive-deps
    // 自动展开每个已展开国家的第一个分类
    useEffect(() => {
        const initial = new Set();
        for (const country of tree.countries) {
            if (expandedCountries.has(country.name) && country.categories.length > 0) {
                initial.add(country.name + '-' + country.categories[0].name);
            }
        }
        setExpandedCategories(initial);
    }, [tree]); // eslint-disable-line react-hooks/exhaustive-deps
    const toggleCountry = (name) => {
        const next = new Set(expandedCountries);
        if (next.has(name))
            next.delete(name);
        else
            next.add(name);
        setExpandedCountries(next);
    };
    const toggleCategory = (countryName, catName) => {
        const key = `${countryName}-${catName}`;
        const next = new Set(expandedCategories);
        if (next.has(key))
            next.delete(key);
        else
            next.add(key);
        setExpandedCategories(next);
    };
    if (!tree.countries || tree.countries.length === 0) {
        return (_jsx("div", { className: "flex items-center justify-center h-32 text-text-muted text-xs", children: "\u6682\u65E0\u9891\u9053\u6570\u636E\uFF0C\u8BF7\u70B9\u51FB\u5237\u65B0" }));
    }
    return (_jsx("div", { className: "flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-dark py-2", "data-testid": "live-channel-tree", children: tree.countries.map((country) => {
            const isCountryExpanded = expandedCountries.has(country.name);
            return (_jsxs("div", { className: "mb-1", children: [_jsxs("button", { onClick: () => toggleCountry(country.name), className: "w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-text-secondary hover:text-accent transition-colors", children: [isCountryExpanded ? (_jsx(ChevronDown, { className: "w-3.5 h-3.5 shrink-0" })) : (_jsx(ChevronRight, { className: "w-3.5 h-3.5 shrink-0" })), _jsx("span", { className: "truncate", children: country.name }), _jsx("span", { className: "text-[10px] text-text-muted ml-auto", children: country.categories.reduce((sum, c) => sum + c.channels.length, 0) })] }), isCountryExpanded && (_jsx("div", { className: "ml-4", children: country.categories.map((category) => {
                            const catKey = `${country.name}-${category.name}`;
                            const isCatExpanded = expandedCategories.has(catKey);
                            return (_jsxs("div", { className: "mb-0.5", style: { contentVisibility: 'auto', containIntrinsicSize: '32px' }, children: [_jsxs("button", { onClick: () => toggleCategory(country.name, category.name), className: "w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted hover:text-accent transition-colors", children: [isCatExpanded ? (_jsx(ChevronDown, { className: "w-3 h-3 shrink-0" })) : (_jsx(ChevronRight, { className: "w-3 h-3 shrink-0" })), _jsx("span", { className: "truncate", children: category.name }), _jsx("span", { className: "text-[10px] text-text-muted ml-auto", children: category.channels.length })] }), isCatExpanded && (_jsx("div", { className: "ml-4", children: category.channels.map((channel, channelIndex) => {
                                            const isActive = channel.name === currentChannelName;
                                            return (_jsxs("button", { onClick: () => onChannelClick(channel), className: `w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${isActive
                                                    ? 'bg-accent-muted text-accent font-medium'
                                                    : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'}`, children: [_jsx(Play, { className: "w-3 h-3 shrink-0" }), _jsx("span", { className: "truncate flex-1", children: channel.name }), channel.latency > 0 && (_jsxs("span", { className: "text-[10px] text-text-muted", children: [channel.latency, "ms"] }))] }, `${channel.name}:${channel.urls?.[0] || 'no-url'}:${channelIndex}`));
                                        }) }))] }, catKey));
                        }) }))] }, country.name));
        }) }));
}
export default memo(LiveTree);
