// Public unsubscribe endpoint (0010, docs/16 §8). The only unauthenticated
// write surface in the product, so the tests here are about what it REFUSES to
// do as much as what it does: no unsubscribing on GET, no token enumeration,
// no session/CSRF requirement (Gmail's one-click POST has neither), no PII in
// logs, and no duplicate facts in an append-only ledger.
import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiHarness, type ApiHarness } from './helpers/app';
import { seedMailboxes } from '../helpers/db';
import { issueToken } from '../../src/db/repos/unsubscribeTokensRepo';

const LOG_LINES: string[] = [];
const collector = new Writable({
  write(chunk, _enc, cb) {
    LOG_LINES.push(String(chunk));
    cb();
  },
});

let h: ApiHarness;

/** A campaign + lead + ACTIVE enrollment, returning the ids a token needs. */
async function seedEnrollment(email: string) {
  const lead = await h.pool.query(`INSERT INTO leads (email) VALUES ($1) RETURNING id`, [email]);
  const campaign = await h.pool.query(
    `INSERT INTO campaigns (name, status) VALUES ('Unsub Test', 'active') RETURNING id`,
  );
  const leadId = lead.rows[0].id as number;
  const campaignId = campaign.rows[0].id as number;
  const enrollment = await h.pool.query(
    `INSERT INTO enrollments (lead_id, campaign_id, assigned_mailbox_id, current_state,
                              current_step_no, personalization_mode, enrolled_at)
     VALUES ($1, $2, 1, 'ACTIVE', 1, 'template_auto', now()) RETURNING id`,
    [leadId, campaignId],
  );
  return { leadId, campaignId, enrollmentId: enrollment.rows[0].id as number };
}

async function mintToken(email: string) {
  const ids = await seedEnrollment(email);
  const { raw } = await issueToken(h.services.db, { ...ids, stepNo: 1 });
  return { ...ids, raw };
}

const stateOf = async (enrollmentId: number) =>
  (await h.pool.query(`SELECT current_state FROM enrollments WHERE id = $1`, [enrollmentId]))
    .rows[0].current_state as string;

const unsubEvents = async (enrollmentId: number) =>
  Number(
    (
      await h.pool.query(
        `SELECT count(*)::int AS n FROM events WHERE enrollment_id = $1 AND type = 'unsubscribe'`,
        [enrollmentId],
      )
    ).rows[0].n,
  );

beforeAll(async () => {
  h = await createApiHarness({}, {}, { destination: collector, level: 'trace' });
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
  await seedMailboxes(h.pool, 1);
  LOG_LINES.length = 0;
});

describe('GET /u/:token — confirmation only', () => {
  it('renders a confirmation form and does NOT unsubscribe', async () => {
    const { raw, enrollmentId } = await mintToken('confirm@test.dev');

    const res = await h.app.inject({ method: 'GET', url: `/u/${raw}` });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<form method="post"');
    expect(res.body).toContain('Confirm, and I won\u2019t send you any more emails.');
    expect(res.body).not.toContain('This applies to every campaign');
    // The whole point: a prefetching scanner must not opt anyone out.
    expect(await stateOf(enrollmentId)).toBe('ACTIVE');
    expect(await unsubEvents(enrollmentId)).toBe(0);
  });

  it('an unknown token renders the same page as a real one — no enumeration oracle', async () => {
    const real = await h.app.inject({
      method: 'GET',
      url: `/u/${(await mintToken('a@t.dev')).raw}`,
    });
    const fake = await h.app.inject({ method: 'GET', url: '/u/not-a-real-token-at-all' });

    expect(fake.statusCode).toBe(200);
    expect(fake.body).not.toContain('<form method="post"');
    // Distinguishable only by the absence of a form — never by status or error.
    expect(fake.statusCode).toBe(real.statusCode);
    expect(fake.body).not.toMatch(/invalid|expired|unknown|not found/i);
  });

  it('shows the completed state instead of another confirmation after unsubscribe', async () => {
    const ids = await seedEnrollment('already-unsubscribed@test.dev');
    const first = await issueToken(h.services.db, { ...ids, stepNo: 1 });
    const second = await issueToken(h.services.db, { ...ids, stepNo: 2 });

    await h.app.inject({ method: 'POST', url: `/u/${first.raw}` });
    const reopened = await h.app.inject({ method: 'GET', url: `/u/${second.raw}` });

    expect(reopened.statusCode).toBe(200);
    expect(reopened.body).toContain('You are unsubscribed');
    expect(reopened.body).toContain('You will not receive further emails from us.');
    expect(reopened.body).not.toContain('<form method="post"');
  });
});

