// Hygiene pipeline (docs/09 §2): per row, in order - FIRST matching flag
// wins, later checks skipped. Pure; the caller supplies the DB-derived sets
// (existing lead emails, suppressed emails).
import type { ParsedRow } from './parse';

export type HygieneFlag =
  'invalid' | 'role_based' | 'duplicate' | 'suppressed' | 'missing_first_name' | 'ok';

// Local part ∈ this set = role_based (docs/09 §2, verbatim list).
export const ROLE_LOCAL_PARTS = new Set([
  'info',
  'sales',
  'admin',
  'administrator',
  'support',
  'contact',
  'contactus',
  'office',
  'hello',
  'team',
  'billing',
  'hr',
  'careers',
  'jobs',
  'marketing',
  'press',
  'media',
  'help',
  'enquiries',
  'inquiries',
  'mail',
  'postmaster',
  'webmaster',
  'noreply',
  'no-reply',
  'donotreply',
  'abuse',
  'security',
  'privacy',
  'legal',
  'accounts',
  'accounting',
  'frontdesk',
  'reception',
]);

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Syntactic check only (docs/09 §2 - no MX/SMTP verification, deliberate
 * non-goal): one '@', non-empty local, domain has ≥1 dot, no spaces,
 * total ≤ 254, TLD ≥ 2 alpha.
 */
export function isSyntacticallyValid(email: string): boolean {
  if (email.length === 0 || email.length > 254) return false;
  if (/\s/.test(email)) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return false;
  const domain = email.slice(at + 1);
  if (!domain.includes('.')) return false;
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  return /^[a-z]{2,}$/i.test(tld);
}

export interface FlaggedRow extends ParsedRow {
  emailNormalized: string;
  flag: HygieneFlag;
}

export interface HygieneContext {
  /** Normalized emails already in `leads`. */
  existingLeadEmails: ReadonlySet<string>;
  /** Normalized emails in `suppressions` - compliance-critical (docs/09 §2 #4). */
  suppressedEmails: ReadonlySet<string>;
}

export function flagRows(rows: ParsedRow[], ctx: HygieneContext): FlaggedRow[] {
  const seenInFile = new Set<string>();
  return rows.map((row) => {
    const email = normalizeEmail(row.fields.email ?? '');
    const flag = flagOne(row, email, seenInFile, ctx);
    if (flag !== 'invalid') seenInFile.add(email);
    return { ...row, emailNormalized: email, flag };
  });
}

function flagOne(
  row: ParsedRow,
  email: string,
  seenInFile: ReadonlySet<string>,
  ctx: HygieneContext,
): HygieneFlag {
  if (!isSyntacticallyValid(email)) return 'invalid';
  if (ROLE_LOCAL_PARTS.has(email.slice(0, email.indexOf('@')))) return 'role_based';
  if (seenInFile.has(email) || ctx.existingLeadEmails.has(email)) return 'duplicate';
  if (ctx.suppressedEmails.has(email)) return 'suppressed';
  if ((row.fields.first_name ?? '').trim() === '') return 'missing_first_name';
  return 'ok';
}
