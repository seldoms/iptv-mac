import type { ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';
interface EmptyStateProps {
    icon: ComponentType<LucideProps>;
    title: string;
    description: string;
    primaryLabel?: string;
    onPrimaryClick?: () => void;
    secondaryLabel?: string;
    onSecondaryClick?: () => void;
}
export default function EmptyState({ icon: Icon, title, description, primaryLabel, onPrimaryClick, secondaryLabel, onSecondaryClick }: EmptyStateProps): import("react").JSX.Element;
export {};
