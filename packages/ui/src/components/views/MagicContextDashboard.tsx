import React from 'react';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/useUIStore';
import { MagicContextPage } from '@/components/sections/magic-context/MagicContextPage';

export const MagicContextDashboard: React.FC = () => {
  const open = useUIStore((state) => state.isMagicContextDashboardOpen);
  const setOpen = useUIStore((state) => state.setMagicContextDashboardOpen);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen]);

  if (!open) {
    return null;
  }
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-background">
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <MagicContextPage />
        </div>
        <div className="absolute top-3 right-3">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Close Magic Context"
            onClick={() => setOpen(false)}
          >
            ×
          </Button>
        </div>
      </div>
    </div>
  );
};
