import { useState } from 'react';
import { Recycle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { DataTable } from '@/components/shared/data-table';
import { TierBadge } from '@/components/shared/tier-badge';
import { useCampaignParam } from '@/components/layout/campaign-selector';
import { useCampaigns, useColdStorage } from '@/api/queries/campaigns';
import { formatDateTime } from '@/lib/format';
import { RecycleDialog } from './recycle-dialog';

function daysUntil(iso: string, now = new Date()): number {
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000);
}

/** F7.5 — Cold Storage (docs/12 §9): who has rested long enough for a second pass. */
export default function ColdStoragePage() {
  const campaigns = useCampaigns();
  const selected = useCampaignParam();
  const sourceCampaignId = selected ?? campaigns.data?.items[0]?.id;
  const source = campaigns.data?.items.find((c) => c.id === sourceCampaignId);
  const [pagination, setPagination] = useState({ sourceCampaignId, page: 1 });
  const page = pagination.sourceCampaignId === sourceCampaignId ? pagination.page : 1;
  const { data, isPending, isError, refetch } = useColdStorage(sourceCampaignId ?? 0, page, 50);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (campaigns.isPending || isPending) return <Skeleton className="m-6 h-64" />;
  if (sourceCampaignId === undefined) {
    return (
      <div className="p-6">
        <EmptyState
          title="No campaigns yet"
          description="Cold storage lists a campaign's finished leads."
        />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title="Failed to load cold storage"
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      </div>
    );
  }

  const rows = data.items;
  const eligible = rows.filter((row) => row.eligible);
  const nextDate = rows
    .filter((row) => !row.eligible)
    .map((row) => row.earliest_recycle_at)
    .sort()[0];
  const passes = (campaigns.data?.items ?? []).filter((campaign) =>
    campaign.recycle_sources.some(
      (sourceCampaign) => sourceCampaign.campaign_id === sourceCampaignId,
    ),
  );

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold">Cold Storage</h1>
          {source && <span className="text-sm text-muted-foreground">· from {source.name}</span>}
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Recycle className="size-4" /> Recycle into campaign…
        </Button>
      </div>

      <section className="space-y-1 rounded-lg border border-border bg-card p-4 text-xs">
        <p className="text-sm font-medium">
          {eligible.length} of {data.total} finished leads are ready on this page
        </p>
        <p className="text-muted-foreground">
          A large market means the same lead is worth contacting again — after a rest, with a
          different angle. The rest period is enforced server-side, and the content-hash guard makes
          re-sending an identical message impossible.
        </p>
        {nextDate && (
          <p className="text-muted-foreground" data-testid="next-eligible">
            Next batch becomes eligible {formatDateTime(nextDate)}.
          </p>
        )}
        {passes.length > 0 && (
          <p className="text-muted-foreground">
            Pass history: {passes.map((c) => c.name).join(', ')}.
          </p>
        )}
      </section>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing in cold storage yet"
          description="Leads land here once their enrollment completes without a reply."
        />
      ) : (
        <DataTable
          rows={rows}
          rowKey={(row) => row.lead.id}
          pagination={{
            page: data.page,
            perPage: data.per_page,
            total: data.total,
            onPageChange: (nextPage) => setPagination({ sourceCampaignId, page: nextPage }),
          }}
          columns={[
            { key: 'lead', header: 'Lead', cell: (row) => row.lead.email },
            { key: 'tier', header: 'Tier', cell: (row) => <TierBadge tier={row.lead.tier} /> },
            {
              key: 'completed',
              header: 'Completed',
              cell: (row) => (
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(row.completed_at)}
                </span>
              ),
            },
            {
              key: 'earliest',
              header: 'Earliest recycle',
              cell: (row) => (
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(row.earliest_recycle_at)}
                </span>
              ),
            },
            {
              key: 'eligible',
              header: 'Eligible',
              cell: (row) =>
                row.eligible ? (
                  <span className="text-success">✓ ready</span>
                ) : (
                  <span className="text-muted-foreground">
                    ✗ in {Math.max(0, daysUntil(row.earliest_recycle_at))}d
                  </span>
                ),
            },
          ]}
          mobileCard={(row) => (
            <article
              className="space-y-2 rounded-lg border border-border bg-card p-3"
              data-testid={`cold-row-${row.lead.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium">{row.lead.email}</p>
                <TierBadge tier={row.lead.tier} />
              </div>
              <p className="text-xs text-muted-foreground">
                Completed {formatDateTime(row.completed_at)}
                <br />
                Recycle{' '}
                {row.eligible ? 'ready now' : `after ${formatDateTime(row.earliest_recycle_at)}`}
              </p>
            </article>
          )}
        />
      )}

      <RecycleDialog
        key={sourceCampaignId}
        sourceCampaignId={sourceCampaignId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
