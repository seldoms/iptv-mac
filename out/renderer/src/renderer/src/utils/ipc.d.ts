import type { EpgProgram } from '@shared/types';
export type IpcChannel = 'config:load' | 'config:getCurrent' | 'config:getCurrentUrl' | 'config:inspect' | 'config:list' | 'config:remove' | 'config:rename' | 'config:peekLives' | 'site:probe' | 'site:homeContent' | 'site:categoryContent' | 'site:detailContent' | 'site:searchContent' | 'site:findAcrossSites' | 'site:playerContent' | 'site:superParse' | 'live:load' | 'live:loadByUrl' | 'live:epg' | 'live:refresh' | 'live:getRefreshStatus' | 'live:setRefreshInterval' | 'live:getChannelTree' | 'history:add' | 'history:list' | 'history:delete' | 'keep:add' | 'keep:list' | 'keep:delete' | 'cache:get' | 'cache:set' | 'cache:del' | 'dlna:search' | 'dlna:cast' | 'dlna:control' | 'settings:get' | 'settings:set' | 'local:getServerInfo' | 'window:savePlayerState' | 'window:getPlayerState' | 'window:enterMiniMode' | 'window:exitMiniMode';
/**
 * IPC 方法参数类型映射
 */
interface IpcArgsMap {
    'config:load': [url: string];
    'config:getCurrent': [];
    'config:getCurrentUrl': [];
    'config:inspect': [url: string];
    'config:list': [];
    'config:remove': [url: string];
    'config:rename': [url: string, name: string];
    'config:peekLives': [url: string];
    'site:probe': [siteKeys: string[]];
    'site:homeContent': [siteKey: string, filter: boolean];
    'site:categoryContent': [siteKey: string, tid: string, pg: string, filter: boolean, extend: Record<string, string>];
    'site:detailContent': [siteKey: string, ids: string[]];
    'site:searchContent': [siteKey: string, key: string, quick: boolean, pg?: string];
    'site:findAcrossSites': [
        keyword: string,
        options?: {
            excludeSiteKey?: string;
            excludeVodId?: string;
            limit?: number;
            timeoutMs?: number;
        }
    ];
    'site:playerContent': [siteKey: string, flag: string, id: string, vipFlags: string[]];
    'site:superParse': [
        params: {
            url: string;
            flag: string;
            siteKey: string;
            playerResult?: {
                url: string;
                parse?: number;
                header?: Record<string, string>;
                playUrl?: string;
                click?: string;
            };
        }
    ];
    'live:load': [liveName: string];
    'live:loadByUrl': [url: string, name?: string];
    'live:epg': [epgUrl: string, channelMap?: Record<string, {
        id?: string;
        name: string;
    }>];
    'live:refresh': [];
    'live:getRefreshStatus': [];
    'live:setRefreshInterval': [minutes: number];
    'live:getChannelTree': [];
    'history:add': [item: import('@shared/types').History];
    'history:list': [];
    'history:delete': [siteKey: string, vodId: string];
    'keep:add': [item: import('@shared/types').Keep];
    'keep:list': [];
    'keep:delete': [siteKey: string, vodId: string];
    'cache:get': [key: string, rule?: string];
    'cache:set': [key: string, value: string, rule?: string];
    'cache:del': [key: string, rule?: string];
    'dlna:search': [];
    'dlna:cast': [deviceUrl: string, mediaUrl: string];
    'dlna:control': [deviceUrl: string, action: 'play' | 'pause' | 'stop' | 'seek', value?: number];
    'settings:get': [key: string];
    'settings:set': [key: string, value: any];
    'local:getServerInfo': [];
    'window:savePlayerState': [state: {
        url: string;
        header?: Record<string, string>;
        currentTime?: number;
    }];
    'window:getPlayerState': [];
    'window:enterMiniMode': [];
    'window:exitMiniMode': [];
}
/**
 * 类型安全的 invoke 函数
 */
