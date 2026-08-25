import { Link } from 'react-router-dom';
import type { StepAnalyticsRow } from '@coldemail/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { useStepAnalytics } from '@/api/queries/analytics';
import { stepsReconciliation, stepVerdict, type StepVerdict } from './reconciliation';

const VERDICT: Record<StepVerdict, { label: string; className: string }> = {
  weak: { label: '⚠️ WEAK', className: 'bg-warning/15 text-warning' },
  strong: { label: '✅ strong', className: 'bg-success/15 text-success' },
  keep: { label: '✅ keep', className: 'bg-success/15 text-success' },
  small_sample: { label: 'small sample', className: 'bg-muted text-muted-foreground' },
};

/** F7.2 — 13b step analysis: kill the weak step, don't pile on follow-ups. */
export function StepsTab({
  campaignId,
  sequenceId,
  campaignPositives,
}: {
  campaignId: number;
  sequenceId: number | null;
  /** The campaign's positive-reply count — what the per-step sum must equal. */
  campaignPositives: number | null;
}) {
  const { data, isPending, isError, refetch } = useStepAnalytics({ campaign_id: campaignId });

  if (isPending) return <Skeleton className="h-40 w-full" />;
  if (isError) {
    return (
      <EmptyState
        title="Failed to load step analysis"
        actionLabel="Retry"
        onAction={() => refetch()}
      />
    );
  }

  const rows = data.items;
  const bestRate = rows.reduce((best, row) => Math.max(best, row.positive_rate.value), 0);
  const reconciliation = stepsReconciliation(rows, campaignPositives);
  const weakest = rows.find((row) => stepVerdict(row, bestRate) === 'weak');
  const columns: Array<DataTableColumn<StepAnalyticsRow>> = [
    {
      key: 'step',
      header: 'Step',
      cell: (row) => <span className="font-medium">Step {row.step_no}</span>,
    },
    { key: 'delivered', header: 'Delivered', align: 'right', cell: (row) => row.delivered },
    {
      key: 'positive',
      header: 'Positive replies',
      align: 'right',
      cell: (row) => row.positive_replies,
    },
    {
      key: 'rate',
      header: 'Positive %',
      align: 'right',
      cell: (row) => (
        <span
          title={`${row.positive_rate.numerator} / ${row.positive_rate.denominator} = ${row.positive_rate.value}%`}
        >
          {row.positive_rate.value}%
        </span>
      ),
    },
    {
      key: 'verdict',
      header: 'Verdict',
      cell: (row) => {
        const verdict = VERDICT[stepVerdict(row, bestRate)];
        return (
          <Badge variant="outline" className={`border-transparent ${verdict.className}`}>
            {verdict.label}
          </Badge>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.step_no}
        rowTestId={(row) => `step-row-${row.step_no}`}
      />

      <p className="text-xs text-muted-foreground" data-testid="steps-reconciliation">
        (positives sum to {reconciliation.sum}
        {reconciliation.expected !== null &&
          ` — campaign total ${reconciliation.expected} ${reconciliation.ok ? '✓' : '✗'}`}
        )
      </p>

      {weakest && (
        <div className="space-y-2 text-xs">
          <p>
            💡 Step {weakest.step_no}&apos;s positive rate is {weakest.positive_rate.value}% over{' '}
            {weakest.delivered} delivered — dead weight. Removing it tightens the sequence without
            losing real interest.
          </p>
          {sequenceId !== null ? (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/sequences/${sequenceId}`}>
                Remove step {weakest.step_no} in the builder
              </Link>
            </Button>
          ) : (
            <p className="text-muted-foreground">
              This campaign has no sequence attached, so there is no builder to open.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
