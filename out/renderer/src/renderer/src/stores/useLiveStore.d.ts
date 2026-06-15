export interface Channel {
    name: string;
    number?: string;
    logo?: string;
    format?: string;
    urls: string[];
    epgId?: string;
    urlHeaders?: Record<string, Record<string, string>>;
    epgUrl?: string;
    bestUrl?: string;
    latency?: number;
}
export interface Group {
    name: string;
    pass?: string;
    channels: Channel[];
}
export interface EpgData {
    title: string;
    start: string;
    end: string;
    desc?: string;
}
interface LiveState {
    groups: Group[];
    channels: Channel[];
    currentGroup: string;
    currentChannel: Channel | null;
    epgData: EpgData[];
    isPlaying: boolean;
    isLoading: boolean;
    error: string | null;
}
interface LiveActions {
    loadLive: (liveName: string) => Promise<void>;
    loadLiveByUrl: (url: string, name?: string) => Promise<void>;
    switchGroup: (groupName: string) => void;
    switchChannel: (channel: Channel) => void;
    fetchEpg: (epgUrl: string, channelId: string) => Promise<void>;
    setIsPlaying: (playing: boolean) => void;
    reset: () => void;
}
interface RefreshState {
    isRefreshing: boolean;
    refreshProgress: {
        phase: string;
        current: number;
        total: number;
        message: string;
    } | null;
    lastRefreshTime: number;
    nextRefreshTime: number;
    refreshInterval: number;
}
interface RefreshActions {
    triggerRefresh: () => Promise<void>;
    setRefreshInterval: (minutes: number) => Promise<void>;
    getRefreshStatus: () => Promise<void>;
    getChannelTree: () => Promise<any>;
    applyRefreshProgress: (progress: NonNullable<RefreshState['refreshProgress']>) => void;
}
export declare function normalizeLiveGroups(rawGroups: any[]): Group[];
export declare const useLiveStore: import("zustand").UseBoundStore<import("zustand").StoreApi<LiveState & LiveActions & RefreshState & RefreshActions>>;
export {};
