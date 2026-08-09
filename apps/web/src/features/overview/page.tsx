import { AlertTriangle } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { CatchupBanner } from '@/components/shared/catchup-banner';
import { EmptyState } from '@/components/shared/empty-state';
import { EnrollPanel } from '@/components/shared/enroll-panel';
import { MetricStat } from '@/components/shared/metric-stat';
import { ProgressBar } from '@/components/shared/progress-bar';
import { useCampaignParam } from '@/components/layout/campaign-selector';
import { useOverview, useHealthTrend } from '@/api/queries/analytics';
import { useCampaignOutcomes, useCampaigns } from '@/api/queries/campaigns';
import { estimateCompletion } from './estimate';
import { useSystemStatus } from '@/api/queries/system';

/** Hard-bounce watch threshold (docs/05 §5) — the ✅/⚠️ on the tile. */
const HARD_BOUNCE_WATCH_PCT = 4;

/** F5.4 — Overview (docs/12 §1, walkthrough §11). */
export default function OverviewPage() {
  const navigate = useNavigate();
  const campaigns = useCampaigns();
  const selected = useCampaignParam();
  // The selector writes ?campaign=; with none chosen yet, show the first campaign
  // rather than an empty screen.
  const campaignId = selected ?? campaigns.data?.items[0]?.id;
  const campaign = campaigns.data?.items.find((c) => c.id === campaignId);

  const overview = useOverview(campaignId ?? 0);
  const health = useHealthTrend(30, campaignId);
  const outcomes = useCampaignOutcomes(campaignId ?? 0);
  const system = useSystemStatus();

  if (campaigns.isPending) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (campaignId === undefined) {
    return (
      <div className="p-6">
        <EmptyState
          title="No campaigns yet"
          description="Create a campaign to start enrolling leads and tracking results."
          actionLabel="Create campaign"
          onAction={() => navigate('/campaigns')}
        />
      </div>
    );
  }
  if (overview.isPending) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (overview.isError) {
    return (
      <div className="p-6">
        <EmptyState
          title="Failed to load overview"
          actionLabel="Retry"
          onAction={() => overview.refetch()}
        />
      </div>
    );
  }

  const data = overview.data;
  const estimate = estimateCompletion(
    data.progress.contacted,
    data.progress.total,
    health.data?.items ?? [],
  );
  const complete =
    outcomes.data !== undefined &&
    outcomes.data.total > 0 &&
    outcomes.data.ACTIVE === 0 &&
    outcomes.data.NEW === 0;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold">Overview</h1>
          {campaign && <span className="text-sm text-muted-foreground">· {campaign.name}</span>}
        </div>
        <Link to={`/campaigns/${campaignId}`} className="text-xs text-muted-foreground underline">
          Campaign detail
        </Link>
      </div>

      <CatchupBanner />

      {(system.data?.send_blockers ?? []).map((blocker) => (
        <Alert key={blocker.code} variant="destructive">
          <AlertTitle>Sending blocked</AlertTitle>
          <AlertDescription>{blocker.message}</AlertDescription>
        </Alert>
      ))}

      {data.watch_flags.map((flag) => (
        <div
          key={flag}
          role="status"
          data-testid="watch-flag"
          className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs"
        >
          <AlertTriangle className="size-4 text-warning" aria-hidden />
          <span>{flag.replaceAll('_', ' ')} — check Analytics → Health.</span>
        </div>
      ))}

      <section className="rounded-lg border border-border bg-card p-4">
        <ProgressBar
          label="Contacted"
          value={data.progress.contacted}
          max={data.progress.total}
          className="max-w-xl"
        />
        {estimate && (
          <p
            className="mt-2 text-xs text-muted-foreground"
            data-testid="est-completion"
            title={`${estimate.remaining} remaining / ${estimate.perDay} per day = ${estimate.days} days`}
          >
            ≈{estimate.days} {estimate.days === 1 ? 'day' : 'days'} left at the last-7-day pace (
            {estimate.perDay} delivered/day).
          </p>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricStat label="Reply rate" metric={data.reply_rate} />
        <MetricStat label="Positive rate" metric={data.positive_rate} />
        <MetricStat
          label="Meetings"
          metric={{ numerator: data.meetings.count, denominator: null, value: data.meetings.count }}
          unit=""
          hint={
            <span className="text-muted-foreground">
              · {data.meetings.per_100} per 100 contacted
            </span>
          }
        />
        <MetricStat
          label="Hard-bounce rate"
          metric={data.hard_bounce_rate}
          hint={data.hard_bounce_rate.value > HARD_BOUNCE_WATCH_PCT ? '⚠️' : '✅'}
        />
        <MetricStat
          label="Unsubscribe rate"
          metric={data.unsubscribe_rate}
          hint={data.watch_flags.includes('unsubscribe_rate') ? '↑' : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="rounded-lg border border-border bg-card p-4">
          <EnrollPanel campaign={campaign} capacity={data.capacity} />
        </div>

        {complete && outcomes.data && (
          <section
            className="rounded-lg border border-border bg-card p-4"
            data-testid="overview-complete-card"
          >
            <h2 className="text-sm font-semibold">Campaign complete</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {outcomes.data.total} enrollments all terminal:{' '}
              {outcomes.data.REPLIED.positive + outcomes.data.REPLIED.neutral} replied,{' '}
              {outcomes.data.UNSUBSCRIBED} unsubscribed, {outcomes.data.BOUNCED} bounced,{' '}
              {outcomes.data.COMPLETED} finished without replying.
            </p>
            <Button size="sm" variant="outline" className="mt-3" asChild>
              <Link to={`/campaigns/${campaignId}`}>Open the completion report</Link>
            </Button>
          </section>
        )}
      </div>
    </div>
  );
}
