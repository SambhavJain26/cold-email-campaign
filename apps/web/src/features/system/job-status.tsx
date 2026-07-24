import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { formatRelativeTime } from '@/lib/format';
import { useSystemStatus } from '@/api/queries/system';
import { useRebuildProjections } from '@/api/mutations/system';

/** F8.2 — job status + rebuild dry-run (docs/12 §11). The rebuild compares the
 *  event-log projection against the stored one; 0 diffs is the correctness audit. */
export function JobStatus() {
  const { data, isPending, isError, refetch } = useSystemStatus();
  const rebuild = useRebuildProjections();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (isPending) return <Skeleton className="h-48 w-full" />;
  if (isError) {
    return (
      <EmptyState
        title="Failed to load system status"
        actionLabel="Retry"
        onAction={() => refetch()}
      />
    );
  }

  const result = rebuild.data;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Job status</h2>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">Transport</dt>
          <dd className="mt-1">
            <Badge
              data-testid="transport-mode"
              className={
                data.transport_mode === 'mock'
                  ? 'bg-warning/15 text-warning'
                  : 'bg-success/15 text-success'
              }
              variant="outline"
            >
              {data.transport_mode === 'mock' ? 'MOCK' : 'LIVE'}
            </Badge>
          </dd>
        </div>
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">Scheduler last tick</dt>
          <dd className="mt-1 text-sm font-medium" data-testid="last-tick">
            {data.scheduler_last_tick_at
              ? formatRelativeTime(data.scheduler_last_tick_at)
              : 'never'}
          </dd>
        </div>
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">Pending jobs</dt>
          <dd className="mt-1 text-sm font-medium tabular-nums">{data.pending_jobs}</dd>
        </div>
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">Pollers</dt>
          <dd className="mt-1 text-sm font-medium tabular-nums">{data.pollers.length}</dd>
        </div>
      </dl>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-3 py-1.5 font-medium">Mailbox</th>
              <th className="px-3 py-1.5 font-medium">Last successful poll</th>
            </tr>
          </thead>
          <tbody data-testid="poller-freshness">
            {data.pollers.map((poller) => (
              <tr key={poller.mailbox_id} className="border-b border-border/60 last:border-b-0">
                <td className="px-3 py-1.5 tabular-nums">{poller.mailbox_id}</td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">
                  {poller.last_successful_poll_at
                    ? formatRelativeTime(poller.last_successful_poll_at)
                    : 'never'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
        Rebuild projections (dry-run)
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rebuild projections — dry run</DialogTitle>
            <DialogDescription>
              Replays the event log and compares the derived state to what is stored. Nothing is
              written. Zero diffs means the projections are faithful to the log.
            </DialogDescription>
          </DialogHeader>

          {result && (
            <div className="text-sm" data-testid="rebuild-result">
              {result.diffs === 0 ? (
                <p className="text-success">✓ 0 diffs — projections match the event log.</p>
              ) : (
                <div className="space-y-1">
                  <p className="text-destructive">
                    ✗ {result.diffs} projection{result.diffs === 1 ? '' : 's'} drifted from the log.
                  </p>
                  {result.details?.slice(0, 10).map((detail, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      enrollment {detail.enrollment_id} · {detail.field}: stored{' '}
                      {String(detail.stored)} ≠ derived {String(detail.derived)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Close
            </Button>
            <Button
              disabled={rebuild.isPending}
              onClick={() =>
                rebuild.mutate(true, {
                  onSuccess: (data) =>
                    toast.success(
                      data.diffs === 0 ? 'Dry run clean — 0 diffs' : `${data.diffs} diffs found`,
                    ),
                })
              }
            >
              {rebuild.isPending ? 'Running…' : 'Run dry run'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
