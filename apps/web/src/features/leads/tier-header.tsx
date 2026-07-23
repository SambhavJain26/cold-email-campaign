import { useQueries } from '@tanstack/react-query';
import { leadsListResponseSchema, LEAD_TIERS, type LeadTier } from '@coldemail/shared';
import { TierBadge } from '@/components/shared/tier-badge';
import { apiFetch } from '@/api/client';

/** F3.1 — the Stage-2 tier-distribution panel. The contract has no tier-counts
 *  meta, so each tier's `total` comes from a per_page=1 probe of the same
 *  filtered endpoint the table uses — counts can never drift from the list. */
export function TierHeader({ total, untiered }: { total: number; untiered: number }) {
  const probes = useQueries({
    queries: LEAD_TIERS.map((tier) => ({
      queryKey: ['leads', 'tier-count', tier],
      queryFn: () =>
        apiFetch('/leads', leadsListResponseSchema, { query: { tier, page: 1, per_page: 1 } }),
      staleTime: 30_000,
    })),
  });

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-card px-4 py-3">
      {LEAD_TIERS.map((tier: LeadTier, i) => (
        <div key={tier} className="flex items-center gap-2 text-sm">
          <TierBadge tier={tier} />
          <span className="font-semibold tabular-nums" data-testid={`tier-count-${tier}`}>
            {probes[i]?.data?.total ?? '–'}
          </span>
          {total > 0 && probes[i]?.data && (
            <span className="text-xs text-muted-foreground">
              ({Math.round(((probes[i]!.data!.total ?? 0) / total) * 100)}%)
            </span>
          )}
        </div>
      ))}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">untiered</span>
        <span className="font-semibold tabular-nums">{untiered}</span>
      </div>
      <div className="ml-auto text-sm text-muted-foreground">
        {total} <span className="text-xs">total</span>
      </div>
    </div>
  );
}
