// Domain-readiness preflight (0011-era, docs/16 §8 item 3). The resolver is a
// port precisely so this runs with no network — and so the DEGRADED cases
// (lookup throws, selector unknown) can be asserted, which is where a naive
// implementation would report a confident but wrong answer.
import { describe, expect, it } from 'vitest';
import { runPreflight, type DnsResolver, type PreflightInput } from '../../src/services/preflight';

/** Records keyed by hostname; a missing key throws the way dns/promises does. */
function fakeDns(txt: Record<string, string[]>, mx: Record<string, number> = {}): DnsResolver {
  return {
    resolveTxt: (hostname) => {
      const found = txt[hostname];
      if (!found) return Promise.reject(new Error('ENOTFOUND'));
      return Promise.resolve(found.map((r) => [r]));
    },
    resolveMx: (hostname) => {
      const count = mx[hostname];
      if (!count) return Promise.reject(new Error('ENOTFOUND'));
      return Promise.resolve(
        Array.from({ length: count }, (_, i) => ({ exchange: `mx${i}.${hostname}`, priority: 10 })),
      );
    },
  };
}

const READY: PreflightInput = {
  physicalAddress: '106-460 Doyle Ave, Kelowna, BC',
  unsubscribeBaseUrl: 'https://unsubscribe.outreach.test',
  minRampDays: 7,
  maxMailboxDailyCap: 50,
  mailboxes: [{ fromAddress: 'sam@outreach.test', status: 'ok', dailyCap: 30 }],
};

const FULL_DNS = fakeDns(
  {
    'outreach.test': ['v=spf1 include:_spf.google.com ~all'],
    '_dmarc.outreach.test': ['v=DMARC1; p=none; rua=mailto:d@outreach.test'],
    'google._domainkey.outreach.test': ['v=DKIM1; k=rsa; p=MIIBI...'],
  },
  { 'outreach.test': 2 },
);

const statusOf = (r: Awaited<ReturnType<typeof runPreflight>>, id: string) =>
  r.checks.find((c) => c.id === id)?.status;

describe('a fully configured domain', () => {
  it('is ready with every DNS check passing', async () => {
    const r = await runPreflight(READY, FULL_DNS);
    expect(r.ready).toBe(true);
    expect(statusOf(r, 'spf:outreach.test')).toBe('pass');
    expect(statusOf(r, 'dmarc:outreach.test')).toBe('pass');
    expect(statusOf(r, 'dkim:outreach.test')).toBe('pass');
    expect(statusOf(r, 'mx:outreach.test')).toBe('pass');
  });

  it('checks each distinct domain once, not once per mailbox', async () => {
    const r = await runPreflight(
      {
        ...READY,
        mailboxes: [
          { fromAddress: 'a@outreach.test', status: 'ok', dailyCap: 30 },
          { fromAddress: 'b@outreach.test', status: 'ok', dailyCap: 30 },
        ],
      },
      FULL_DNS,
    );
    expect(r.checks.filter((c) => c.id === 'spf:outreach.test')).toHaveLength(1);
  });
});

describe('DNS gaps block readiness', () => {
  it('missing SPF, DMARC and MX all fail', async () => {
    const r = await runPreflight(READY, fakeDns({}, {}));
    expect(r.ready).toBe(false);
    expect(statusOf(r, 'spf:outreach.test')).toBe('fail');
    expect(statusOf(r, 'dmarc:outreach.test')).toBe('fail');
    expect(statusOf(r, 'mx:outreach.test')).toBe('fail');
  });

  it('an unfindable DKIM selector is UNKNOWN, never fail', async () => {
    // Selectors cannot be enumerated over DNS. Reporting "fail" here would be
    // a confident wrong answer, and would block a correctly configured domain.
    const r = await runPreflight(
      READY,
      fakeDns(
        {
          'outreach.test': ['v=spf1 ~all'],
          '_dmarc.outreach.test': ['v=DMARC1; p=none'],
        },
        { 'outreach.test': 1 },
      ),
    );
    expect(statusOf(r, 'dkim:outreach.test')).toBe('unknown');
    expect(r.ready).toBe(true); // unknown does not block
    expect(r.checks.find((c) => c.id === 'dkim:outreach.test')?.detail).toContain(
      'not proof DKIM is missing',
    );
  });

  it('finds a key published under a non-Google selector', async () => {
    const r = await runPreflight(
      READY,
      fakeDns(
        {
          'outreach.test': ['v=spf1 ~all'],
          '_dmarc.outreach.test': ['v=DMARC1; p=none'],
          'selector2._domainkey.outreach.test': ['v=DKIM1; p=abc'],
        },
        { 'outreach.test': 1 },
      ),
    );
    expect(statusOf(r, 'dkim:outreach.test')).toBe('pass');
  });
});

describe('configuration checks', () => {
  it('an empty compliance address fails — it halts all sending', async () => {
    const r = await runPreflight({ ...READY, physicalAddress: '  ' }, FULL_DNS);
    expect(statusOf(r, 'compliance_address')).toBe('fail');
    expect(r.ready).toBe(false);
  });

  it('a dormant unsubscribe endpoint warns but does not block', async () => {
    const r = await runPreflight({ ...READY, unsubscribeBaseUrl: '' }, FULL_DNS);
    expect(statusOf(r, 'unsubscribe_endpoint')).toBe('warn');
    expect(r.ready).toBe(true);
  });

  it('min_ramp_days = 0 warns that a campaign could enrol everything on day one', async () => {
    const r = await runPreflight({ ...READY, minRampDays: 0 }, FULL_DNS);
    expect(statusOf(r, 'staged_enrollment')).toBe('warn');
  });

  it('no mailboxes at all fails', async () => {
    const r = await runPreflight({ ...READY, mailboxes: [] }, FULL_DNS);
    expect(statusOf(r, 'mailbox_health')).toBe('fail');
    expect(r.ready).toBe(false);
  });

  it('an unhealthy mailbox fails', async () => {
    const r = await runPreflight(
      {
        ...READY,
        mailboxes: [{ fromAddress: 'a@outreach.test', status: 'auth_failed', dailyCap: 30 }],
      },
      FULL_DNS,
    );
    expect(statusOf(r, 'mailbox_health')).toBe('fail');
  });

  it('a pre-existing over-guardrail cap warns rather than failing', async () => {
    // 0011 does not retroactively refuse existing rows, so the preflight has
    // to surface them without pretending they are a hard block.
    const r = await runPreflight(
      { ...READY, mailboxes: [{ fromAddress: 'a@outreach.test', status: 'ok', dailyCap: 400 }] },
      FULL_DNS,
    );
    expect(statusOf(r, 'mailbox_caps')).toBe('warn');
    expect(r.ready).toBe(true);
  });
});
