export interface Site {
    key: string;
    name: string;
    type: number;
    api: string;
    ext?: string;
    jar?: string;
    hide?: number;
    searchable: number;
    changeable: number;
}
export interface Vod {
    vod_id: string;
    vod_name: string;
    vod_pic: string;
    vod_remarks: string;
    type_name?: string;
    vod_play_from?: string;
    vod_play_url?: string;
}
export interface Category {
    type_id: string;
    type_name: string;
    parent_id?: string;
}
export interface Filter {
    key: string;
    name: string;
    init?: string;
    value: {
        n: string;
        v: string;
    }[];
}
export interface VodConfig {
    spider: string;
    wallpaper?: string;
    logo?: string;
    notice?: string;
    sites: Site[];
    lives?: {
        name: string;
        url: string;
        epg?: string;
        ua?: string;
    }[];
    parses?: {
        name: string;
        url: string;
        type?: number;
    }[];
}
interface ConfigState {
    currentConfig: VodConfig | null;
    sites: Site[];
    currentSiteKey: string;
    categories: Category[];
    filters: Record<string, Filter[]>;
    homeVideos: Vod[];
    categoryVideos: Vod[];
    currentPage: number;
    hasMore: boolean;
    isLoading: boolean;
    error: string | null;
    liveConfig: VodConfig | null;
}
interface ConfigActions {
    loadConfig: (url: string) => Promise<void>;
    switchSite: (siteKey: string) => Promise<void>;
    fetchHomeContent: () => Promise<boolean>;
    fetchCategoryContent: (tid: string, pg: number, extend?: Record<string, string>) => Promise<void>;
    setCurrentSiteKey: (key: string) => void;
    setCategories: (cats: Category[]) => void;
    setFilters: (filters: Record<string, Filter[]>) => void;
    reset: () => void;
}
export declare const useConfigStore: import("zustand").UseBoundStore<import("zustand").StoreApi<ConfigState & ConfigActions>>;
export {};
