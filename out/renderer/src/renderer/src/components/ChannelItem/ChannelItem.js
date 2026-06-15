import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export default function ChannelItem({ channel, isActive, onClick }) {
    return (_jsxs("button", { onClick: () => onClick(channel), className: `w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 text-left ${isActive
            ? 'bg-accent-muted text-accent'
            : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`, children: [channel.number && (_jsx("span", { className: `text-xs font-mono w-8 text-right shrink-0 ${isActive ? 'text-accent' : 'text-text-muted'}`, children: channel.number })), channel.logo ? (_jsx("img", { src: channel.logo, alt: "", className: "w-8 h-8 rounded object-cover bg-bg-tertiary shrink-0", onError: (e) => {
                    ;
                    e.target.style.display = 'none';
                } })) : (_jsx("div", { className: "w-8 h-8 rounded bg-bg-tertiary flex items-center justify-center shrink-0", children: _jsx("span", { className: "text-xs text-text-muted", children: channel.name[0] }) })), _jsx("div", { className: "flex-1 min-w-0", children: _jsx("p", { className: `text-sm truncate ${isActive ? 'font-medium' : ''}`, children: channel.name }) }), isActive && (_jsx("div", { className: "w-1.5 h-1.5 rounded-full bg-accent shrink-0 animate-pulse" }))] }));
}