export declare function isTauriRuntime(): boolean;
export declare function invoke<T extends keyof IpcArgsMap>(channel: T, ...args: IpcArgsMap[T]): Promise<any>;
export declare function on(channel: string, callback: (...args: unknown[]) => void): () => void;
/**
 * 配置管理
 */
export declare const configApi: {
    load: (url: string) => Promise<any>;
    getCurrent: () => Promise<any>;
    getCurrentUrl: () => Promise<any>;
    inspect: (url: string) => Promise<any>;
    list: () => Promise<any>;
    remove: (url: string) => Promise<any>;
    rename: (url: string, name: string) => Promise<any>;
    peekLives: (url: string) => Promise<any>;
};
/**
 * 站点操作
 */
export declare const siteApi: {
    probe: (siteKeys: string[]) => Promise<any>;
    homeContent: (siteKey: string, filter: boolean) => Promise<any>;
    categoryContent: (siteKey: string, tid: string, pg: string, filter: boolean, extend: Record<string, string>) => Promise<any>;
    detailContent: (siteKey: string, ids: string[]) => Promise<any>;
    searchContent: (siteKey: string, key: string, quick: boolean, pg?: string) => Promise<any>;
    findAcrossSites: (keyword: string, options?: {
        excludeSiteKey?: string;
        excludeVodId?: string;
        limit?: number;
        timeoutMs?: number;
    }) => Promise<any>;
    playerContent: (siteKey: string, flag: string, id: string, vipFlags: string[]) => Promise<any>;
    superParse: (params: {
        url: string;
        flag: string;
        siteKey: string;
        playerResult?: {
            url: string;
            parse?: number;
            header?: Record<string, string>;
            playUrl?: string;
            click?: string;
        };
    }) => Promise<any>;
};
/**
 * 直播操作
 */
export declare const liveApi: {
    load: (liveName: string) => Promise<any>;
    loadByUrl: (url: string, name?: string) => Promise<any>;
    epg: (epgUrl: string, channelMap?: Record<string, {
        id?: string;
        name: string;
    }>) => Promise<{
        success: boolean;
        data?: EpgProgram[];
        error?: string;
    }>;
    refresh: () => Promise<any>;
    getRefreshStatus: () => Promise<any>;
    setRefreshInterval: (minutes: number) => Promise<any>;
    getChannelTree: () => Promise<any>;
};
/**
 * 历史记录
 */
export declare const historyApi: {
    add: (item: import("@shared/types").History) => Promise<any>;
    list: () => Promise<any>;
    delete: (siteKey: string, vodId: string) => Promise<any>;
};
/**
 * 收藏
 */
export declare const keepApi: {
    add: (item: import("@shared/types").Keep) => Promise<any>;
    list: () => Promise<any>;
    delete: (siteKey: string, vodId: string) => Promise<any>;
};
/**
 * 缓存
 */
export declare const cacheApi: {
    get: (key: string, rule?: string) => Promise<any>;
    set: (key: string, value: string, rule?: string) => Promise<any>;
    del: (key: string, rule?: string) => Promise<any>;
};
/**
 * DLNA
 */
export declare const dlnaApi: {
    search: () => Promise<any>;
    cast: (deviceUrl: string, mediaUrl: string) => Promise<any>;
    control: (deviceUrl: string, action: "play" | "pause" | "stop" | "seek", value?: number) => Promise<any>;
};
/**
 * 设置
 */
export declare const settingsApi: {
    get: (key: string) => Promise<any>;
    set: (key: string, value: any) => Promise<any>;
};
export declare const localApi: {
    getServerInfo: () => Promise<any>;
};
/**
 * 窗口控制
 */
export declare const windowApi: {
    savePlayerState: (state: {
        url: string;
        header?: Record<string, string>;
        currentTime?: number;
    }) => Promise<any>;
    getPlayerState: () => Promise<any>;
    enterMiniMode: () => Promise<any>;
    exitMiniMode: () => Promise<any>;
};
export {};
