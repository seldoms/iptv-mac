import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useCallback } from 'react';
import { Settings as SettingsIcon, Plus, Trash2, RefreshCw, Globe, Monitor, Info, ChevronRight, Link, Check, AlertCircle, Edit3, Save, X, Tv } from 'lucide-react';
import { configApi, invoke, localApi, on } from '@/utils/ipc';
import { useConfigStore } from '@/stores/useConfigStore';
import { useNavigate } from 'react-router-dom';
export default function Settings() {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('config');
    const [configs, setConfigs] = useState([]);
    const [currentUrl, setCurrentUrl] = useState('');
    const [newConfigUrl, setNewConfigUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [inspectLoading, setInspectLoading] = useState(false);
    const [inspection, setInspection] = useState(null);
    const [editingConfigUrl, setEditingConfigUrl] = useState('');
    const [editingConfigName, setEditingConfigName] = useState('');
    const [message, setMessage] = useState(null);
    const [version, setVersion] = useState('1.0.0');
    const [localServer, setLocalServer] = useState({ url: '', token: '' });
    const { loadConfig } = useConfigStore();
    useEffect(() => {
        localApi.getServerInfo().then(setLocalServer).catch(() => { });
    }, []);
    // Live refresh state
    const [liveRefreshInterval, setLiveRefreshInterval] = useState(30);
    const [liveRefreshing, setLiveRefreshing] = useState(false);
    const [liveRefreshProgress, setLiveRefreshProgress] = useState(null);
    const [liveStats, setLiveStats] = useState(null);
    // Load live refresh status
    useEffect(() => {
        const handleProgress = (progress) => {
            setLiveRefreshProgress(progress);
            setLiveRefreshing(progress.phase !== 'done' && progress.phase !== 'error');
            if (progress.phase === 'done') {
                loadLiveStatus();
            }
        };
        const cleanup = on('live:refreshProgress', handleProgress);
        loadLiveStatus();
        return cleanup;
    }, []);
    const loadLiveStatus = async () => {
        try {
            const status = await invoke('live:getRefreshStatus');
            if (status) {
                setLiveRefreshInterval(status.interval || 30);
                setLiveStats({
                    lastRefreshTime: status.lastRefreshTime || 0,
                    totalChannels: 0,
                    aliveChannels: 0
                });
            }
        }
        catch (e) {
            // ignore
        }
    };
    const handleLiveRefresh = useCallback(async () => {
        if (liveRefreshing)
            return;
        setLiveRefreshing(true);
        try {
            await invoke('live:refresh');
        }
        catch (e) {
            setLiveRefreshing(false);
        }
    }, [liveRefreshing]);
    const handleLiveIntervalSave = async () => {
        try {
            const res = await invoke('live:setRefreshInterval', liveRefreshInterval);
            if (res.success) {
                showMessage('success', `刷新间隔已设置为 ${liveRefreshInterval} 分钟`);
                await loadLiveStatus();
            }
            else {
                showMessage('error', res.error || '设置失败');
            }
        }
        catch (e) {
            showMessage('error', '设置失败: ' + (e.message || '未知错误'));
        }
    };
    // 加载配置列表和当前配置
    useEffect(() => {
        loadData();
    }, []);
    const loadData = async () => {
        try {
            const [list, url] = await Promise.all([
                configApi.list(),
                configApi.getCurrentUrl()
            ]);
            setConfigs(list || []);
            setCurrentUrl(url || '');
        }
        catch (err) {
            console.error('加载配置失败:', err);
        }
    };
    // 显示消息
    const showMessage = (type, text) => {
        setMessage({ type, text });
        setTimeout(() => setMessage(null), 3000);
    };
    const inspectConfigUrl = async (url, options) => {
        if (!url)
            return null;
        setInspectLoading(true);
        setInspection(null);
        try {
            const result = await configApi.inspect(url);
            if (result?.success && result.data) {
                setInspection(result.data);
                if (!options?.silent)
                    showMessage('success', '配置预检通过');
                return result.data;
            }
            if (!options?.silent)
                showMessage('error', result?.error || '配置预检失败');
            return null;
        }
        catch (err) {
            if (!options?.silent)
                showMessage('error', '配置预检失败: ' + String(err));
            return null;
        }
        finally {
            setInspectLoading(false);
        }
    };
    const handleInspectConfig = async () => {
        return inspectConfigUrl(newConfigUrl.trim());
    };
    // 添加配置
    const handleAddConfig = async () => {
        if (!newConfigUrl.trim())
            return;
        setLoading(true);
        try {
            const url = newConfigUrl.trim();
            const currentInspection = inspection?.url === url ? inspection : await handleInspectConfig();
            if (!currentInspection)
                return;
            const result = await configApi.load(url);
            if (result?.success) {
                setNewConfigUrl('');
                setInspection(null);
                setCurrentUrl(url);
                // 刷新首页内容
                await loadConfig(url);
                await loadData();
                showMessage('success', `配置添加成功：${currentInspection.visibleSiteCount} 个点播站点，${currentInspection.liveCount} 个直播源`);
            }
            else {
                showMessage('error', '加载配置失败: ' + (result?.error || '未知错误'));
            }
        }
        catch (err) {
            showMessage('error', '加载配置失败: ' + String(err));
        }
        finally {
            setLoading(false);
        }
    };
    // 删除配置
    const handleDeleteConfig = async (config) => {
        const confirmed = window.confirm(`确定删除配置「${config.name}」吗？`);
        if (!confirmed)
            return;
        const url = config.url;
        try {
            const result = await configApi.remove(url);
            if (!result.success) {
                showMessage('error', result.error || '删除失败');
                return;
            }
        }
        catch (err) {
            showMessage('error', '后端删除失败: ' + String(err));
            return;
        }
        if (url === currentUrl) {
            setCurrentUrl('');
            useConfigStore.getState().reset();
            useConfigStore.setState({
                sites: [],
                currentSiteKey: '',
                categories: [],
                filters: {},
                homeVideos: [],
                categoryVideos: [],
                currentPage: 1,
                hasMore: false,
                isLoading: false,
                error: null,
            });
        }
        if (editingConfigUrl === url) {
            setEditingConfigUrl('');
            setEditingConfigName('');
        }
        const freshList = await configApi.list();
        const freshUrl = await configApi.getCurrentUrl();
        setConfigs(freshList || []);
        setCurrentUrl(freshUrl || '');
        showMessage('success', '配置已删除');
    };
    const handleStartRename = (config) => {
        setEditingConfigUrl(config.url);
        setEditingConfigName(config.name);
    };
    const handleCancelRename = () => {
        setEditingConfigUrl('');
        setEditingConfigName('');
    };
    const handleSaveRename = async (url) => {
        const name = editingConfigName.trim();
        if (!name) {
            showMessage('error', '配置名称不能为空');
            return;
        }
        try {
            const result = await configApi.rename(url, name);
            if (result.success) {
                setEditingConfigUrl('');
                setEditingConfigName('');
                await loadData();
                showMessage('success', '配置名称已更新');
            }
            else {
                showMessage('error', result.error || '重命名失败');
            }
        }
        catch (err) {
            showMessage('error', '重命名失败: ' + String(err));
        }
    };
    const handleInspectSavedConfig = async (config) => {
        const result = await inspectConfigUrl(config.url);
        if (result) {
            setNewConfigUrl(config.url);
        }
    };
    // 切换配置
    const handleSwitchConfig = async (url) => {
        setLoading(true);
        try {
            const result = await configApi.load(url);
            if (result?.success) {
                setCurrentUrl(url);
                // 刷新首页内容
                await loadConfig(url);
                await loadData();
                showMessage('success', '配置切换成功');
            }
            else {
                showMessage('error', '切换配置失败: ' + (result?.error || '未知错误'));
            }
        }
        catch (err) {
            showMessage('error', '切换配置失败: ' + String(err));
        }
        finally {
            setLoading(false);
        }
    };
    const tabs = [
        { key: 'config', label: '配置管理', icon: Link },
        { key: 'live', label: '直播设置', icon: Tv },
        { key: 'network', label: '网络设置', icon: Globe },
        { key: 'player', label: '播放设置', icon: Monitor },
        { key: 'about', label: '关于', icon: Info }
    ];
    return (_jsxs("div", { className: "h-full flex", children: [_jsxs("div", { className: "w-48 shrink-0 border-r border-[#2a2a2a] py-4 px-3", children: [_jsxs("div", { className: "flex items-center gap-2 px-3 mb-4", children: [_jsx(SettingsIcon, { className: "w-5 h-5 text-accent" }), _jsx("h2", { className: "text-base font-medium text-text-primary", children: "\u8BBE\u7F6E" })] }), _jsx("nav", { className: "space-y-1", children: tabs.map((tab) => {
                            const Icon = tab.icon;
                            return (_jsxs("button", { onClick: () => setActiveTab(tab.key), className: `w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${activeTab === tab.key
                                    ? 'bg-accent-muted text-accent'
                                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'}`, children: [_jsx(Icon, { className: "w-4 h-4" }), tab.label] }, tab.key));
                        }) })] }), _jsxs("div", { className: "flex-1 overflow-y-auto scrollbar-dark p-6", children: [message && (_jsxs("div", { className: `mb-4 flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm ${message.type === 'success'
                            ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'}`, children: [message.type === 'success' ? _jsx(Check, { className: "w-4 h-4 shrink-0" }) : _jsx(AlertCircle, { className: "w-4 h-4 shrink-0" }), message.text] })), activeTab === 'config' && (_jsxs("div", { className: "space-y-6 max-w-2xl", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-medium text-text-primary mb-3", children: "\u6DFB\u52A0\u914D\u7F6E" }), _jsxs("div", { className: "flex gap-2", children: [_jsx("input", { type: "text", value: newConfigUrl, onChange: (e) => {
                                                    setNewConfigUrl(e.target.value);
                                                    setInspection(null);
                                                }, placeholder: "\u8F93\u5165\u914D\u7F6E\u5730\u5740\uFF08JSON URL\uFF09...", className: "flex-1 px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent", onKeyDown: (e) => e.key === 'Enter' && handleAddConfig(), disabled: loading || inspectLoading }), _jsxs("button", { onClick: handleInspectConfig, disabled: !newConfigUrl.trim() || loading || inspectLoading, className: "flex items-center gap-1.5 px-4 py-2 border border-[#2a2a2a] hover:bg-bg-hover disabled:opacity-50 text-text-secondary text-sm font-medium rounded-lg transition-colors", children: [_jsx(RefreshCw, { className: `w-4 h-4 ${inspectLoading ? 'animate-spin' : ''}` }), inspectLoading ? '预检中...' : '预检'] }), _jsxs("button", { onClick: handleAddConfig, disabled: !newConfigUrl.trim() || loading || inspectLoading, className: "flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-bg-primary text-sm font-medium rounded-lg transition-colors", children: [_jsx(Plus, { className: "w-4 h-4" }), " ", loading ? '加载中...' : '添加'] })] }), _jsx("p", { className: "text-xs text-text-muted mt-2", children: "\u8F93\u5165 FongMi/TV \u517C\u5BB9\u7684\u914D\u7F6E JSON \u5730\u5740\uFF0C\u52A0\u8F7D\u540E\u5373\u53EF\u6D4F\u89C8\u5185\u5BB9" }), inspection && (_jsxs("div", { className: "mt-3 rounded-lg border border-[#2a2a2a] bg-bg-secondary p-3", children: [_jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "text-sm font-medium text-text-primary truncate", children: inspection.name }), _jsx("p", { className: "text-xs text-text-muted truncate mt-0.5", children: inspection.url })] }), _jsx("span", { className: "shrink-0 text-xs text-green-400", children: "\u53EF\u5BFC\u5165" })] }), _jsxs("div", { className: "grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3", children: [_jsxs("div", { className: "rounded-md bg-bg-tertiary px-3 py-2", children: [_jsx("p", { className: "text-[11px] text-text-muted", children: "\u70B9\u64AD\u7AD9\u70B9" }), _jsxs("p", { className: "text-sm text-text-primary mt-1", children: [inspection.visibleSiteCount, "/", inspection.siteCount] })] }), _jsxs("div", { className: "rounded-md bg-bg-tertiary px-3 py-2", children: [_jsx("p", { className: "text-[11px] text-text-muted", children: "\u53EF\u641C\u7D22" }), _jsx("p", { className: "text-sm text-text-primary mt-1", children: inspection.searchableSiteCount })] }), _jsxs("div", { className: "rounded-md bg-bg-tertiary px-3 py-2", children: [_jsx("p", { className: "text-[11px] text-text-muted", children: "\u76F4\u64AD\u6E90" }), _jsx("p", { className: "text-sm text-text-primary mt-1", children: inspection.liveCount })] }), _jsxs("div", { className: "rounded-md bg-bg-tertiary px-3 py-2", children: [_jsx("p", { className: "text-[11px] text-text-muted", children: "\u89E3\u6790\u5668" }), _jsx("p", { className: "text-sm text-text-primary mt-1", children: inspection.parseCount })] })] }), inspection.warnings.length > 0 && (_jsx("div", { className: "mt-3 space-y-1", children: inspection.warnings.map((warning) => (_jsxs("div", { className: "flex items-start gap-2 text-xs text-yellow-300", children: [_jsx(AlertCircle, { className: "w-3.5 h-3.5 shrink-0 mt-0.5" }), _jsx("span", { children: warning })] }, warning))) }))] }))] }), _jsxs("div", { children: [_jsx("h3", { className: "text-sm font-medium text-text-primary mb-3", children: "\u914D\u7F6E\u5217\u8868" }), configs.length === 0 ? (_jsxs("div", { className: "py-8 text-center", children: [_jsx(Link, { className: "w-10 h-10 text-text-muted mx-auto mb-3" }), _jsx("p", { className: "text-sm text-text-muted", children: "\u6682\u65E0\u914D\u7F6E" }), _jsx("p", { className: "text-xs text-text-muted mt-1", children: "\u5728\u4E0A\u65B9\u8F93\u5165\u914D\u7F6E\u5730\u5740\u6DFB\u52A0" })] })) : (_jsx("div", { className: "space-y-2", children: configs.map((config) => {
                                            const isActive = config.url === currentUrl;
                                            return (_jsxs("div", { className: `flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${isActive
                                                    ? 'border-accent/30 bg-accent-muted'
                                                    : 'border-[#2a2a2a] bg-bg-secondary hover:bg-bg-hover'}`, children: [_jsxs("div", { className: "flex-1 min-w-0", children: [editingConfigUrl === config.url ? (_jsx("input", { value: editingConfigName, onChange: (e) => setEditingConfigName(e.target.value), onKeyDown: (e) => {
                                                                    if (e.key === 'Enter')
                                                                        handleSaveRename(config.url);
                                                                    if (e.key === 'Escape')
                                                                        handleCancelRename();
                                                                }, className: "w-full px-2 py-1 bg-bg-tertiary rounded-md text-sm text-text-primary outline-none focus:ring-1 focus:ring-accent", autoFocus: true })) : (_jsx("p", { className: `text-sm truncate ${isActive ? 'text-accent' : 'text-text-primary'}`, children: config.name })), _jsx("p", { className: "text-xs text-text-muted truncate mt-0.5", children: config.url })] }), editingConfigUrl === config.url ? (_jsxs(_Fragment, { children: [_jsx("button", { onClick: () => handleSaveRename(config.url), className: "shrink-0 p-1.5 text-text-muted hover:text-green-400 transition-colors", title: "\u4FDD\u5B58\u540D\u79F0", children: _jsx(Save, { className: "w-4 h-4" }) }), _jsx("button", { onClick: handleCancelRename, className: "shrink-0 p-1.5 text-text-muted hover:text-red-400 transition-colors", title: "\u53D6\u6D88\u7F16\u8F91", children: _jsx(X, { className: "w-4 h-4" }) })] })) : (_jsx("button", { onClick: () => handleStartRename(config), className: "shrink-0 p-1.5 text-text-muted hover:text-accent transition-colors", title: "\u91CD\u547D\u540D", children: _jsx(Edit3, { className: "w-4 h-4" }) })), _jsx("button", { onClick: () => handleInspectSavedConfig(config), disabled: inspectLoading || loading, className: "shrink-0 p-1.5 text-text-muted hover:text-accent disabled:opacity-50 transition-colors", title: "\u91CD\u65B0\u9884\u68C0", children: _jsx(AlertCircle, { className: "w-4 h-4" }) }), !isActive && (_jsx("button", { onClick: () => handleSwitchConfig(config.url), className: "shrink-0 p-1.5 text-text-muted hover:text-accent transition-colors", title: "\u5207\u6362\u5230\u6B64\u914D\u7F6E", children: _jsx(RefreshCw, { className: "w-4 h-4" }) })), isActive && (_jsx("span", { className: "shrink-0 text-xs text-accent font-medium", children: "\u5F53\u524D" })), _jsx("button", { onClick: () => handleDeleteConfig(config), className: "shrink-0 p-1.5 text-text-muted hover:text-red-400 transition-colors", title: "\u5220\u9664", children: _jsx(Trash2, { className: "w-4 h-4" }) })] }, config.url));
                                        }) }))] })] })), activeTab === 'live' && (_jsxs("div", { className: "space-y-6 max-w-2xl", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-medium text-text-primary mb-3", children: "\u9891\u9053\u5237\u65B0" }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("button", { onClick: handleLiveRefresh, disabled: liveRefreshing, className: `flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${liveRefreshing
                                                    ? 'bg-accent-muted text-text-muted cursor-not-allowed'
                                                    : 'bg-accent text-white hover:bg-accent-hover'}`, children: [_jsx(RefreshCw, { className: `w-4 h-4 ${liveRefreshing ? 'animate-spin' : ''}` }), liveRefreshing ? '刷新中...' : '立即刷新'] }), _jsx("span", { className: "text-xs text-text-muted", children: "\u5237\u65B0\u5C06\u6D4B\u8BD5\u6240\u6709\u76F4\u64AD\u6E90\u7684 URL \u8FDE\u901A\u6027\uFF0C\u53BB\u91CD\u9009\u4F18\u540E\u6309 \u56FD\u5BB6-\u7C7B\u522B-\u9891\u9053 \u5206\u7C7B" })] }), liveRefreshing && liveRefreshProgress && (_jsxs("div", { className: "mt-3 space-y-1", children: [_jsxs("div", { className: "flex items-center justify-between text-xs text-text-muted", children: [_jsx("span", { children: liveRefreshProgress.message }), _jsxs("span", { children: [liveRefreshProgress.total > 0
                                                                ? Math.round((liveRefreshProgress.current / liveRefreshProgress.total) * 100)
                                                                : 0, "%"] })] }), _jsx("div", { className: "h-1.5 bg-bg-tertiary rounded-full overflow-hidden", children: _jsx("div", { className: "h-full bg-accent transition-all duration-300", style: {
                                                        width: `${liveRefreshProgress.total > 0
                                                            ? Math.round((liveRefreshProgress.current / liveRefreshProgress.total) * 100)
                                                            : 0}%`
                                                    } }) })] }))] }), _jsxs("div", { children: [_jsx("h3", { className: "text-sm font-medium text-text-primary mb-3", children: "\u81EA\u52A8\u5237\u65B0\u95F4\u9694" }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "number", value: liveRefreshInterval, onChange: (e) => setLiveRefreshInterval(parseInt(e.target.value) || 30), min: 1, max: 1440, className: "w-20 px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary text-center outline-none focus:ring-1 focus:ring-accent border border-[#2a2a2a]" }), _jsx("span", { className: "text-sm text-text-secondary", children: "\u5206\u949F" }), _jsx("button", { onClick: handleLiveIntervalSave, className: "px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors", children: "\u4FDD\u5B58" })] }), _jsx("p", { className: "text-xs text-text-muted mt-2", children: "\u540E\u53F0\u5C06\u81EA\u52A8\u5B9A\u65F6\u5237\u65B0\u76F4\u64AD\u6E90\uFF0C\u6D4B\u8BD5 URL \u8FDE\u901A\u6027\u5E76\u66F4\u65B0\u9891\u9053\u5217\u8868" })] }), _jsxs("div", { children: [_jsx("h3", { className: "text-sm font-medium text-text-primary mb-3", children: "\u5237\u65B0\u72B6\u6001" }), _jsxs("div", { className: "space-y-2 text-sm", children: [_jsxs("div", { className: "flex items-center justify-between py-2 px-3 bg-bg-secondary rounded-lg border border-[#2a2a2a]", children: [_jsx("span", { className: "text-text-secondary", children: "\u4E0A\u6B21\u5237\u65B0\u65F6\u95F4" }), _jsx("span", { className: "text-text-primary", children: liveStats?.lastRefreshTime
                                                            ? new Date(liveStats.lastRefreshTime * 1000).toLocaleString('zh-CN')
                                                            : '尚未刷新' })] }), _jsxs("div", { className: "flex items-center justify-between py-2 px-3 bg-bg-secondary rounded-lg border border-[#2a2a2a]", children: [_jsx("span", { className: "text-text-secondary", children: "\u5F53\u524D\u72B6\u6001" }), _jsx("span", { className: liveRefreshing ? 'text-accent' : 'text-green-400', children: liveRefreshing ? '刷新中' : '空闲' })] })] })] })] })), activeTab === 'network' && (_jsxs("div", { className: "space-y-6 max-w-2xl", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-medium text-text-primary mb-3", children: "DNS over HTTPS" }), _jsxs("select", { className: "w-full px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary outline-none", children: [_jsx("option", { value: "", children: "\u5173\u95ED" }), _jsx("option", { value: "https://dns.alidns.com/dns-query", children: "\u963F\u91CC DNS" }), _jsx("option", { value: "https://doh.pub/dns-query", children: "\u817E\u8BAF DNS" }), _jsx("option", { value: "https://dns.google/dns-query", children: "Google DNS" })] })] }), _jsxs("div", { children: [_jsx("h3", { className: "text-sm font-medium text-text-primary mb-3", children: "\u4EE3\u7406\u8BBE\u7F6E" }), _jsx("input", { type: "text", placeholder: "\u4EE3\u7406\u5730\u5740\uFF0C\u5982 http://127.0.0.1:7890", className: "w-full px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent" }), _jsx("p", { className: "text-xs text-text-muted mt-1.5", children: "\u652F\u6301 HTTP / HTTPS / SOCKS4 / SOCKS5 \u4EE3\u7406" })] }), _jsxs("div", { children: [_jsx("h3", { className: "text-sm font-medium text-text-primary mb-3", children: "Hosts \u8986\u76D6" }), _jsx("textarea", { placeholder: "\u6BCF\u884C\u4E00\u6761\uFF0C\u683C\u5F0F\uFF1A\u539F\u59CB\u57DF\u540D=\u76EE\u6807\u57DF\u540D\u6216IP\n\u4F8B\uFF1Aold.cdn.example.com=new.cdn.example.com", rows: 4, className: "w-full px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary placeholder:text-text-muted outline-none focus:ring-1 focus:ring-accent resize-none" })] }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-medium text-text-primary", children: "\u5E7F\u544A\u62E6\u622A" }), _jsx("p", { className: "text-xs text-text-muted mt-0.5", children: "\u62E6\u622A\u914D\u7F6E\u4E2D ads \u57DF\u540D\u5217\u8868\u7684\u8BF7\u6C42" })] }), _jsx("button", { className: "w-10 h-6 rounded-full bg-bg-tertiary relative transition-colors", children: _jsx("div", { className: "w-4 h-4 rounded-full bg-text-muted absolute top-1 left-1 transition-all" }) })] })] })), activeTab === 'player' && (_jsxs("div", { className: "space-y-6 max-w-2xl", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-medium text-text-primary mb-3", children: "\u9ED8\u8BA4\u89E3\u6790\u5668" }), _jsx("select", { className: "w-full px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary outline-none", children: _jsx("option", { value: "", children: "\u7CFB\u7EDF\u9ED8\u8BA4" }) })] }), _jsxs("div", { children: [_jsx("h3", { className: "text-sm font-medium text-text-primary mb-3", children: "\u9ED8\u8BA4\u500D\u901F" }), _jsxs("select", { className: "w-full px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary outline-none", children: [_jsx("option", { value: "0.5", children: "0.5x" }), _jsx("option", { value: "0.75", children: "0.75x" }), _jsx("option", { value: "1", children: "1x\uFF08\u9ED8\u8BA4\uFF09" }), _jsx("option", { value: "1.25", children: "1.25x" }), _jsx("option", { value: "1.5", children: "1.5x" }), _jsx("option", { value: "2", children: "2x" })] })] }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-medium text-text-primary", children: "\u5F39\u5E55\u9ED8\u8BA4\u5F00\u542F" }), _jsx("p", { className: "text-xs text-text-muted mt-0.5", children: "\u64AD\u653E\u65F6\u81EA\u52A8\u663E\u793A\u5F39\u5E55" })] }), _jsx("button", { className: "w-10 h-6 rounded-full bg-accent relative", children: _jsx("div", { className: "w-4 h-4 rounded-full bg-white absolute top-1 right-1 transition-all" }) })] }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-medium text-text-primary", children: "\u786C\u4EF6\u52A0\u901F" }), _jsx("p", { className: "text-xs text-text-muted mt-0.5", children: "\u4F7F\u7528 GPU \u52A0\u901F\u89C6\u9891\u89E3\u7801" })] }), _jsx("button", { className: "w-10 h-6 rounded-full bg-accent relative", children: _jsx("div", { className: "w-4 h-4 rounded-full bg-white absolute top-1 right-1 transition-all" }) })] })] })), activeTab === 'about' && (_jsxs("div", { className: "space-y-6 max-w-2xl", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("div", { className: "w-14 h-14 rounded-2xl bg-accent flex items-center justify-center", children: _jsx(Monitor, { className: "w-8 h-8 text-bg-primary" }) }), _jsxs("div", { children: [_jsx("h3", { className: "text-lg font-semibold text-text-primary", children: "IPTV Mac" }), _jsxs("p", { className: "text-sm text-text-muted", children: ["\u7248\u672C ", version] })] })] }), _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex items-center justify-between py-2", children: [_jsx("span", { className: "text-sm text-text-secondary", children: "\u5F53\u524D\u7248\u672C" }), _jsx("span", { className: "text-sm text-text-primary", children: version })] }), _jsxs("button", { className: "flex items-center justify-between w-full py-2 group", children: [_jsx("span", { className: "text-sm text-text-secondary", children: "\u68C0\u67E5\u66F4\u65B0" }), _jsx(ChevronRight, { className: "w-4 h-4 text-text-muted group-hover:text-accent transition-colors" })] }), _jsxs("div", { className: "flex items-center justify-between py-2", children: [_jsx("span", { className: "text-sm text-text-secondary", children: "\u57FA\u4E8E" }), _jsx("span", { className: "text-sm text-accent", children: "FongMi/TV" })] }), _jsxs("div", { className: "flex items-center justify-between py-2", children: [_jsx("span", { className: "text-sm text-text-secondary", children: "\u672C\u5730\u670D\u52A1" }), _jsx("span", { className: "text-sm text-text-primary", children: localServer.url || '未启动' })] }), _jsxs("div", { className: "flex items-start justify-between gap-6 py-2", children: [_jsx("span", { className: "text-sm text-text-secondary", children: "API Token" }), _jsx("span", { className: "text-xs text-text-primary font-mono break-all text-right", children: localServer.token })] })] })] }))] })] }));
}
