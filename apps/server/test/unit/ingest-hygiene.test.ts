// B5.3: hygiene pipeline (docs/09 §2) - first matching flag wins, in order.
import { describe, expect, it } from 'vitest';
import {
  flagRows,
  isSyntacticallyValid,
  normalizeEmail,
  ROLE_LOCAL_PARTS,
  type HygieneContext,
} from '../../src/ingest/hygiene';
import type { ParsedRow } from '../../src/ingest/parse';

const row = (email: string, firstName?: string, rowNo = 1): ParsedRow => ({
  rowNo,
  fields: { email, ...(firstName === undefined ? {} : { first_name: firstName }) },
  customFields: {},
});

const ctx = (over: Partial<HygieneContext> = {}): HygieneContext => ({
  existingLeadEmails: new Set(),
  suppressedEmails: new Set(),
  ...over,
});

describe('isSyntacticallyValid (docs/09 §2 #1)', () => {
  it.each([
    ['jo@acme.dev', true],
    ['j.o+tag@sub.acme.co', true],
    ['no-at-sign.dev', false],
    ['two@@acme.dev', false],
    ['@acme.dev', false], // empty local part
    ['jo@acmedev', false], // no dot in domain
    ['jo sp@acme.dev', false], // space
    ['jo@acme.d', false], // 1-char TLD
    ['jo@acme.123', false], // numeric TLD
    [`${'a'.repeat(250)}@x.dev`, false], // > 254 total
  ])('%s → %s', (email, ok) => {
    expect(isSyntacticallyValid(email)).toBe(ok);
  });
});

describe('flag order - first match wins', () => {
  it('invalid beats everything, even a suppressed address', () => {
    const [r] = flagRows(
      [row('not an email')],
      ctx({ suppressedEmails: new Set(['not an email']) }),
    );
    expect(r!.flag).toBe('invalid');
  });

  it('role_based beats duplicate and suppressed', () => {
    const [r] = flagRows(
      [row('info@acme.dev')],
      ctx({
        existingLeadEmails: new Set(['info@acme.dev']),
        suppressedEmails: new Set(['info@acme.dev']),
      }),
    );
    expect(r!.flag).toBe('role_based');
  });

  it('duplicate beats suppressed; missing_first_name is last', () => {
    const [r] = flagRows(
      [row('jo@acme.dev')],
      ctx({
        existingLeadEmails: new Set(['jo@acme.dev']),
        suppressedEmails: new Set(['jo@acme.dev']),
      }),
    );
    expect(r!.flag).toBe('duplicate');
    const [s] = flagRows([row('jo@acme.dev')], ctx({ suppressedEmails: new Set(['jo@acme.dev']) }));
    expect(s!.flag).toBe('suppressed'); // even though first_name is also missing
  });

  it('missing_first_name is importable and counted separately from ok', () => {
    const rows = flagRows([row('a@x.dev', 'Al'), row('b@x.dev'), row('c@x.dev', '   ')], ctx());
    expect(rows.map((r) => r.flag)).toEqual(['ok', 'missing_first_name', 'missing_first_name']);
  });
});

describe('duplicates within the file', () => {
  it('first occurrence kept; later ones flagged - normalization applies', () => {
    const rows = flagRows(
      [row('JO@Acme.dev ', 'Jo', 1), row('jo@acme.dev', 'Jo', 2), row('jo@acme.dev', 'Jo', 3)],
      ctx(),
    );
    expect(rows.map((r) => r.flag)).toEqual(['ok', 'duplicate', 'duplicate']);
    expect(rows[0]!.emailNormalized).toBe('jo@acme.dev');
  });

  it('an invalid row does not reserve its email for dup purposes', () => {
    const rows = flagRows([row('jo@acme'), row('jo@acme.dev', 'Jo')], ctx());
    expect(rows.map((r) => r.flag)).toEqual(['invalid', 'ok']);
  });
});

describe('role-based list', () => {
  it('covers the docs/09 list verbatim (spot checks + size)', () => {
    expect(ROLE_LOCAL_PARTS.size).toBe(34);
    for (const lp of ['info', 'no-reply', 'frontdesk', 'enquiries', 'accounting']) {
      expect(ROLE_LOCAL_PARTS.has(lp)).toBe(true);
    }
    const [r] = flagRows([row('Reception@office.dev', 'Pat')], ctx());
    expect(r!.flag).toBe('role_based');
  });
});

describe('normalizeEmail', () => {
  it('trims + lowercases (decision L)', () => {
    expect(normalizeEmail('  Jo.Smith@Acme.DEV ')).toBe('jo.smith@acme.dev');
  });
});
