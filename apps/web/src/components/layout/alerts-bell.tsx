import { Bell } from 'lucide-react';
import type { AlertDto } from '@coldemail/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format';
import { useAlerts } from '@/api/queries/alerts';
import { useAckAlert } from '@/api/mutations/alerts';

/** Per-kind rendering (docs/15 F1.3): each alert kind gets a human line built
 *  from its payload; unknown kinds fall back to the kind slug. */
function describe(alert: AlertDto): { title: string; detail?: string } {
  const p = alert.payload as Record<string, unknown>;
  switch (alert.kind) {
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
        detail: `${p.missed_sends ?? '?'} sends were due during ${p.downtime_hours ?? '?'}h of downtime — pacing resumes, never bursts.`,
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
              {alerts.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="border-b border-border px-3 py-2 text-sm font-medium">Alerts</div>
        {alerts.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Nothing needs attention.</p>
        ) : (
          <ScrollArea className="max-h-96">
            <ul className="divide-y divide-border">
              {alerts.map((alert) => {
                const { title, detail } = describe(alert);
                return (
                  <li key={alert.id} className="flex items-start gap-2 px-3 py-2">
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
                      disabled={ack.isPending}
                      onClick={() => ack.mutate(alert.id)}
                    >
                      Ack
                    </Button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
