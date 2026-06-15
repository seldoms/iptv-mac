import { Vod } from '@/stores/useConfigStore';
interface VodCardProps {
    vod: Vod;
    onClick: (vod: Vod) => void;
    loading?: boolean;
    sourceName?: string;
}
export default function VodCard({ vod, onClick, loading, sourceName }: VodCardProps): import("react").JSX.Element;
export {};
