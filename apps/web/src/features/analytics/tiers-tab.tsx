import type { TierAnalyticsRow } from '@coldemail/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { TierBadge } from '@/components/shared/tier-badge';
import { useTierAnalytics } from '@/api/queries/analytics';
import { tiersReconciliation } from './reconciliation';

const MODE_LABEL: Record<string, string> = {
  human_written: 'human (Mode 1)',
  template_researched: 'researched (Mode 2)',
  template_auto: 'auto (Mode 2)',
};

/** F7.3 — current A/B performance plus read-only legacy tier snapshots. */
export function TiersTab({
  campaignId,
  campaignMeetings,
  campaignContacted,
}: {
  campaignId: number;
  campaignMeetings: number | null;
  campaignContacted: number | null;
}) {
  const { data, isPending, isError, refetch } = useTierAnalytics(campaignId);

  if (isPending) return <Skeleton className="h-40 w-full" />;
  if (isError) {
    return (
      <EmptyState title="Failed to load tiers" actionLabel="Retry" onAction={() => refetch()} />
    );
  }

  const rows = data.items;
  const checks = tiersReconciliation(rows, campaignMeetings, campaignContacted);
  const best = rows.reduce<(typeof rows)[number] | null>(
    (top, row) => (top === null || row.meetings > top.meetings ? row : top),
    null,
  );
  const totalMeetings = checks[0]!.sum;
  const promotable = data.promotable.tier_c_engaged;
  const columns: Array<DataTableColumn<TierAnalyticsRow>> = [
    {
      key: 'tier',
      header: 'Tier',
      cell: (row) => (
        <span className="flex items-center gap-2">
          <TierBadge tier={row.tier} />
          {(row.tier === 'C' || row.tier === 'nurture') && (
            <span className="text-xs text-muted-foreground">Legacy</span>
          )}
        </span>
      ),
    },
    { key: 'contacted', header: 'Contacted', align: 'right', cell: (row) => row.contacted },
    { key: 'delivered', header: 'Confirmed', align: 'right', cell: (row) => row.delivered },
    {
      key: 'pending',
      header: 'Pending',
      align: 'right',
      cell: (row) => row.pending_delivery_confirmation,
    },
    {
      key: 'reply',
      header: 'Reply',
      align: 'right',
      cell: (row) => (
        <span
          title={`${row.reply_rate.numerator} / ${row.reply_rate.denominator} = ${row.reply_rate.value}%`}
        >
          {row.reply_rate.value}%
        </span>
      ),
    },
    {
      key: 'positive',
      header: 'Positive',
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
      key: 'meetings',
      header: 'Meetings',
      align: 'right',
      cell: (row) => <span className="font-medium">{row.meetings}</span>,
    },
    {
      key: 'mode',
      header: 'Effort mode',
      cell: (row) => (
        <span className="text-xs text-muted-foreground">{MODE_LABEL[row.mode] ?? row.mode}</span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.tier ?? 'untiered'}
        rowTestId={(row) => `tier-row-${row.tier ?? 'none'}`}
      />

      <p className="text-xs text-muted-foreground" data-testid="tiers-reconciliation">
        {checks
          .map(
            (check) =>
              `${check.label} sum to ${check.sum}${
                check.expected === null
                  ? ''
                  : ` — campaign ${check.expected} ${check.ok ? '✓' : '✗'}`
              }`,
          )
          .join(' · ')}
      </p>

      <div className="space-y-1 text-xs" data-testid="tier-insights">
        <p className="font-medium">💡 Insights</p>
        {best && (
          <p>
            • Tier {best.tier ?? 'untiered'} produced {best.meetings} of {totalMeetings} meetings —
            tiering by likelihood-to-close is doing the work.
          </p>
        )}
        <p>
          • Legacy Tier C converts thinnest; consider recycling those leads with a sharper segment
          message. New enrollment uses only Tier A and Tier B.
        </p>
        {promotable > 0 && (
          <p>
            • {promotable} historical Tier-C leads replied. Their analytics remain visible while
            current tier controls stay limited to A and B.
          </p>
        )}
      </div>

      {promotable > 0 && (
        <p className="text-sm text-muted-foreground">
          {promotable} historical Tier-C replies are retained for legacy analytics. Current lead
          tier controls use only Tier A and Tier B.
        </p>
      )}
    </div>
  );
}
