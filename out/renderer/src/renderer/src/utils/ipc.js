import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
/**
 * 类型安全的 invoke 函数
 */
export function isTauriRuntime() {
    return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}
function webFallback(channel) {
    switch (channel) {
        case 'config:getCurrentUrl':
            return '';
        case 'config:getCurrent':
            return null;
        case 'config:list':
        case 'history:list':
        case 'keep:list':
            return [];
        case 'settings:get':
        case 'window:getPlayerState':
        case 'local:getServerInfo':
            return null;
        case 'live:getRefreshStatus':
            return { running: false, nextRun: null, intervalMinutes: 0 };
        case 'live:getChannelTree':
            return { success: true, data: [] };
        default:
            return { success: false, error: '此功能需要在桌面应用中使用' };
    }
}
export function invoke(channel, ...args) {
    if (!isTauriRuntime()) {
        return Promise.resolve(webFallback(channel));
    }
    return tauriInvoke('invoke_ipc', { channel, args });
}
export function on(channel, callback) {
    if (!isTauriRuntime()) {
        return () => { };
    }
    let disposed = false;
    let unlisten;
    void listen(channel, (event) => {
        const payload = Array.isArray(event.payload) ? event.payload : [event.payload];
        callback(...payload);
    }).then((stop) => {
        if (disposed)
            stop();
        else
            unlisten = stop;
    });
    return () => {
        disposed = true;
        unlisten?.();
    };
}
/**
 * 配置管理
 */
export const configApi = {
    load: (url) => invoke('config:load', url),
    getCurrent: () => invoke('config:getCurrent'),
    getCurrentUrl: () => invoke('config:getCurrentUrl'),
    inspect: (url) => invoke('config:inspect', url),
    list: () => invoke('config:list'),
    remove: (url) => invoke('config:remove', url),
    rename: (url, name) => invoke('config:rename', url, name),
    peekLives: (url) => invoke('config:peekLives', url)
};
/**
 * 站点操作
 */
export const siteApi = {
    probe: (siteKeys) => invoke('site:probe', siteKeys),
    homeContent: (siteKey, filter) => invoke('site:homeContent', siteKey, filter),
    categoryContent: (siteKey, tid, pg, filter, extend) => invoke('site:categoryContent', siteKey, tid, pg, filter, extend),
    detailContent: (siteKey, ids) => invoke('site:detailContent', siteKey, ids),
    searchContent: (siteKey, key, quick, pg) => invoke('site:searchContent', siteKey, key, quick, pg),
    findAcrossSites: (keyword, options) => invoke('site:findAcrossSites', keyword, options),
    playerContent: (siteKey, flag, id, vipFlags) => invoke('site:playerContent', siteKey, flag, id, vipFlags),
    superParse: (params) => invoke('site:superParse', params)
};
/**
 * 直播操作
 */
export const liveApi = {
    load: (liveName) => invoke('live:load', liveName),
    loadByUrl: (url, name) => invoke('live:loadByUrl', url, name),
    epg: (epgUrl, channelMap) => invoke('live:epg', epgUrl, channelMap),
    refresh: () => invoke('live:refresh'),
    getRefreshStatus: () => invoke('live:getRefreshStatus'),
    setRefreshInterval: (minutes) => invoke('live:setRefreshInterval', minutes),
    getChannelTree: () => invoke('live:getChannelTree')
};
/**
 * 历史记录
 */
export const historyApi = {
    add: (item) => invoke('history:add', item),
    list: () => invoke('history:list'),
    delete: (siteKey, vodId) => invoke('history:delete', siteKey, vodId)
};
/**
 * 收藏
 */
export const keepApi = {
    add: (item) => invoke('keep:add', item),
    list: () => invoke('keep:list'),
    delete: (siteKey, vodId) => invoke('keep:delete', siteKey, vodId)
};
/**
 * 缓存
 */
export const cacheApi = {
    get: (key, rule) => invoke('cache:get', key, rule),
    set: (key, value, rule) => invoke('cache:set', key, value, rule),
    del: (key, rule) => invoke('cache:del', key, rule)
};
/**
 * DLNA
 */
export const dlnaApi = {
    search: () => invoke('dlna:search'),
    cast: (deviceUrl, mediaUrl) => invoke('dlna:cast', deviceUrl, mediaUrl),
    control: (deviceUrl, action, value) => invoke('dlna:control', deviceUrl, action, value)
};
/**
 * 设置
 */
export const settingsApi = {
    get: (key) => invoke('settings:get', key),
    set: (key, value) => invoke('settings:set', key, value)
};
export const localApi = {
    getServerInfo: () => invoke('local:getServerInfo')
};
/**
 * 窗口控制
 */
export const windowApi = {
    savePlayerState: (state) => invoke('window:savePlayerState', state),
    getPlayerState: () => invoke('window:getPlayerState'),
    enterMiniMode: () => invoke('window:enterMiniMode'),
    exitMiniMode: () => invoke('window:exitMiniMode')
};
