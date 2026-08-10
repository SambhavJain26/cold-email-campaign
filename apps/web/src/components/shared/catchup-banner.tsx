import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAlerts } from '@/api/queries/alerts';
import { useAckAlert } from '@/api/mutations/alerts';

/** An overdue-work notice. The payload reports only facts the scheduler knows. */
export function CatchupBanner() {
  const { data } = useAlerts(true);
  const ack = useAckAlert();
  const alert = data?.items.find((item) => item.kind === 'catchup_backlog');
  if (!alert) return null;

  const payload = alert.payload as { overdue?: number; remainingBudgetToday?: number };
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4"
      data-testid="catchup-banner"
      role="status"
    >
      <Clock className="mt-0.5 size-4 text-warning" aria-hidden />
      <div className="flex-1 space-y-1">
        <p className="text-sm font-medium">Overdue work is pacing normally</p>
        <p className="text-xs text-muted-foreground">
          {payload.overdue ?? '?'} sends are overdue; {payload.remainingBudgetToday ?? '?'} mailbox
          slots remain today. Work stays queued behind normal pacing, and the scheduler never bursts
          a backlog.
        </p>
      </div>
      <Button
        variant="outline"
        size="xs"
        disabled={ack.isPending}
        onClick={() => ack.mutate(alert.id)}
      >
        Acknowledge
      </Button>
    </div>
  );
}
