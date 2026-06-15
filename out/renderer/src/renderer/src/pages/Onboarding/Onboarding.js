import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Check, Link, Loader2, Radio, Search } from 'lucide-react';
import { configApi } from '@/utils/ipc';
import { useConfigStore } from '@/stores/useConfigStore';
import AppLogo from '@/components/AppLogo/AppLogo';
export default function Onboarding() {
    const navigate = useNavigate();
    const { loadConfig } = useConfigStore();
    const [url, setUrl] = useState('');
    const [inspection, setInspection] = useState(null);
    const [message, setMessage] = useState(null);
    const [isInspecting, setIsInspecting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const normalizedUrl = url.trim();
    const showMessage = (type, text) => {
        setMessage({ type, text });
    };
    const inspect = async () => {
        if (!normalizedUrl)
            return null;
        setIsInspecting(true);
        setInspection(null);
        try {
            const result = await configApi.inspect(normalizedUrl);
            if (result.success && result.data) {
                setInspection(result.data);
                showMessage('success', '配置预检通过');
                return result.data;
            }
            showMessage('error', result.error || '配置预检失败');
            return null;
        }
        catch (err) {
            showMessage('error', '配置预检失败: ' + String(err));
            return null;
        }
        finally {
            setIsInspecting(false);
        }
    };
    const importConfig = async () => {
        if (!normalizedUrl)
            return;
        setIsImporting(true);
        try {
            const currentInspection = inspection?.url === normalizedUrl ? inspection : await inspect();
            if (!currentInspection)
                return;
            const result = await configApi.load(normalizedUrl);
            if (!result.success) {
                showMessage('error', result.error || '配置导入失败');
                return;
            }
            await loadConfig(normalizedUrl);
            showMessage('success', '配置导入成功');
            if (currentInspection.visibleSiteCount > 0) {
                navigate('/', { replace: true });
            }
            else if (currentInspection.liveCount > 0) {
                navigate('/live', { replace: true });
            }
            else {
                navigate('/settings', { replace: true });
            }
        }
        catch (err) {
            showMessage('error', '配置导入失败: ' + String(err));
        }
        finally {
            setIsImporting(false);
        }
    };
    return (_jsx("div", { className: "h-full overflow-y-auto scrollbar-dark bg-bg-primary", children: _jsxs("div", { className: "mx-auto flex min-h-full max-w-3xl flex-col justify-center px-8 py-10", children: [_jsxs("div", { className: "mb-8", children: [_jsx(AppLogo, { className: "mb-4 h-14 w-14" }), _jsx("h1", { className: "text-2xl font-semibold text-text-primary", children: "\u5F00\u59CB\u4F7F\u7528 IPTV Mac" }), _jsx("p", { className: "mt-2 max-w-2xl text-sm leading-6 text-text-muted", children: "\u5DF2\u5185\u7F6E\u4E00\u7EC4\u53EF\u6D4B\u8BD5\u7684\u70B9\u64AD\u548C\u76F4\u64AD\u6E90\uFF0C\u6253\u5F00\u5373\u53EF\u4F7F\u7528\u3002\u4E5F\u53EF\u4EE5\u5728\u8FD9\u91CC\u5BFC\u5165\u81EA\u5DF1\u7684 TVBox/CatVod \u914D\u7F6E\u6216\u76F4\u64AD\u6E90\u76F4\u94FE\u3002" })] }), _jsxs("div", { className: "rounded-lg border border-[#2a2a2a] bg-bg-secondary p-4", children: [_jsxs("div", { className: "mb-3 flex items-center gap-2", children: [_jsx(Link, { className: "h-4 w-4 text-accent" }), _jsx("h2", { className: "text-sm font-medium text-text-primary", children: "\u5BFC\u5165\u914D\u7F6E\u5730\u5740" })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("input", { type: "text", value: url, onChange: (event) => {
                                        setUrl(event.target.value);
                                        setInspection(null);
                                        setMessage(null);
                                    }, onKeyDown: (event) => {
                                        if (event.key === 'Enter')
                                            void importConfig();
                                    }, placeholder: "https://example.com/config.json", className: "min-w-0 flex-1 rounded-lg bg-bg-tertiary px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:ring-1 focus:ring-accent", disabled: isInspecting || isImporting, autoFocus: true }), _jsxs("button", { onClick: inspect, disabled: !normalizedUrl || isInspecting || isImporting, className: "inline-flex items-center gap-1.5 rounded-lg border border-[#2a2a2a] px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-hover disabled:opacity-50", children: [isInspecting ? _jsx(Loader2, { className: "h-4 w-4 animate-spin" }) : _jsx(Search, { className: "h-4 w-4" }), "\u9884\u68C0"] }), _jsxs("button", { onClick: importConfig, disabled: !normalizedUrl || isInspecting || isImporting, className: "inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover disabled:opacity-50", children: [isImporting ? _jsx(Loader2, { className: "h-4 w-4 animate-spin" }) : _jsx(Check, { className: "h-4 w-4" }), "\u5BFC\u5165"] })] }), message && (_jsxs("div", { className: `mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${message.type === 'success'
                                ? 'border-green-500/20 bg-green-500/10 text-green-400'
                                : 'border-red-500/20 bg-red-500/10 text-red-400'}`, children: [message.type === 'success' ? _jsx(Check, { className: "h-4 w-4 shrink-0" }) : _jsx(AlertCircle, { className: "h-4 w-4 shrink-0" }), _jsx("span", { children: message.text })] })), inspection && (_jsxs("div", { className: "mt-4 rounded-lg border border-[#2a2a2a] bg-bg-primary p-3", children: [_jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate text-sm font-medium text-text-primary", children: inspection.name }), _jsx("p", { className: "mt-0.5 truncate text-xs text-text-muted", children: inspection.url })] }), _jsx("span", { className: "shrink-0 text-xs text-green-400", children: "\u53EF\u5BFC\u5165" })] }), _jsxs("div", { className: "mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4", children: [_jsx(Metric, { label: "\u70B9\u64AD\u7AD9\u70B9", value: `${inspection.visibleSiteCount}/${inspection.siteCount}` }), _jsx(Metric, { label: "\u53EF\u641C\u7D22", value: String(inspection.searchableSiteCount) }), _jsx(Metric, { label: "\u76F4\u64AD\u6E90", value: String(inspection.liveCount) }), _jsx(Metric, { label: "\u89E3\u6790\u5668", value: String(inspection.parseCount) })] }), inspection.warnings.length > 0 && (_jsx("div", { className: "mt-3 space-y-1", children: inspection.warnings.map((warning) => (_jsxs("div", { className: "flex items-start gap-2 text-xs text-yellow-300", children: [_jsx(AlertCircle, { className: "mt-0.5 h-3.5 w-3.5 shrink-0" }), _jsx("span", { children: warning })] }, warning))) }))] }))] }), _jsxs("div", { className: "mt-5 grid gap-3 sm:grid-cols-2", children: [_jsxs("div", { className: "rounded-lg border border-[#2a2a2a] bg-bg-secondary p-4", children: [_jsx(Radio, { className: "mb-3 h-5 w-5 text-accent" }), _jsx("h3", { className: "text-sm font-medium text-text-primary", children: "\u76F4\u64AD\u914D\u7F6E" }), _jsx("p", { className: "mt-1 text-xs leading-5 text-text-muted", children: "\u5305\u542B lives \u5B57\u6BB5\u7684\u914D\u7F6E\u4F1A\u81EA\u52A8\u52A0\u8F7D\u9891\u9053\uFF0C\u5E76\u5728\u76F4\u64AD\u9875\u5C55\u793A\u53EF\u7528\u9891\u9053\u3002" })] }), _jsxs("div", { className: "rounded-lg border border-[#2a2a2a] bg-bg-secondary p-4", children: [_jsx(Search, { className: "mb-3 h-5 w-5 text-accent" }), _jsx("h3", { className: "text-sm font-medium text-text-primary", children: "\u70B9\u64AD\u7AD9\u70B9" }), _jsx("p", { className: "mt-1 text-xs leading-5 text-text-muted", children: "type=0/1/4 \u7684\u7AD9\u70B9\u4F1A\u8FDB\u5165\u9996\u9875\u548C\u641C\u7D22\uFF0C\u6682\u4E0D\u652F\u6301 type=3 Jar \u63D2\u4EF6\u7AD9\u70B9\u3002" })] })] }), _jsxs("div", { className: "mt-6 flex items-center justify-between border-t border-[#2a2a2a] pt-4", children: [_jsx("button", { onClick: () => navigate('/settings'), className: "text-sm text-text-muted transition-colors hover:text-text-primary", children: "\u7A0D\u540E\u5728\u8BBE\u7F6E\u4E2D\u5BFC\u5165" }), _jsx("button", { onClick: () => navigate('/'), className: "text-sm text-text-muted transition-colors hover:text-text-primary", children: "\u5148\u8FDB\u5165\u5E94\u7528" })] })] }) }));
}
function Metric({ label, value }) {
    return (_jsxs("div", { className: "rounded-md bg-bg-tertiary px-3 py-2", children: [_jsx("p", { className: "text-[11px] text-text-muted", children: label }), _jsx("p", { className: "mt-1 text-sm text-text-primary", children: value })] }));
}
