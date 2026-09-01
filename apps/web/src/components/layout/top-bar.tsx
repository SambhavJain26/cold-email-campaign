import type { RefObject } from 'react';
import { LogOut, Menu } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useMe } from '@/api/queries/auth';
import { useLogout } from '@/api/mutations/auth';
import { AlertsBell } from './alerts-bell';
import { CampaignSelector } from './campaign-selector';
import { TransportChip } from './transport-chip';

export function TopBar({
  onOpenNavigation,
  navigationTriggerRef,
}: {
  onOpenNavigation?: () => void;
  navigationTriggerRef?: RefObject<HTMLButtonElement>;
}) {
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const showCampaignSelector = location.pathname.startsWith('/overview');

  return (
    <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-3 sm:gap-3 sm:px-4 md:min-h-12">
      <Button
        ref={navigationTriggerRef}
        variant="ghost"
        size="icon"
        className="min-h-11 min-w-11 md:hidden"
        aria-label="Open navigation"
        aria-haspopup="dialog"
        onClick={onOpenNavigation}
      >
        <Menu className="size-5" />
      </Button>
      {showCampaignSelector && <CampaignSelector />}
      <div className="ml-auto flex items-center gap-2">
        <div className="hidden md:block">
          <TransportChip />
        </div>
        <AlertsBell />
        <Separator orientation="vertical" className="hidden h-6 sm:block" />
        <span className="hidden text-xs text-muted-foreground sm:inline">{me?.email}</span>
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11 md:min-h-9 md:min-w-9"
          aria-label="Sign out"
          disabled={logout.isPending}
          onClick={() =>
            logout.mutate(undefined, { onSuccess: () => navigate('/login', { replace: true }) })
          }
        >
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  );
}
