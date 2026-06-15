interface DanmakuLayerProps {
    opacity?: number;
    speed?: number;
    fontSize?: number;
}
export default function DanmakuLayer({ opacity, speed, fontSize }: DanmakuLayerProps): import("react").JSX.Element;
/**
 * 发送弹幕的辅助函数
 */
export declare function sendDanmaku(text: string, color?: string): void;
export {};
