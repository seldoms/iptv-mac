interface LiveRefreshBarProps {
    isRefreshing: boolean;
    refreshProgress: {
        phase: string;
        current: number;
        total: number;
        message: string;
    } | null;
    lastRefreshTime: number;
    refreshInterval: number;
    onRefresh: () => void;
    onSettings: () => void;
}
export default function LiveRefreshBar({ isRefreshing, refreshProgress, lastRefreshTime, refreshInterval, onRefresh, onSettings }: LiveRefreshBarProps): import("react").JSX.Element;
export {};
