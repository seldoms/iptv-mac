export interface AlphaPlaybackSmokeConfig {
    enabled: boolean;
    mediaUrl?: string;
    timeoutMs?: number;
}
export default function AlphaPlaybackSmoke({ config }: {
    config: AlphaPlaybackSmokeConfig;
}): import("react").JSX.Element;
