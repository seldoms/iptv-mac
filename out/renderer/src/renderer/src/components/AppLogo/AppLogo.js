import { jsx as _jsx } from "react/jsx-runtime";
import logoUrl from '@/assets/logo.svg';
export default function AppLogo({ className = 'w-8 h-8' }) {
    return (_jsx("img", { src: logoUrl, alt: "IPTV Mac", className: `${className} select-none`, draggable: false }));
}
