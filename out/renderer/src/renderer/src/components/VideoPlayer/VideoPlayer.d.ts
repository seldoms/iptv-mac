declare global {
    interface Window {
        __alphaPlaybackDebug?: {
            protocol?: string;
            url?: string;
            events: Array<Record<string, unknown>>;
        };
    }
}
export default function VideoPlayer(): import("react").JSX.Element;
