import { Channel } from '@/stores/useLiveStore';
interface ChannelItemProps {
    channel: Channel;
    isActive: boolean;
    onClick: (channel: Channel) => void;
}
export default function ChannelItem({ channel, isActive, onClick }: ChannelItemProps): import("react").JSX.Element;
export {};
