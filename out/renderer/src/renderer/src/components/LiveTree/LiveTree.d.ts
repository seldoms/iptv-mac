interface Channel {
    name: string;
    urls: string[];
    bestUrl: string;
    latency: number;
    country: string;
    category: string;
    sortOrder: number;
}
interface CategoryNode {
    name: string;
    channels: Channel[];
}
interface CountryNode {
    name: string;
    categories: CategoryNode[];
}
interface LiveTreeProps {
    tree: {
        countries: CountryNode[];
    };
    onChannelClick: (channel: Channel) => void;
    currentChannelName?: string;
}
declare function LiveTree({ tree, onChannelClick, currentChannelName }: LiveTreeProps): import("react").JSX.Element;
declare const _default: import("react").MemoExoticComponent<typeof LiveTree>;
export default _default;
