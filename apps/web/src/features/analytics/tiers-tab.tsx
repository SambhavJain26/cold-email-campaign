import { toast } from 'sonner';
import type { TierAnalyticsRow } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { TierBadge } from '@/components/shared/tier-badge';
import { useTierAnalytics } from '@/api/queries/analytics';
import { useBulkTier } from '@/api/mutations/leads';
import { tiersReconciliation } from './reconciliation';

const MODE_LABEL: Record<string, string> = {
  human_written: 'human (Mode 1)',
  template_researched: 'researched (Mode 2)',
  template_auto: 'auto (Mode 2)',
};

/** F7.3 — 13c tier performance + the promote action (engaged Tier-C → Tier B). */
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
  const bulkTier = useBulkTier();

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
    { key: 'tier', header: 'Tier', cell: (row) => <TierBadge tier={row.tier} /> },
    { key: 'contacted', header: 'Contacted', align: 'right', cell: (row) => row.contacted },
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
          • Tier C converts thinnest; consider recycling those leads with a sharper segment message
          rather than spending more effort per lead.
        </p>
        {promotable > 0 && (
          <p>
            • {promotable} Tier-C leads replied — promote them to Tier B (researched mode) for the
            next pass.
          </p>
        )}
      </div>

      {promotable > 0 && (
        <Button
          size="sm"
          variant="outline"
          disabled={bulkTier.isPending}
          data-testid="promote-tier-c"
          onClick={() =>
            // The server picks the set from the same filter it shares with the
            // leads list: engaged (REPLIED) Tier-C leads in THIS campaign.
            bulkTier.mutate(
              {
                filter: { tier: 'C', state: 'REPLIED', campaign_id: campaignId },
                tier: 'B',
              },
              {
                onSuccess: (result) => toast.success(`Promoted ${result.updated} leads to Tier B`),
              },
            )
          }
        >
          Promote {promotable} engaged Tier-C → Tier B
        </Button>
      )}
    </div>
  );
}
