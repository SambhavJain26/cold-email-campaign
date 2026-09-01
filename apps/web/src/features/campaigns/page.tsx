import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import type { CampaignDto } from '@coldemail/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { CatchupBanner } from '@/components/shared/catchup-banner';
import { EmptyState } from '@/components/shared/empty-state';
import { ProgressBar } from '@/components/shared/progress-bar';
import { useCampaigns } from '@/api/queries/campaigns';
import { useSequences } from '@/api/queries/sequences';
import { usePatchCampaign } from '@/api/mutations/campaigns';
import { CampaignDialog } from './campaign-dialog';
import { CampaignStatusBadge } from './status-badge';

/** The one status transition offered per state — nothing sends from a draft. */
function primaryAction(
  campaign: CampaignDto,
): { label: string; status: 'active' | 'paused' | 'archived' } | null {
  switch (campaign.status) {
    case 'draft':
      return { label: 'Activate', status: 'active' };
    case 'active':
      return { label: 'Pause', status: 'paused' };
    case 'paused':
      return { label: 'Resume', status: 'active' };
    default:
      return null;
  }
}

/** F5.1 — Campaigns list (docs/12 §6). */
export default function CampaignsPage() {
  const { data, isPending, isError, refetch } = useCampaigns();
  const sequences = useSequences();
  const patch = usePatchCampaign();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (isPending) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title="Failed to load campaigns"
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      </div>
    );
  }

  const campaigns = data.items;
  const sequenceName = (id: number | null) =>
    id === null ? null : (sequences.data?.items.find((s) => s.id === id)?.name ?? `#${id}`);
  const columns: Array<DataTableColumn<CampaignDto>> = [
    {
      key: 'name',
      header: 'Name',
      cell: (campaign) => (
        <div>
          <Link to={`/campaigns/${campaign.id}`} className="font-medium hover:underline">
            {campaign.name}
          </Link>
          {campaign.recycle_sources.length > 0 && (
            <Badge variant="outline" className="ml-2 text-[10px]">
              Recycled from {campaign.recycle_sources.length} campaign
              {campaign.recycle_sources.length === 1 ? '' : 's'}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (campaign) => <CampaignStatusBadge status={campaign.status} />,
    },
    {
      key: 'sequence',
      header: 'Sequence',
      cell: (campaign) => (
        <span className="text-xs text-muted-foreground">
          {sequenceName(campaign.sequence_id) ?? (
            <span className="text-destructive">none — cannot send</span>
          )}
        </span>
      ),
    },
    {
      key: 'enrolled',
      header: 'Enrolled',
      align: 'right',
      cell: (campaign) => campaign.enrolled_count,
    },
    {
      key: 'contacted',
      header: 'Contacted',
      align: 'right',
      cell: (campaign) => (
        <div className="text-right">
          <div>{campaign.contacted_count}</div>
          {campaign.pending_delivery_confirmation_count > 0 && (
            <div className="text-xs text-muted-foreground">
              {campaign.pending_delivery_confirmation_count} awaiting confirmation
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'progress',
      header: 'Journey progress',
      cell: (campaign) => (
        <div className="flex min-w-36 flex-col gap-1">
          <ProgressBar
            label="Finished"
            value={campaign.finished_count}
            max={campaign.enrolled_count === 0 ? null : campaign.enrolled_count}
          />
          {campaign.enrolled_count > 0 && campaign.finished_count === campaign.enrolled_count && (
            <span className="text-xs text-success">All current enrollments finished</span>
          )}
          {campaign.finishing_count > 0 && (
            <span className="text-xs text-muted-foreground">
              {campaign.finishing_count} finishing after the last step
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (campaign) => {
        const action = primaryAction(campaign);
        return action ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={patch.isPending}
            onClick={() =>
              patch.mutate(
                { id: campaign.id, body: { status: action.status } },
                { onSuccess: () => toast.success(`${campaign.name} → ${action.status}`) },
              )
            }
          >
            {action.label}
          </Button>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
  ];

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Campaigns</h1>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="size-4" /> New Campaign
        </Button>
      </div>

      <CatchupBanner />

      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          description="A campaign pairs a sequence with the leads you enroll into it."
          actionLabel="New Campaign"
          onAction={() => setDialogOpen(true)}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={campaigns}
          rowKey={(campaign) => campaign.id}
          rowTestId={(campaign) => `campaign-row-${campaign.id}`}
        />
      )}

      <CampaignDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
