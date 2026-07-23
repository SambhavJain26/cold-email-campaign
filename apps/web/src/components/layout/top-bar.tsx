import { LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useMe } from '@/api/queries/auth';
import { useLogout } from '@/api/mutations/auth';
import { AlertsBell } from './alerts-bell';
import { CampaignSelector } from './campaign-selector';
import { TransportChip } from './transport-chip';

export function TopBar() {
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  return (
    <header className="flex h-12 items-center gap-3 border-b border-border bg-card px-4">
      <CampaignSelector />
      <div className="ml-auto flex items-center gap-2">
        <TransportChip />
        <AlertsBell />
        <Separator orientation="vertical" className="h-6" />
        <span className="hidden text-xs text-muted-foreground sm:inline">{me?.email}</span>
        <Button
          variant="ghost"
          size="icon"
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
