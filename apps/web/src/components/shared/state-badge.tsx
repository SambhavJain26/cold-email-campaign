import type { EnrollmentState } from '@coldemail/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** State accents per docs/11 §5: green ok/positive, amber warning, red failed, blue info. */
const STYLE: Record<EnrollmentState, string> = {
  STOPPED: 'border-transparent bg-muted text-muted-foreground',
  NEW: 'border-border bg-transparent text-muted-foreground',
  ACTIVE: 'border-transparent bg-info/15 text-info',
  REPLIED: 'border-transparent bg-success/15 text-success',
  BOUNCED: 'border-transparent bg-destructive/15 text-destructive',
  UNSUBSCRIBED: 'border-transparent bg-warning/15 text-warning',
  COMPLETED: 'border-transparent bg-muted text-muted-foreground',
};

export function StateBadge({ state, className }: { state: EnrollmentState; className?: string }) {
  return (
    <Badge variant="outline" className={cn('font-mono text-[11px]', STYLE[state], className)}>
      {state}
    </Badge>
  );
}
