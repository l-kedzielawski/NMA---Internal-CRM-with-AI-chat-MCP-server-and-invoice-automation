import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode | {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ 
  icon: Icon, 
  title, 
  description, 
  action, 
  secondaryAction 
}: EmptyStateProps) {
  return (
    <div className="empty-state">
      {Icon && (
        <Icon size={48} className="empty-state-icon" />
      )}
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      {description && (
        <p className="text-text-muted mb-4 max-w-md mx-auto">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="flex gap-3 justify-center">
          {action && (
            typeof action === 'object' && 'label' in action ? (
              <button onClick={action.onClick} className="btn btn-primary">
                {action.label}
              </button>
            ) : action
          )}
          {secondaryAction && (
            <button onClick={secondaryAction.onClick} className="btn btn-secondary">
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
