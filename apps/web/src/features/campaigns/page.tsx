import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import type { CampaignDto } from '@coldemail/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
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
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Sequence</TableHead>
                <TableHead className="text-right text-xs">Enrolled</TableHead>
                <TableHead className="text-right text-xs">Contacted</TableHead>
                <TableHead className="w-48 text-xs">Progress</TableHead>
                <TableHead className="text-right text-xs">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((campaign) => {
                const action = primaryAction(campaign);
                return (
                  <TableRow key={campaign.id} data-testid={`campaign-row-${campaign.id}`}>
                    <TableCell className="py-1.5">
                      <Link
                        to={`/campaigns/${campaign.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {campaign.name}
                      </Link>
                      {campaign.recycled_from_campaign_id !== null && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          Pass 2 · recycled from #{campaign.recycled_from_campaign_id}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="py-1.5">
                      <CampaignStatusBadge status={campaign.status} />
                    </TableCell>
                    <TableCell className="py-1.5 text-xs text-muted-foreground">
                      {sequenceName(campaign.sequence_id) ?? (
                        <span className="text-destructive">none — cannot send</span>
                      )}
                    </TableCell>
                    <TableCell className="py-1.5 text-right text-sm tabular-nums">
                      {campaign.enrolled_count}
                    </TableCell>
                    <TableCell className="py-1.5 text-right text-sm tabular-nums">
                      {campaign.contacted_count}
                    </TableCell>
                    <TableCell className="py-1.5">
                      <ProgressBar
                        value={campaign.contacted_count}
                        max={campaign.enrolled_count === 0 ? null : campaign.enrolled_count}
                      />
                    </TableCell>
                    <TableCell className="py-1.5 text-right">
                      {action && (
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={patch.isPending}
                          onClick={() =>
                            patch.mutate(
                              { id: campaign.id, body: { status: action.status } },
                              {
                                onSuccess: () =>
                                  toast.success(`${campaign.name} → ${action.status}`),
                              },
                            )
                          }
                        >
                          {action.label}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <CampaignDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
