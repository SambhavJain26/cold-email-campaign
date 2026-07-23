import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CatchupBanner } from '@/components/shared/catchup-banner';
import { EmptyState } from '@/components/shared/empty-state';
import { EnrollPanel } from '@/components/shared/enroll-panel';
import { StateBadge } from '@/components/shared/state-badge';
import { useCampaignCapacity, useCampaignOutcomes, useCampaigns } from '@/api/queries/campaigns';
import { useOverview } from '@/api/queries/analytics';
import { useSequences } from '@/api/queries/sequences';
import { usePatchCampaign } from '@/api/mutations/campaigns';
import { CompletionPanel } from './completion-panel';
import { CampaignStatusBadge } from './status-badge';

const MODE_LABEL: Record<string, string> = {
  human_written: 'Mode 1 - human-written',
  template_researched: 'Mode 2 - researched slot',
  template_auto: 'Mode 2 - auto slot',
};

/** F5.2/F5.3 - Campaign detail (docs/12 §6): capacity + enroll, live state
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
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{campaign.name}</h1>
        <CampaignStatusBadge status={campaign.status} />
        {campaign.recycled_from_campaign_id !== null && (
          <Badge variant="outline" className="text-[10px]">
            Pass 2 · recycled from #{campaign.recycled_from_campaign_id}
          </Badge>
        )}
        <div className="ml-auto flex gap-2">
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
          <Button size="sm" variant="ghost" onClick={() => navigate('/campaigns')}>
            Back to list
          </Button>
        </div>
      </div>

      <CatchupBanner />

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
                    <span className="text-destructive">none - cannot send</span>
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
                  {campaign.ramp_config.ramp_days} days ·{' '}
                  {campaign.ramp_config.ramp_daily_enroll_cap}/day cap
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              Effort and ramp are fixed at creation - PATCH /campaigns carries name and status only,
              so changing them means a new campaign.
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
    </div>
  );
}
