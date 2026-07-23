import { Check, Recycle, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { OutcomesResponse, OverviewResponse } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import { MetricStat } from '@/components/shared/metric-stat';

/** Terminal states are mutually exclusive and must sum to the enrolled total —
 *  the reconciliation is the point of the Stage-9 report, so it is shown, not assumed. */
export function outcomeRows(outcomes: OutcomesResponse): Array<[string, number]> {
  return [
    ['Replied — positive', outcomes.REPLIED.positive],
    ['Replied — neutral/negative', outcomes.REPLIED.neutral],
    ['Unsubscribed', outcomes.UNSUBSCRIBED],
    ['Hard bounced', outcomes.BOUNCED],
    ['Completed (no reply)', outcomes.COMPLETED],
  ];
}

export function outcomesSum(outcomes: OutcomesResponse): number {
  return outcomeRows(outcomes).reduce((sum, [, count]) => sum + count, 0);
}

/** F5.3 — completion panel (walkthrough Stage 9): the outcomes table that sums to
 *  the total, the event-based rates, and the two ways forward. */
export function CompletionPanel({
  outcomes,
  overview,
  campaignId,
}: {
  outcomes: OutcomesResponse;
  overview: OverviewResponse | undefined;
  campaignId: number;
}) {
  const sum = outcomesSum(outcomes);
  const reconciles = sum === outcomes.total;

  return (
    <section
      className="space-y-4 rounded-lg border border-border bg-card p-4"
      data-testid="completion-panel"
    >
      <div>
        <h2 className="text-sm font-semibold">Campaign complete</h2>
        <p className="text-xs text-muted-foreground">
          Every enrollment reached a terminal state — nothing is scheduled to send.
        </p>
      </div>

      <table className="w-full text-sm">
        <tbody>
          {outcomeRows(outcomes).map(([label, count]) => (
            <tr key={label} className="border-b border-border/60">
              <td className="py-1 text-muted-foreground">{label}</td>
              <td className="py-1 text-right tabular-nums">{count}</td>
            </tr>
          ))}
          <tr>
            <td className="py-1 font-medium">Total enrolled</td>
            <td className="py-1 text-right font-semibold tabular-nums" data-testid="outcomes-total">
              {sum} / {outcomes.total}{' '}
              {reconciles ? (
                <Check className="inline size-3.5 text-success" aria-label="reconciles" />
              ) : (
                <span className="text-destructive">✗ does not reconcile</span>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      {overview && (
        <div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <MetricStat label="Reply rate" metric={overview.reply_rate} />
            <MetricStat label="Positive rate" metric={overview.positive_rate} />
            <MetricStat label="Unsubscribe rate" metric={overview.unsubscribe_rate} />
            <MetricStat label="Hard-bounce rate" metric={overview.hard_bounce_rate} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Rates are event-based and may overlap — one lead can reply and later unsubscribe, so
            these percentages do not sum to 100%. The table above is the mutually-exclusive view.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" asChild>
          <Link to={`/cold-storage?campaign=${campaignId}`}>
            <Recycle className="size-4" /> Recycle cold storage
          </Link>
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link to="/leads">
            <Upload className="size-4" /> Import fresh leads
          </Link>
        </Button>
      </div>
    </section>
  );
}
