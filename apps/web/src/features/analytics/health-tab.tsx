import type { DailySeriesRow } from '@coldemail/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { Sparkline } from '@/components/shared/sparkline';
import { useHealthTrend } from '@/api/queries/analytics';

/** docs/05 §5 watch thresholds — the ✅/⚠️ next to each rate. */
const HARD_BOUNCE_MAX_PCT = 4;
const UNSUBSCRIBE_MAX_PCT = 5;

interface Row {
  label: string;
  series: number[];
  /** Headline number with its own arithmetic spelled out. */
  value: string;
  detail: string;
  status: '✅' | '⚠️' | null;
}

function pct(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 10;
}

export function buildHealthRows(
  items: DailySeriesRow[],
  totals: {
    sent: number;
    delivered: number;
    replies: number;
    hard_bounces: number;
    unsubscribes: number;
  },
): Row[] {
  const replyPct = pct(totals.replies, totals.delivered);
  const bouncePct = pct(totals.hard_bounces, totals.sent);
  const unsubPct = pct(totals.unsubscribes, totals.delivered);
  return [
    {
      label: 'Sent',
      series: items.map((row) => row.sent),
      value: String(totals.sent),
      detail: `${items.length} days`,
      status: null,
    },
    {
      label: 'Delivered',
      series: items.map((row) => row.delivered),
      value: String(totals.delivered),
      detail: `${totals.delivered} / ${totals.sent} sent`,
      status: null,
    },
    {
      label: 'Reply rate',
      series: items.map((row) => row.replies),
      value: `${replyPct}%`,
      detail: `${totals.replies} / ${totals.delivered} delivered`,
      status: null,
    },
    {
      label: 'Hard-bounce rate',
      series: items.map((row) => row.hard_bounces),
      value: `${bouncePct}%`,
      detail: `${totals.hard_bounces} / ${totals.sent} sent · threshold ${HARD_BOUNCE_MAX_PCT}%`,
      status: bouncePct > HARD_BOUNCE_MAX_PCT ? '⚠️' : '✅',
    },
    {
      label: 'Unsubscribe rate',
      series: items.map((row) => row.unsubscribes),
      value: `${unsubPct}%`,
      detail: `${totals.unsubscribes} / ${totals.delivered} delivered · threshold ${UNSUBSCRIBE_MAX_PCT}%`,
      status: unsubPct > UNSUBSCRIBE_MAX_PCT ? '⚠️' : '✅',
    },
  ];
}

/** F7.4 — 13d health trend: sparklines off the daily series + the watch rules. */
export function HealthTab({ campaignId }: { campaignId: number }) {
  const { data, isPending, isError, refetch } = useHealthTrend(30, campaignId);

  if (isPending) return <Skeleton className="h-64 w-full" />;
  if (isError) {
    return (
      <EmptyState
        title="Failed to load health trend"
        actionLabel="Retry"
        onAction={() => refetch()}
      />
    );
  }

  const rows = buildHealthRows(data.items, data.totals);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border" data-testid="health-rows">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 border-b border-border/60 px-4 py-3 last:border-b-0 sm:grid-cols-[10rem_10rem_auto_auto_1fr]"
          >
            <span className="text-xs text-muted-foreground">{row.label}</span>
            <span className="text-right text-sm font-semibold tabular-nums sm:col-start-3 sm:row-start-1">
              {row.value}
            </span>
            <div className="col-span-2 h-8 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
              <Sparkline
                data={row.series}
                label={`${row.label} daily trend over ${row.series.length} days: ${row.series.join(', ')}`}
              />
            </div>
            {row.status && <span>{row.status}</span>}
            <span className="col-span-2 text-xs text-muted-foreground tabular-nums sm:col-span-1 sm:ml-auto">
              {row.detail}
            </span>
          </div>
        ))}
      </div>

      <section className="space-y-1" data-testid="watch-rules">
        <h3 className="text-sm font-semibold">Watch rules</h3>
        {data.watch_flags.length === 0 ? (
          <p className="text-xs text-success">Status: healthy. No action needed.</p>
        ) : (
          data.watch_flags.map((flag) => (
            <p key={flag.rule} className="text-xs text-warning" role="status">
              ⚠️ {flag.message}
            </p>
          ))
        )}
        <p className="pt-1 text-xs text-muted-foreground">
          A climbing unsubscribe rate is the early warning — it usually moves before deliverability
          visibly slips.
        </p>
      </section>
    </div>
  );
}
