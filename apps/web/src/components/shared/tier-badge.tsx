import type { LeadTier } from '@coldemail/shared';
import { cn } from '@/lib/utils';

/** The walkthrough's exact tier glyphs (docs/11 §5): 🟢 A · 🟡 B · ⚪ C · 🔵 nurture. */
const GLYPH: Record<LeadTier, string> = {
  A: '🟢',
  B: '🟡',
  C: '⚪',
  nurture: '🔵',
};

export function TierBadge({ tier, className }: { tier: LeadTier | null; className?: string }) {
  if (tier === null) {
    return (
      <span className={cn('text-xs text-muted-foreground', className)} data-tier="untiered">
       - untiered
      </span>
    );
  }
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-xs font-medium', className)}
      data-tier={tier}
    >
      <span aria-hidden>{GLYPH[tier]}</span>
      {tier === 'nurture' ? 'Nurture' : `Tier ${tier}`}
    </span>
  );
}
