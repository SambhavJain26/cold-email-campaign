import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/shared/empty-state';
import { useAlerts } from '@/api/queries/alerts';
import { useAckAlert } from '@/api/mutations/alerts';
import { formatDateTime } from '@/lib/format';

const KIND_LABEL: Record<string, string> = {
  mailbox_auto_paused: 'Auto-pause',
  mailbox_auth_failed: 'Authentication failure',
  mailbox_imap_stale: 'Stale IMAP',
  backup_stale: 'Backup freshness failure',
  selfcheck_drift: 'Projection drift',
  catchup_backlog: 'Catch-up backlog',
  job_failed: 'Failed job',
};

export function AlertsHistory() {
  const [unackedOnly, setUnackedOnly] = useState(false);
  const alerts = useAlerts(unackedOnly);
  const ack = useAckAlert();

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Alerts history</h2>
          <p className="text-xs text-muted-foreground">
            Operational incidents remain visible after acknowledgement for review and handoff.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="unacked-alerts" checked={unackedOnly} onCheckedChange={setUnackedOnly} />
          <Label htmlFor="unacked-alerts" className="text-xs">
            Open only
          </Label>
        </div>
      </div>

      {alerts.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : alerts.isError ? (
        <EmptyState
          title="Failed to load alert history"
          actionLabel="Retry"
          onAction={() => alerts.refetch()}
        />
      ) : alerts.data.items.length === 0 ? (
        <EmptyState title={unackedOnly ? 'No open alerts.' : 'No alert history yet.'} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Created</TableHead>
                <TableHead className="text-xs">Alert</TableHead>
                <TableHead className="text-xs">Severity</TableHead>
                <TableHead className="text-xs">Details</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-right text-xs">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.data.items.map((alert) => (
                <TableRow key={alert.id}>
                  <TableCell className="whitespace-nowrap py-2 text-xs text-muted-foreground">
                    {formatDateTime(alert.created_at)}
                  </TableCell>
                  <TableCell className="py-2 text-xs font-medium">
                    {KIND_LABEL[alert.kind] ?? alert.kind.replaceAll('_', ' ')}
                  </TableCell>
                  <TableCell className="py-2">
                    <Badge variant={alert.severity === 'error' ? 'destructive' : 'outline'}>
                      {alert.severity}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-md py-2 font-mono text-[11px] text-muted-foreground">
                    {Object.keys(alert.payload).length === 0 ? '—' : JSON.stringify(alert.payload)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2 text-xs">
                    {alert.acknowledged_at === null
                      ? 'Open'
                      : `Acknowledged ${formatDateTime(alert.acknowledged_at)}`}
                  </TableCell>
                  <TableCell className="py-2 text-right">
                    {alert.acknowledged_at === null && (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={ack.isPending}
                        onClick={() => ack.mutate(alert.id)}
                      >
                        Acknowledge
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
