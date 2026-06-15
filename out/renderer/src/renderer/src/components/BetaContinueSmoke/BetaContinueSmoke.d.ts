export interface BetaContinueSmokeConfig {
    enabled: boolean;
    phase: 'seed' | 'validate';
    positionSeconds?: number;
    toleranceSeconds?: number;
}
export default function BetaContinueSmoke({ config }: {
    config: BetaContinueSmokeConfig;
}): import("react").JSX.Element;
