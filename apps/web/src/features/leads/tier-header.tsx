import { CURRENT_LEAD_TIERS, type CurrentLeadTier } from '@coldemail/shared';
import { TierBadge } from '@/components/shared/tier-badge';

type Counts = { A: number; B: number; untiered: number; nurture: number };

/** Exact distribution for the active list filter, supplied by the same API query. */
export function TierHeader({ total, counts }: { total: number; counts: Counts }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-card px-4 py-3">
      {CURRENT_LEAD_TIERS.map((tier: CurrentLeadTier) => (
        <div key={tier} className="flex items-center gap-2 text-sm">
          <TierBadge tier={tier} />
          <span className="font-semibold tabular-nums" data-testid={`tier-count-${tier}`}>
            {counts[tier]}
          </span>
          {total > 0 && (
            <span className="text-xs text-muted-foreground">
              ({Math.round((counts[tier] / total) * 100)}%)
            </span>
          )}
        </div>
      ))}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">untiered</span>
        <span className="font-semibold tabular-nums">{counts.untiered}</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Nurture</span>
        <span className="font-semibold tabular-nums">{counts.nurture}</span>
      </div>
      <div className="ml-auto text-sm text-muted-foreground">
        {total} <span className="text-xs">total</span>
      </div>
    </div>
  );
}
