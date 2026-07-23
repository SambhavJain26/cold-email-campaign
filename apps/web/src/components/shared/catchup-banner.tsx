import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAlerts } from '@/api/queries/alerts';
import { useAckAlert } from '@/api/mutations/alerts';

/** F5.5 - catch-up notice (docs/12 §12): an unacked `catchup_backlog` alert becomes
 *  an amber banner on Overview + Campaigns. The copy is the never-burst promise from
 *  the walkthrough's Stage-5 panel - the backlog drains at the normal pace. */
export function CatchupBanner() {
  const { data } = useAlerts(true);
  const ack = useAckAlert();
  const alert = data?.items.find((a) => a.kind === 'catchup_backlog');
  if (!alert) return null;

  const payload = alert.payload as { missed_sends?: number; downtime_hours?: number };

  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4"
      data-testid="catchup-banner"
      role="status"
    >
      <Clock className="mt-0.5 size-4 text-warning" aria-hidden />
      <div className="flex-1 space-y-1">
        <p className="text-sm font-medium">Catching up after downtime</p>
        <p className="text-xs text-muted-foreground">
          {payload.missed_sends ?? '?'} sends came due during {payload.downtime_hours ?? '?'}h
          offline. They are queued behind today&apos;s normal pacing and go out at the usual gaps -
          the scheduler never bursts a backlog, so deliverability is unaffected.
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
