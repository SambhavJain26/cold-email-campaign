import type { CampaignStatus } from '@coldemail/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const ACCENT: Record<CampaignStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  active: 'bg-success/15 text-success',
  paused: 'bg-warning/15 text-warning',
  completed: 'bg-info/15 text-info',
  archived: 'bg-muted text-muted-foreground',
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <Badge variant="outline" className={cn('border-transparent', ACCENT[status])}>
      {status}
    </Badge>
  );
}
