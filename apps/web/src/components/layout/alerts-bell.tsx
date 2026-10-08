import { Bell, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import type { AlertDto } from '@coldemail/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format';
import { useAlerts } from '@/api/queries/alerts';
import { useAckAlert, useAckAllAlerts } from '@/api/mutations/alerts';

/** Per-kind rendering (docs/15 F1.3): each alert kind gets a human line built
 *  from its payload; unknown kinds fall back to the kind slug. */
function describe(alert: AlertDto): { title: string; detail?: string } {
  const p = alert.payload as Record<string, unknown>;
  switch (alert.kind) {
    case 'send_blocked_compliance_missing_address':
    case 'send_blocked_no_healthy_mailbox':
    case 'send_blocked_send_window_closed':
    case 'send_blocked_daily_capacity_exhausted':
    case 'send_blocked_pacing_delay':
    case 'send_blocked_manual_only':
      return {
        title: 'Sending blocked',
        detail: typeof p.message === 'string' ? p.message : undefined,
      };
    case 'mailbox_auto_paused':
      return {
        title: `Mailbox ${p.mailbox_id} auto-paused`,
        detail: typeof p.reason === 'string' ? p.reason : undefined,
      };
    case 'mailbox_auth_failed':
      return {
        title: `Mailbox ${p.mailbox_id} authentication failed`,
        detail: 'Reconnect it from the Mailboxes screen.',
      };
    case 'imap_stale':
      return { title: `Mailbox ${p.mailbox_id} IMAP poll is stale` };
    case 'catchup_backlog':
      return {
        title: 'Scheduler catch-up in progress',
        detail: `${p.overdue ?? '?'} sends are overdue; ${p.remainingBudgetToday ?? '?'} mailbox slots remain today. Pacing never bursts.`,
      };
    case 'compliance_missing_address':
      return {
        title: 'Sending blocked: no physical address',
        detail: 'CAN-SPAM requires one — set it in Settings → Compliance.',
      };
    case 'suppression_removed':
      return { title: `Suppression removed for ${p.email ?? 'a lead'}` };
    case 'import_committed':
      return { title: `Import #${p.import_id} committed (${p.imported} leads)` };
    default:
      return { title: alert.kind.replaceAll('_', ' ') };
  }
}

const SEVERITY_DOT: Record<AlertDto['severity'], string> = {
  info: 'bg-info',
  warning: 'bg-warning',
  error: 'bg-destructive',
};

export function AlertsBell() {
  const { data } = useAlerts(true); // unacked, 30s poll
  const ack = useAckAlert();
  const clear = useAckAllAlerts();
  const alerts = data?.items ?? [];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Alerts">
          <Bell className="size-4" />
          {alerts.length > 0 && (
            <Badge
              className="absolute -top-1 -right-1 h-4 min-w-4 rounded-full px-1 text-[10px]"
              variant="destructive"
              data-testid="alerts-count"
            >
              {data?.total ?? alerts.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Notifications</p>
            <p className="text-xs text-muted-foreground">{data?.total ?? alerts.length} waiting</p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={!alerts.length || clear.isPending || data?.ack_through_id === undefined}
            onClick={() =>
              clear.mutate(data!.ack_through_id!, {
                onSuccess: () => toast.success('Notifications cleared. Alert history retained.'),
                onError: (error) => toast.error(error.message),
              })
            }
          >
            <CheckCheck className="size-4" />
            {clear.isPending ? 'Clearing…' : 'Clear all notifications'}
          </Button>
        </div>
        {alerts.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Nothing needs attention.</p>
        ) : (
          <div className="max-h-[min(24rem,60dvh)] overflow-y-auto overscroll-contain">
            <ul className="divide-y divide-border">
              {alerts.map((alert) => {
                const { title, detail } = describe(alert);
                return (
                  <li key={alert.id} className="flex items-start gap-3 px-4 py-3">
                    <span
                      className={cn(
                        'mt-1.5 size-2 shrink-0 rounded-full',
                        SEVERITY_DOT[alert.severity],
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{title}</p>
                      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatRelativeTime(alert.created_at)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-xs"
                      disabled={ack.isPending || clear.isPending}
                      onClick={() => ack.mutate(alert.id)}
                    >
                      Clear
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div className="border-t border-border px-4 py-2">
          <Link to="/system" className="text-xs text-muted-foreground underline underline-offset-4">
            View alert history in System
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
