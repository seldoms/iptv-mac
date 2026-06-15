interface SubtitleLayerProps {
    currentTime?: number;
}
export default function SubtitleLayer({ currentTime }: SubtitleLayerProps): import("react").JSX.Element | null;
/**
 * 加载字幕的辅助函数
 */
export declare function loadSubtitleTrack(url: string, label: string, language?: string): void;
export {};
