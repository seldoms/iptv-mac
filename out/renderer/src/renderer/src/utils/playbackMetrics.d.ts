export interface PlaybackMetricSample {
    type: 'first_frame' | 'failure';
    at: number;
    elapsedMs?: number;
    phase?: string;
    errorKind?: string;
    stage?: string;
    protocol?: string;
    sourceId?: string;
}
export interface PlaybackMetricSummary {
    totalFirstFrameSamples: number;
    p50FirstFrameMs: number | null;
    p90FirstFrameMs: number | null;
    totalFailures: number;
}
export declare function recordPlaybackMetric(sample: PlaybackMetricSample): void;
export declare function getPlaybackMetricSummary(): PlaybackMetricSummary;
export declare function clearPlaybackMetrics(): void;
