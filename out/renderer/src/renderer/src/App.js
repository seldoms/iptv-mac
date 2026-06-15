import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './components/Sidebar/Sidebar';
import MiniPlayer from './components/MiniPlayer/MiniPlayer';
import Home from './pages/Home/Home';
import VodDetail from './pages/VodDetail/VodDetail';
import Live from './pages/Live/Live';
import Search from './pages/Search/Search';
import History from './pages/History/History';
import Keep from './pages/Keep/Keep';
import Settings from './pages/Settings/Settings';
import Onboarding from './pages/Onboarding/Onboarding';
import AlphaPlaybackSmoke from './components/AlphaPlaybackSmoke/AlphaPlaybackSmoke';
import BetaContinueSmoke from './components/BetaContinueSmoke/BetaContinueSmoke';
import { useConfigStore } from './stores/useConfigStore';
import { configApi, settingsApi } from './utils/ipc';
/** 检测是否为精简模式 */
function isMiniMode() {
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'mini';
}
export default function App() {
    const { loadConfig } = useConfigStore();
    const navigate = useNavigate();
    const location = useLocation();
    const didAutoLoad = useRef(false);
    const [smokeConfig, setSmokeConfig] = useState(null);
    const [betaContinueSmokeConfig, setBetaContinueSmokeConfig] = useState(null);
    // 精简模式：只渲染 MiniPlayer
    if (isMiniMode()) {
        return _jsx(MiniPlayer, {});
    }
    // 启动时自动加载上次使用的配置
    useEffect(() => {
        if (didAutoLoad.current)
            return;
        didAutoLoad.current = true;
        console.log('[App] useEffect 启动, 开始自动加载配置');
        const autoLoad = async () => {
            try {
                const url = await configApi.getCurrentUrl();
                console.log('[App] getCurrentUrl:', url);
                if (!url) {
                    console.log('[App] 未找到已保存配置，等待用户导入');
                    if (location.pathname === '/') {
                        navigate('/onboarding', { replace: true });
                    }
                    return;
                }
                await loadConfig(url);
                console.log('[App] loadConfig 完成');
            }
            catch (err) {
                console.error('[App] 自动加载配置失败:', err);
            }
        };
        autoLoad();
    }, [loadConfig, location.pathname, navigate]);
    useEffect(() => {
        let cancelled = false;
        const loadSmokeConfig = async () => {
            const value = await settingsApi.get('__alphaPlaybackSmoke');
            if (!cancelled && value?.enabled) {
                setSmokeConfig(value);
            }
            const betaValue = await settingsApi.get('__betaContinueSmoke');
            if (!cancelled && betaValue?.enabled) {
                setBetaContinueSmokeConfig(betaValue);
            }
        };
        void loadSmokeConfig();
        return () => {
            cancelled = true;
        };
    }, []);
    if (smokeConfig?.enabled) {
        return _jsx(AlphaPlaybackSmoke, { config: smokeConfig });
    }
    if (betaContinueSmokeConfig?.enabled) {
        return _jsx(BetaContinueSmoke, { config: betaContinueSmokeConfig });
    }
    return (_jsxs("div", { className: "flex h-screen w-screen overflow-hidden bg-bg-primary", children: [_jsx(Sidebar, {}), _jsxs("main", { className: "flex-1 flex flex-col overflow-hidden", children: [_jsx("div", { className: "shrink-0 h-8 flex items-center px-4 bg-bg-secondary border-b border-[#2a2a2a]", style: { WebkitAppRegion: 'drag' }, children: _jsx("span", { className: "text-[10px] text-text-muted select-none", children: "IPTV" }) }), _jsx("div", { className: "flex-1 overflow-hidden", children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Home, {}) }), _jsx(Route, { path: "/vod/:siteKey/:vodId", element: _jsx(VodDetail, {}) }), _jsx(Route, { path: "/live", element: _jsx(Live, {}) }), _jsx(Route, { path: "/search", element: _jsx(Search, {}) }), _jsx(Route, { path: "/history", element: _jsx(History, {}) }), _jsx(Route, { path: "/keep", element: _jsx(Keep, {}) }), _jsx(Route, { path: "/settings", element: _jsx(Settings, {}) }), _jsx(Route, { path: "/onboarding", element: _jsx(Onboarding, {}) })] }) })] })] }));
}
