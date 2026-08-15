// Preflight at the API boundary (docs/16 §8 item 3). The unit suite covers the
// report logic; this covers that the route reads real configuration and that
// the DNS port is genuinely injectable — a preflight that quietly hit the
// network in tests would be flaky and would leak lookups from CI.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiHarness, type ApiHarness } from './helpers/app';
import type { DnsResolver } from '../../src/services/preflight';

/** Publishes nothing — every DNS check should degrade, none should throw. */
const emptyDns: DnsResolver = {
  resolveTxt: () => Promise.reject(new Error('ENOTFOUND')),
  resolveMx: () => Promise.reject(new Error('ENOTFOUND')),
};

let h: ApiHarness;

beforeAll(async () => {
  h = await createApiHarness({ dns: emptyDns });
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
});

const get = async () => (await h.inject({ method: 'GET', url: '/api/v1/system/preflight' })).json();
const statusOf = (body: { checks: { id: string; status: string }[] }, id: string) =>
  body.checks.find((c) => c.id === id)?.status;

describe('GET /system/preflight', () => {
  it('requires a session like every other /api/v1 route', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/system/preflight' });
    expect(res.statusCode).toBe(401);
  });

  it('reports not-ready with no mailboxes configured', async () => {
    const body = await get();
    expect(body.ready).toBe(false);
    expect(statusOf(body, 'mailbox_health')).toBe('fail');
  });

  it('reads the live compliance row — the seeded test address passes', async () => {
    expect(statusOf(await get(), 'compliance_address')).toBe('pass');
  });

  it('warns that the unsubscribe endpoint is dormant by default', async () => {
    expect(statusOf(await get(), 'unsubscribe_endpoint')).toBe('warn');
  });

  it('runs DNS checks per mailbox domain once a mailbox exists', async () => {
    await h.inject({
      method: 'POST',
      url: '/api/v1/mailboxes',
      payload: {
        display_name: 'Preflight Box',
        from_address: 'sam@preflight.test',
        smtp_host: 'smtp.test.dev',
        imap_host: 'imap.test.dev',
        password: 'app-password',
      },
    });

    const body = await get();
    // The injected resolver publishes nothing, so these are the honest answers.
    expect(statusOf(body, 'spf:preflight.test')).toBe('fail');
    expect(statusOf(body, 'dmarc:preflight.test')).toBe('fail');
    expect(statusOf(body, 'mx:preflight.test')).toBe('fail');
    expect(statusOf(body, 'dkim:preflight.test')).toBe('unknown');
    expect(body.ready).toBe(false);
  });

  it('changes nothing — it is a read-only report', async () => {
    const before = await h.inject({ method: 'GET', url: '/api/v1/settings' });
    await get();
    const after = await h.inject({ method: 'GET', url: '/api/v1/settings' });
    expect(after.json()).toEqual(before.json());
  });
});