describe('POST /u/:token — the actual opt-out', () => {
  it('appends unsubscribe(source=link), suppresses globally, and reaches UNSUBSCRIBED', async () => {
    const { raw, enrollmentId } = await mintToken('optout@test.dev');

    const res = await h.app.inject({ method: 'POST', url: `/u/${raw}` });

    expect(res.statusCode).toBe(200);
    expect(await stateOf(enrollmentId)).toBe('UNSUBSCRIBED');

    const ev = await h.pool.query(
      `SELECT source FROM events WHERE enrollment_id = $1 AND type = 'unsubscribe'`,
      [enrollmentId],
    );
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0].source).toBe('link');

    const sup = await h.pool.query(`SELECT reason FROM suppressions WHERE email = $1`, [
      'optout@test.dev',
    ]);
    expect(sup.rows[0]?.reason).toBe('unsubscribed');
  });

  it('accepts Gmail one-click: form body, no session cookie, no CSRF header', async () => {
    const { raw, enrollmentId } = await mintToken('oneclick@test.dev');

    const res = await h.app.inject({
      method: 'POST',
      url: `/u/${raw}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'List-Unsubscribe=One-Click',
    });

    expect(res.statusCode).toBe(200);
    expect(await stateOf(enrollmentId)).toBe('UNSUBSCRIBED');
  });

  it('is idempotent — a second POST appends no duplicate fact', async () => {
    const { raw, enrollmentId } = await mintToken('twice@test.dev');

    await h.app.inject({ method: 'POST', url: `/u/${raw}` });
    const second = await h.app.inject({ method: 'POST', url: `/u/${raw}` });

    expect(second.statusCode).toBe(200);
    expect(await unsubEvents(enrollmentId)).toBe(1);
  });

  it('a second token for the same enrollment also no-ops once unsubscribed', async () => {
    const ids = await seedEnrollment('multi@test.dev');
    const first = await issueToken(h.services.db, { ...ids, stepNo: 1 });
    const second = await issueToken(h.services.db, { ...ids, stepNo: 2 });

    await h.app.inject({ method: 'POST', url: `/u/${first.raw}` });
    await h.app.inject({ method: 'POST', url: `/u/${second.raw}` });

    expect(await unsubEvents(ids.enrollmentId)).toBe(1);
  });

  it('an unknown token changes nothing', async () => {
    const { enrollmentId } = await mintToken('safe@test.dev');

    const res = await h.app.inject({ method: 'POST', url: '/u/completely-made-up' });

    expect(res.statusCode).toBe(200);
    expect(await stateOf(enrollmentId)).toBe('ACTIVE');
  });

  it('stamps used_at on first redeem and leaves it on the second', async () => {
    const { raw } = await mintToken('stamp@test.dev');

    await h.app.inject({ method: 'POST', url: `/u/${raw}` });
    const first = await h.pool.query(`SELECT used_at FROM unsubscribe_tokens WHERE step_no = 1`);
    await h.app.inject({ method: 'POST', url: `/u/${raw}` });
    const again = await h.pool.query(`SELECT used_at FROM unsubscribe_tokens WHERE step_no = 1`);

    expect(first.rows[0].used_at).not.toBeNull();
    expect(again.rows[0].used_at).toEqual(first.rows[0].used_at);
  });
});

describe('the token is a secret', () => {
  it('only the sha256 is stored — the raw value never reaches the database', async () => {
    const { raw } = await mintToken('hashed@test.dev');
    const rows = await h.pool.query(`SELECT token_hash FROM unsubscribe_tokens`);
    expect(rows.rows[0].token_hash).not.toBe(raw);
    expect(rows.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('neither the token nor the email appears in the logs at trace level', async () => {
    const { raw } = await mintToken('private@test.dev');
    LOG_LINES.length = 0;

    await h.app.inject({ method: 'GET', url: `/u/${raw}` });
    await h.app.inject({ method: 'POST', url: `/u/${raw}` });

    const logs = LOG_LINES.join('\n');
    expect(logs).not.toContain(raw);
    expect(logs).not.toContain('private@test.dev');
  });
});
