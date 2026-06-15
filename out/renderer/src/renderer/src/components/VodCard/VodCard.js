import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export default function VodCard({ vod, onClick, loading, sourceName }) {
    if (loading) {
        return (_jsxs("div", { className: "flex flex-col gap-2 animate-pulse", children: [_jsx("div", { className: "aspect-[2/3] rounded-lg bg-bg-tertiary" }), _jsx("div", { className: "h-4 w-3/4 rounded bg-bg-tertiary" })] }));
    }
    return (_jsxs("div", { className: "group cursor-pointer flex flex-col gap-2", onClick: () => onClick(vod), children: [_jsxs("div", { className: "relative aspect-[2/3] rounded-lg overflow-hidden bg-bg-tertiary", children: [_jsx("img", { src: vod.vod_pic, alt: vod.vod_name, className: "w-full h-full object-cover transition-transform duration-300 group-hover:scale-105", loading: "lazy", onError: (e) => {
                            ;
                            e.target.src = '';
                            e.target.classList.add('bg-bg-tertiary');
                        } }), vod.vod_remarks && (_jsx("span", { className: "absolute top-1.5 right-1.5 px-1.5 py-0.5 text-[10px] font-medium bg-accent/90 text-bg-primary rounded", children: vod.vod_remarks })), sourceName && (_jsx("span", { className: "absolute bottom-1.5 left-1.5 px-1.5 py-0.5 text-[10px] bg-black/70 text-white/80 rounded", children: sourceName })), _jsx("div", { className: "absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300" })] }), _jsx("h3", { className: "text-sm text-text-primary line-clamp-1 leading-tight group-hover:text-accent transition-colors", children: vod.vod_name }), vod.type_name && (_jsx("p", { className: "text-[11px] text-text-muted line-clamp-1", children: vod.type_name }))] }));
}
