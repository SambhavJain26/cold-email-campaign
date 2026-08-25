import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/shared/empty-state';
import { DataTable } from '@/components/shared/data-table';
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
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const alerts = useAlerts(unackedOnly, page, perPage);
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
          <Switch
            id="unacked-alerts"
            checked={unackedOnly}
            onCheckedChange={(checked) => {
              setUnackedOnly(checked);
              setPage(1);
            }}
          />
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
        <DataTable
          rows={alerts.data.items}
          rowKey={(alert) => alert.id}
          pagination={{
            page: alerts.data.page,
            perPage: alerts.data.per_page,
            total: alerts.data.total,
            onPageChange: setPage,
            onPerPageChange: (nextPerPage) => {
              setPerPage(nextPerPage);
              setPage(1);
            },
            paginationLabel: 'Alerts history pagination',
          }}
          columns={[
            {
              key: 'created',
              header: 'Created',
              cell: (alert) => (
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatDateTime(alert.created_at)}
                </span>
              ),
            },
            {
              key: 'alert',
              header: 'Alert',
              cell: (alert) => (
                <span className="text-xs font-medium">
                  {KIND_LABEL[alert.kind] ?? alert.kind.replaceAll('_', ' ')}
                </span>
              ),
            },
            {
              key: 'severity',
              header: 'Severity',
              cell: (alert) => (
                <Badge variant={alert.severity === 'error' ? 'destructive' : 'outline'}>
                  {alert.severity}
                </Badge>
              ),
            },
            {
              key: 'details',
              header: 'Details',
              className: 'max-w-md font-mono text-[11px] text-muted-foreground',
              cell: (alert) =>
                Object.keys(alert.payload).length === 0 ? '—' : JSON.stringify(alert.payload),
            },
            {
              key: 'status',
              header: 'Status',
              cell: (alert) =>
                alert.acknowledged_at === null
                  ? 'Open'
                  : `Acknowledged ${formatDateTime(alert.acknowledged_at)}`,
            },
            {
              key: 'action',
              header: 'Action',
              align: 'right',
              cell: (alert) =>
                alert.acknowledged_at === null ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={ack.isPending}
                    onClick={() => ack.mutate(alert.id)}
                  >
                    Acknowledge
                  </Button>
                ) : null,
            },
          ]}
          mobileCard={(alert) => (
            <article className="space-y-2 rounded-lg border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    {KIND_LABEL[alert.kind] ?? alert.kind.replaceAll('_', ' ')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(alert.created_at)}
                  </p>
                </div>
                <Badge variant={alert.severity === 'error' ? 'destructive' : 'outline'}>
                  {alert.severity}
                </Badge>
              </div>
              {Object.keys(alert.payload).length > 0 && (
                <p className="break-words font-mono text-[11px] text-muted-foreground">
                  {JSON.stringify(alert.payload)}
                </p>
              )}
              <div className="flex items-center justify-between gap-2 text-xs">
                <span>{alert.acknowledged_at === null ? 'Open' : 'Acknowledged'}</span>
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
              </div>
            </article>
          )}
        />
      )}
    </section>
  );
}
