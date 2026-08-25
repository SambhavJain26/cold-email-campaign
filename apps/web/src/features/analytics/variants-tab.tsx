import { useMemo, useState } from 'react';
import { Trophy } from 'lucide-react';
import { toast } from 'sonner';
import type { VariantAnalyticsRow } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { useVariantAnalytics } from '@/api/queries/analytics';
import { useSequences } from '@/api/queries/sequences';
import { useDeactivateVariant } from '@/api/mutations/campaigns';
import { variantsMeetings, winningVariant } from './reconciliation';

const SMALL_SAMPLE = 300;

export function VariantsTab({
  campaignId,
  campaignSequenceId,
}: {
  campaignId: number;
  campaignSequenceId: number | null;
}) {
  const sequences = useSequences();
  const sequence = sequences.data?.items.find((item) => item.id === campaignSequenceId);
  const stepNumbers = useMemo(
    () => sequence?.steps.map((step) => step.step_no).toSorted((a, b) => a - b) ?? [1],
    [sequence],
  );
  const [stepNo, setStepNo] = useState(1);
  const selectedStepNo = stepNumbers.includes(stepNo) ? stepNo : (stepNumbers[0] ?? 1);

  const { data, isPending, isError, refetch } = useVariantAnalytics(campaignId, selectedStepNo);
  const deactivate = useDeactivateVariant();
  const [confirmId, setConfirmId] = useState<number | null>(null);

  if (campaignSequenceId === null) {
    return (
      <EmptyState
        title="No sequence assigned"
        description="Variant analysis needs this campaign's sequence."
      />
    );
  }
  if (isPending || sequences.isPending) return <Skeleton className="h-40 w-full" />;
  if (isError || sequences.isError) {
    return (
      <EmptyState title="Failed to load variants" actionLabel="Retry" onAction={() => refetch()} />
    );
  }

  const rows = data.items;
  const comparableRows = rows.filter((row) => !row.bespoke);
  const winner = winningVariant(comparableRows);
  const tied = comparableRows.length > 1 && winner === null;
  const smallSample = comparableRows.some((row) => row.eventual.cohort < SMALL_SAMPLE);
  const confirmTarget = rows.find((row) => row.variant_id === confirmId);
  const directColumns: Array<DataTableColumn<VariantAnalyticsRow>> = [
    {
      key: 'variant',
      header: 'Variant',
      cell: (row) => (
        <span className="font-medium">
          {row.label}
          {row.bespoke ? ' · manual' : row.active ? '' : ' · inactive'}
        </span>
      ),
    },
    {
      key: 'subject',
      header: 'Subject',
      cell: (row) => (
        <span className="break-words font-mono text-xs text-muted-foreground">
          {row.subject_template}
        </span>
      ),
    },
    { key: 'sent', header: 'Sent', align: 'right', cell: (row) => row.direct.sent },
    { key: 'delivered', header: 'Delivered', align: 'right', cell: (row) => row.direct.delivered },
    {
      key: 'reply',
      header: 'Reply',
      align: 'right',
      cell: (row) => `${row.direct.reply_rate.value}%`,
    },
    {
      key: 'positive',
      header: 'Positive',
      align: 'right',
      cell: (row) => `${row.direct.positive_rate.value}%`,
    },
  ];
  const eventualColumns: Array<DataTableColumn<VariantAnalyticsRow>> = [
    {
      key: 'variant',
      header: 'Variant',
      cell: (row) => (
        <span className="font-medium">
          {row.variant_id === winner?.variant_id && (
            <Trophy className="mr-1 inline size-3.5 text-success" aria-label="winner" />
          )}
          {row.label}
          {row.bespoke && ' · read-only'}
        </span>
      ),
    },
    { key: 'cohort', header: 'Cohort', align: 'right', cell: (row) => row.eventual.cohort },
    {
      key: 'reply',
      header: 'Reply',
      align: 'right',
      cell: (row) => `${row.eventual.reply_rate.value}%`,
    },
    {
      key: 'positive',
      header: 'Positive',
      align: 'right',
      cell: (row) => `${row.eventual.positive_rate.value}%`,
    },
    {
      key: 'meetings',
      header: 'Meetings',
      align: 'right',
      cell: (row) => <span className="font-medium">{row.eventual.meetings}</span>,
    },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      cell: (row) =>
        row.deactivatable ? (
          <Button variant="outline" size="xs" onClick={() => setConfirmId(row.variant_id)}>
            Deactivate
          </Button>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Variant performance by step</p>
          <p className="text-xs text-muted-foreground">
            Direct response follows the replied-to message. Eventual outcome follows the whole
            enrollment after receiving the variant.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="variant-step" className="text-xs font-medium">
            Sequence step
          </label>
          <Select
            value={String(selectedStepNo)}
            onValueChange={(value) => setStepNo(Number(value))}
          >
            <SelectTrigger id="variant-step" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {stepNumbers.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    Step {value}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      <section aria-labelledby="direct-heading" className="flex flex-col gap-2">
        <div>
          <h2 id="direct-heading" className="text-sm font-semibold">
            Direct response
          </h2>
          <p className="text-xs text-muted-foreground">
            Replies that directly reference a message sent at Step {selectedStepNo}.
          </p>
        </div>
        <DataTable
          columns={directColumns}
          rows={rows}
          rowKey={(row) => row.variant_id}
          rowTestId={(row) => `variant-row-${row.label}`}
        />
      </section>

      <section aria-labelledby="eventual-heading" className="flex flex-col gap-2">
        <div>
          <h2 id="eventual-heading" className="text-sm font-semibold">
            Eventual outcome
          </h2>
          <p className="text-xs text-muted-foreground">
            Any later reply or meeting from enrollments that received this Step {selectedStepNo}{' '}
            variant.
          </p>
        </div>
        <DataTable columns={eventualColumns} rows={rows} rowKey={(row) => row.variant_id} />
      </section>

      <div className="flex flex-col gap-1 text-xs" data-testid="variants-verdict">
        {winner ? (
          <p>
            Variant {winner.label} leads on eventual meetings ({winner.eventual.meetings}), then
            eventual positive rate ({winner.eventual.positive_rate.value}%).
          </p>
        ) : tied ? (
          <p>No winner yet: the leading variants are tied on meetings and positive rate.</p>
        ) : null}
        <p className="text-muted-foreground">
          These Step {selectedStepNo} cohorts account for {variantsMeetings(rows)} eventual
          meetings.
        </p>
        {smallSample && (
          <p className="text-warning" data-testid="small-sample">
            Under {SMALL_SAMPLE} sends per automated variant — trust big gaps, not small wobbles.
          </p>
        )}
      </div>

      <Dialog open={confirmId !== null} onOpenChange={(open) => !open && setConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate variant {confirmTarget?.label}?</DialogTitle>
            <DialogDescription>
              Future sends stop using it. Historical results remain visible. The server refuses to
              deactivate the final active automated variant for a step.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmId(null)}>
              Cancel
            </Button>
            <Button
              disabled={deactivate.isPending}
              onClick={() => {
                if (confirmId === null) return;
                deactivate.mutate(confirmId, {
                  onSuccess: () => {
                    toast.success(`Variant ${confirmTarget?.label} deactivated`);
                    setConfirmId(null);
                  },
                });
              }}
            >
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
