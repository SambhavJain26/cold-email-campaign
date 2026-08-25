import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ConfirmTypedDialog } from '@/components/shared/confirm-typed-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { CatchupBanner } from '@/components/shared/catchup-banner';
import { EmptyState } from '@/components/shared/empty-state';
import { EnrollPanel } from '@/components/shared/enroll-panel';
import { StateBadge } from '@/components/shared/state-badge';
import { useCampaignCapacity, useCampaignOutcomes, useCampaigns } from '@/api/queries/campaigns';
import { useOverview } from '@/api/queries/analytics';
import { useSequences } from '@/api/queries/sequences';
import { useDeleteCampaign, usePatchCampaign } from '@/api/mutations/campaigns';
import { CompletionPanel } from './completion-panel';
import { CampaignStatusBadge } from './status-badge';
import { DraftConfigurationEditor } from './draft-configuration';
import { useState } from 'react';

const MODE_LABEL: Record<string, string> = {
  human_written: 'Mode 1 — human-written',
  template_researched: 'Mode 2 — researched slot',
  template_auto: 'Mode 2 — auto slot',
};

/** F5.2/F5.3 — Campaign detail (docs/12 §6): capacity + enroll, live state
 *  breakdown, and the Stage-9 completion panel once everything is terminal. */
export default function CampaignDetailPage() {
  const { id } = useParams();
  const campaignId = Number(id);
  const navigate = useNavigate();
  const campaigns = useCampaigns();
  const sequences = useSequences();
  const capacity = useCampaignCapacity(campaignId);
  const outcomes = useCampaignOutcomes(campaignId);
  const overview = useOverview(campaignId);
  const patch = usePatchCampaign();
  const remove = useDeleteCampaign();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (campaigns.isPending) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (campaigns.isError) {
    return (
      <div className="p-6">
        <EmptyState
          title="Failed to load campaign"
          actionLabel="Retry"
          onAction={() => campaigns.refetch()}
        />
      </div>
    );
  }

  const campaign = campaigns.data.items.find((c) => c.id === campaignId);
  if (!campaign) {
    return (
      <div className="p-6">
        <EmptyState
          title="Campaign not found"
          actionLabel="Back to campaigns"
          onAction={() => navigate('/campaigns')}
        />
      </div>
    );
  }

  const sequence = sequences.data?.items.find((s) => s.id === campaign.sequence_id);
  const complete =
    outcomes.data !== undefined &&
    outcomes.data.total > 0 &&
    outcomes.data.ACTIVE === 0 &&
    outcomes.data.NEW === 0;

  const setStatus = (status: 'active' | 'paused' | 'archived') =>
    patch.mutate(
      { id: campaign.id, body: { status } },
      { onSuccess: () => toast.success(`${campaign.name} → ${status}`) },
    );

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{campaign.name}</h1>
        <CampaignStatusBadge status={campaign.status} />
        {campaign.recycle_sources.length > 0 && (
          <Badge variant="outline" className="text-[10px]">
            Recycled from{' '}
            {campaign.recycle_sources
              .map((source) => `${source.name} (${source.contributed_leads})`)
              .join(', ')}
          </Badge>
        )}
        <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
          {campaign.status === 'draft' && (
            <Button size="sm" onClick={() => setStatus('active')}>
              Activate
            </Button>
          )}
          {campaign.status === 'active' && (
            <Button size="sm" variant="outline" onClick={() => setStatus('paused')}>
              Pause
            </Button>
          )}
          {campaign.status === 'paused' && (
            <Button size="sm" onClick={() => setStatus('active')}>
              Resume
            </Button>
          )}
          {campaign.status !== 'archived' && (
            <Button size="sm" variant="destructive" onClick={() => setArchiveOpen(true)}>
              Archive
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setDeleteOpen(true)}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate('/campaigns')}>
            Back to list
          </Button>
        </div>
      </div>

      <CatchupBanner />

      {campaign.status === 'draft' && <DraftConfigurationEditor campaign={campaign} />}

      {campaign.tier_effort_config.A === 'human_written' && (
        <Alert>
          <AlertTitle>Tier A is manual-only</AlertTitle>
          <AlertDescription>
            The scheduler will not send {campaign.manual_only_count} active Tier A enrollment
            {campaign.manual_only_count === 1 ? '' : 's'}. Open an individual Tier A lead and use
            Manual compose to write and send it.{' '}
            <Link
              to={`/leads?campaign=${campaign.id}`}
              className="font-medium underline underline-offset-2"
            >
              Open campaign leads
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="rounded-lg border border-border bg-card p-4">
          {capacity.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : capacity.isError ? (
            <EmptyState
              title="Capacity unavailable"
              actionLabel="Retry"
              onAction={() => capacity.refetch()}
            />
          ) : (
            <EnrollPanel campaign={campaign} capacity={capacity.data} />
          )}
        </div>

        <div className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Enrollment breakdown</h2>
            {outcomes.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : outcomes.isError ? (
              <EmptyState
                title="Outcomes unavailable"
                actionLabel="Retry"
                onAction={() => outcomes.refetch()}
              />
            ) : (
              <div className="flex flex-wrap gap-4" data-testid="state-breakdown">
                {(
                  [
                    ['NEW', outcomes.data.NEW],
                    ['ACTIVE', outcomes.data.ACTIVE],
                    ['REPLIED', outcomes.data.REPLIED.positive + outcomes.data.REPLIED.neutral],
                    ['BOUNCED', outcomes.data.BOUNCED],
                    ['UNSUBSCRIBED', outcomes.data.UNSUBSCRIBED],
                    ['COMPLETED', outcomes.data.COMPLETED],
                  ] as const
                ).map(([state, count]) => (
                  <div key={state} className="space-y-1">
                    <StateBadge state={state} />
                    <p className="text-lg font-semibold tabular-nums">{count}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Configuration</h2>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Sequence</dt>
                <dd>
                  {campaign.sequence_id === null ? (
                    <span className="text-destructive">none — cannot send</span>
                  ) : (
                    <Link to={`/sequences/${campaign.sequence_id}`} className="hover:underline">
                      {sequence?.name ?? `#${campaign.sequence_id}`}
                    </Link>
                  )}
                </dd>
              </div>
              {(['A', 'B', 'C'] as const).map((tier) => (
                <div key={tier} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Tier {tier} effort</dt>
                  <dd>
                    {MODE_LABEL[campaign.tier_effort_config[tier]] ??
                      campaign.tier_effort_config[tier]}
                  </dd>
                </div>
              ))}
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Ramp</dt>
                <dd className="tabular-nums">
                  {campaign.ramp_stages
                    .map(
                      (stage) =>
                        `${stage.start_day}${stage.end_day === stage.start_day ? '' : `–${stage.end_day}`}: ${stage.cap}`,
                    )
                    .join(' · ')}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              {campaign.first_activated_at
                ? `Frozen on first activation ${new Date(campaign.first_activated_at).toLocaleString()}. Pausing does not restart the ramp calendar.`
                : 'Editable while draft. First activation freezes effort, observations, variables, and ramp permanently.'}
            </p>
          </section>
        </div>
      </div>

      {complete && outcomes.data && (
        <CompletionPanel
          outcomes={outcomes.data}
          overview={overview.data}
          campaignId={campaign.id}
        />
      )}
      <ConfirmTypedDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive campaign"
        description="Archiving immediately stops all future scheduling for this campaign. Type the campaign name to confirm."
        expected={campaign.name}
        confirmLabel="Archive campaign"
        pending={patch.isPending}
        onConfirm={() =>
          patch.mutate(
            { id: campaign.id, body: { status: 'archived' } },
            {
              onSuccess: () => {
                toast.success(`${campaign.name} archived`);
                setArchiveOpen(false);
              },
            },
          )
        }
      />
      <ConfirmTypedDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete campaign"
        description="Deletion is allowed only while this campaign has no event history or remaining references. Type the campaign name to confirm."
        expected={campaign.name}
        confirmLabel="Delete campaign"
        pending={remove.isPending}
        onConfirm={(typed) =>
          remove.mutate(
            { id: campaign.id, confirm: typed },
            {
              onSuccess: () => {
                toast.success(`${campaign.name} deleted`);
                navigate('/campaigns');
              },
            },
          )
        }
      />
    </div>
  );
}
