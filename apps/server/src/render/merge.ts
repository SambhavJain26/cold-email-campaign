// Merge-tag expansion + fallbacks (docs/08 §2). Field resolution order:
// built-ins (first_name, company, market, custom_observation,
// sender_physical_address) then leads.custom_fields keys. A field that is
// unknown, or empty after trim, renders its fallback; with NO fallback it is
// a FATAL check failure - the raw tag is left in the output so previews show
// exactly what failed.
import { STATE_NAMES } from './market';
import type { TemplateToken } from './template';
import type { CheckItem, LeadLite, RenderContext } from './types';

export type FieldResolver = (field: string, fallback: string | null) => string;

function rawValue(
  field: string,
  lead: LeadLite,
  ctx: RenderContext,
  observation: string | null,
): string | null | undefined {
  switch (field) {
    case 'first_name':
      return lead.firstName;
    case 'company':
      return lead.company;
    case 'market':
      return lead.state !== null ? (STATE_NAMES[lead.state] ?? null) : null;
    case 'custom_observation':
      return observation;
    // Always compliance settings, never lead data (docs/08 §2).
    case 'sender_physical_address':
      return ctx.compliance.physicalAddress;
    default:
      return ctx.customFields[field]; // undefined = unknown field
  }
}

/** Build a resolver that collects fatal check items into `fatals`. */
export function makeResolver(
  lead: LeadLite,
  ctx: RenderContext,
  observation: string | null,
  fatals: CheckItem[],
): FieldResolver {
  return (field, fallback) => {
    const value = rawValue(field, lead, ctx, observation);
    const usable = typeof value === 'string' && value.trim() !== '';
    if (usable) return value.trim();
    if (fallback !== null) return fallback;
    fatals.push({
      id: 'merge_tag',
      message:
        value === undefined
          ? `unknown field '${field}' with no fallback`
          : `'${field}' is empty and the tag has no fallback`,
    });
    return `{{${field}}}`; // leave the failure visible in preview output
  };
}

/** Walk a token stream: tags via `resolve`, spintax via `pick`. */
export function expandTokens(
  tokens: TemplateToken[],
  resolve: FieldResolver,
  pick: (options: string[]) => string,
): string {
  let out = '';
  for (const t of tokens) {
    if (t.kind === 'text') out += t.value;
    else if (t.kind === 'tag') out += resolve(t.field, t.fallback);
    else out += pick(t.options);
  }
  return out;
}
