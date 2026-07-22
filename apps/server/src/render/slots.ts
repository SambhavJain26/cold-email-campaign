// Slot resolution (docs/08 §3): where {{custom_observation}} comes from,
// per enrollments.personalization_mode. Runs BEFORE merge-tag expansion —
// it computes the VALUE; merge.ts substitutes it like any other field.
import type { CheckItem, LeadLite, RenderContext } from './types';

export interface ObservationResolution {
  /** null = unresolvable → merge treats the tag as empty (fatal without fallback). */
  value: string | null;
  warning?: CheckItem;
}

function segmentRule(lead: LeadLite, ctx: RenderContext): string | null {
  const table = ctx.autoObservations;
  if (!table) return null;
  return (lead.state !== null ? table[lead.state] : undefined) ?? table['default'] ?? null;
}

export function resolveObservation(lead: LeadLite, ctx: RenderContext): ObservationResolution {
  switch (ctx.mode) {
    // Mode 2b: segment rule only.
    case 'template_auto':
      return { value: segmentRule(lead, ctx) };

    // Mode 2a — and Mode 1's template-driven FOLLOW-UPS ("follow-ups may fall
    // back to templates", docs/08 §3): operator-researched field first; empty
    // → segment rule + warning.
    case 'template_researched':
    case 'human_written': {
      const researched = ctx.customFields['custom_observation']?.trim();
      if (researched) return { value: researched };
      const fallback = segmentRule(lead, ctx);
      if (fallback !== null) {
        return {
          value: fallback,
          warning: {
            id: 'observation_fallback',
            message: 'custom_observation empty — segment rule used instead',
          },
        };
      }
      return { value: null };
    }
  }
}
