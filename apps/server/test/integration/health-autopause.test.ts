// B3.13-B3.15: alert emitter, auto-pause engine (Part-11 verbatim example),
// resume + auto-clear, redistribution, IMAP failure states.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createDb, type Db } from '../../src/db/client';
import { EventStore } from '../../src/services/eventStore';
import { buildEvent } from '../../src/domain/events';
import { DbAlertSink } from '../../src/alerts/emitter';
import { CapturingAlerts } from '../../src/alerts/types';
import { acknowledgeAlert, listUnacked } from '../../src/db/repos/alertsRepo';
import { evaluateAutoPause, resumeMailbox } from '../../src/services/autoPause';
import { redistributeUnstarted } from '../../src/db/repos/enrollmentsRepo';
import { TransportAuthError } from '../../src/transport/types';
import { TEST_DATABASE_URL, resetCoreTables, seedMailboxes } from '../helpers/db';
import { scenario, type Scenario } from '../helpers/scenario';
import type { SequenceDef } from '../../src/domain/sequence';

const oneStep: SequenceDef = {
  id: 1,
  steps: [
    {
      stepNo: 1,
      waitDays: 0,
      inThread: false,
      variants: [{ id: 1, label: 'A', contentHash: 'h1' }],
    },
  ],
};

describe('alert emitter (B3.15)', () => {
  let db: Db;
  let pool: Pool;

  beforeAll(async () => {
    ({ db, pool } = createDb(TEST_DATABASE_URL));
    await resetCoreTables(pool);
    await pool.query(`TRUNCATE alerts RESTART IDENTITY`);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('emit → alerts row; unacked feed; acknowledge clears it', async () => {
    const sink = new DbAlertSink(db);
    await sink.emit('catchup_backlog', 'info', { overdue: 12 });
    await sink.emit('mailbox_auto_paused', 'warning', { mailboxId: 3 });

    const unacked = await listUnacked(db);
    expect(unacked).toHaveLength(2);
    expect(unacked[0]!.kind).toBe('mailbox_auto_paused'); // newest first
    expect(unacked[1]!.payload).toEqual({ overdue: 12 });

    await acknowledgeAlert(db, unacked[1]!.id, new Date());
    expect(await listUnacked(db)).toHaveLength(1);
  });
});

describe('auto-pause engine (B3.13, spec Part 11)', () => {
  let db: Db;
  let pool: Pool;
  let store: EventStore;
  let alerts: CapturingAlerts;

  beforeAll(() => {
    ({ db, pool } = createDb(TEST_DATABASE_URL));
    store = new EventStore(db);
  });
  afterAll(async () => {
    await resetCoreTables(pool);
    await pool.end();
  });

  beforeEach(async () => {
    await resetCoreTables(pool);
    await seedMailboxes(pool, 1);
    await pool.query(`INSERT INTO campaigns (name, status) VALUES ('ap', 'active')`);
    alerts = new CapturingAlerts();
  });

  /** Seed `total` sends from mailbox 1; hard-bounce the 1-based send numbers in `bounced`. */
  const seedSends = async (total: number, bounced: number[]): Promise<void> => {
    const base = Date.parse('2026-02-02T14:00:00Z');
    const emails = Array.from({ length: total }, (_, i) => `ap-${i + 1}@t.dev`);
    await pool.query(`INSERT INTO leads (email) SELECT * FROM unnest($1::text[])`, [emails]);
    await pool.query(
      `INSERT INTO enrollments (lead_id, campaign_id, current_state, personalization_mode, enrolled_at)
       SELECT lead_id, 1, 'NEW', 'template_auto', now()
       FROM unnest($1::bigint[]) AS t(lead_id)`,
      [Array.from({ length: total }, (_, i) => i + 1)],
    );
    for (let i = 1; i <= total; i++) {
      const at = new Date(base + i * 60_000);
      await store.append([
        buildEvent.enrolled({ leadId: i, enrollmentId: i, campaignId: 1, occurredAt: at }),
        buildEvent.sent({
          leadId: i,
          enrollmentId: i,
          campaignId: 1,
          occurredAt: at,
          stepNo: 1,
          mailboxId: 1,
          messageId: `<ap-${i}@t.dev>`,
          attributes: { content_hash: 'h1' },
        }),
        ...(bounced.includes(i)
          ? [
              buildEvent.hardBounce({
                leadId: i,
                enrollmentId: i,
                campaignId: 1,
                occurredAt: new Date(at.getTime() + 30_000),
                stepNo: 1,
                mailboxId: 1,
                reason: '5.1.1',
              }),
            ]
          : []),
      ]);
    }
  };

  it('the Part-11 example verbatim: 55 sends, 3-in-10 fires absolute; 4-in-50 = 8%', async () => {
    await seedSends(55, [20, 53, 54, 55]);
    const now = new Date('2026-02-02T16:00:00Z');
    const r = await evaluateAutoPause({ db, alerts }, 1, now);

    expect(r.paused).toBe(true);
    expect(r.rule).toBe('absolute');
    expect(r.absoluteWindow).toEqual({ bounces: 3, span: 10 });
    expect(r.pctWindow.bounces).toBe(4);
    expect(r.pctWindow.pct).toBeCloseTo(8.0, 5); // 4 / min(55,50) = 8%

    const mb = await pool.query(`SELECT status, paused_at FROM mailboxes WHERE id = 1`);
    expect(mb.rows[0].status).toBe('auto_paused');
    expect(new Date(mb.rows[0].paused_at).getTime()).toBe(now.getTime());

    // alert carries BOTH window numbers (walkthrough Stage 7 panel)
    const alert = alerts.emitted.find((a) => a.kind === 'mailbox_auto_paused')!;
    expect(alert.severity).toBe('warning');
    expect(alert.payload.absoluteWindow).toEqual({ bounces: 3, span: 10 });
    expect(alert.payload.pctWindow).toMatchObject({ bounces: 4, window: 50, pct: 8 });
  });

  it('pct rule fires without the absolute trigger (bounces spread out)', async () => {
    // 30 sends, bounces at #5 and #15 - last 10 (21-30) has 0; 2/30 = 6.7% > 4%
    await seedSends(30, [5, 15]);
    const r = await evaluateAutoPause({ db, alerts }, 1, new Date());
    expect(r.paused).toBe(true);
    expect(r.rule).toBe('pct');
    expect(r.absoluteWindow.bounces).toBe(0);
    expect(r.pctWindow.pct).toBeCloseTo((2 / 30) * 100, 5);
  });

  it('below both thresholds nothing happens', async () => {
    await seedSends(30, [7]); // 1/30 = 3.3%, 0 in last 10
    const r = await evaluateAutoPause({ db, alerts }, 1, new Date());
    expect(r.paused).toBe(false);
    const mb = await pool.query(`SELECT status FROM mailboxes WHERE id = 1`);
    expect(mb.rows[0].status).toBe('ok');
    expect(alerts.emitted).toHaveLength(0);
  });

  it('the pct rule is volume-gated: high rate on tiny volume does not fire pct', async () => {
    // 10 sends, 1 bounce = 10% but sends < pause_min_sends (25) and only 1 in last 10
    await seedSends(10, [3]);
    const r = await evaluateAutoPause({ db, alerts }, 1, new Date());
    expect(r.paused).toBe(false);
  });

  it('resumeMailbox: ok at 50% cap; re-evaluation respects non-ok status', async () => {
    await seedSends(55, [20, 53, 54, 55]);
    const pausedAt = new Date('2026-02-02T16:00:00Z');
    await evaluateAutoPause({ db, alerts }, 1, pausedAt);

    await resumeMailbox({ db }, 1, 50, new Date('2026-02-03T09:00:00Z'));
    const mb = await pool.query(`SELECT status, resume_cap FROM mailboxes WHERE id = 1`);
    expect(mb.rows[0]).toMatchObject({ status: 'ok', resume_cap: 15 }); // 50% of 30
  });
});

describe('health machine + redistribution (B3.14)', () => {
  let s: Scenario;
  afterEach(async () => {
    await s.close();
  });

  it('redistribution: assigned-but-unstarted loses the mailbox; mid-thread keeps it', async () => {
    s = await scenario({ mailboxes: 2, sequence: oneStep });
    await s.importLeads(2);
    await s.enroll({ count: 2 });
    // L0001 mid-thread on mb1 (has a sent event); L0002 assigned mb1 but never sent
    await s.pool.query(`UPDATE enrollments SET assigned_mailbox_id = 1`);
    await s.store.append([
      buildEvent.sent({
        leadId: 1,
        enrollmentId: 1,
        campaignId: 1,
        occurredAt: s.clock.now(),
        stepNo: 1,
        mailboxId: 1,
        messageId: '<started@scenario.dev>',
        attributes: { content_hash: 'h1' },
      }),
    ]);

    const moved = await redistributeUnstarted(s.db, 1);
    expect(moved).toBe(1);
    const rows = await s.pool.query(
      `SELECT lead_id, assigned_mailbox_id FROM enrollments ORDER BY lead_id`,
    );
    expect(rows.rows).toEqual([
      { lead_id: 1, assigned_mailbox_id: 1 }, // mid-thread: kept
      { lead_id: 2, assigned_mailbox_id: null }, // unstarted: back to rotation
    ]);
  });

  it('permanent IMAP auth failure on poll: auth_failed + alert + no polls afterwards', async () => {
    s = await scenario({ mailboxes: 1, sequence: oneStep });
    s.mock.failNextFetch(1, new TransportAuthError('535 5.7.8 IMAP LOGIN failed'));

    await s.poller.poll(1);

    const mb = await s.pool.query(`SELECT status, status_reason FROM mailboxes WHERE id = 1`);
    expect(mb.rows[0].status).toBe('auth_failed');
    expect(mb.rows[0].status_reason).toMatch(/535/);
    expect(
      s.alerts.emitted.some(
        (a) => a.kind === 'mailbox_auth_failed' && a.payload.via === 'imap_poll',
      ),
    ).toBe(true);

    const again = await s.poller.poll(1);
    expect(again.polled).toBe(false); // auth_failed mailboxes are not polled
  });

  it('transient fetch failure rethrows (job retry owns it) and does not advance state', async () => {
    s = await scenario({ mailboxes: 1, sequence: oneStep });
    s.mock.failNextFetch(1, new Error('ECONNRESET'));
    await expect(s.poller.poll(1)).rejects.toThrow('ECONNRESET');
    const mb = await s.pool.query(
      `SELECT status, last_successful_poll_at FROM mailboxes WHERE id = 1`,
    );
    expect(mb.rows[0].status).toBe('ok');
    expect(mb.rows[0].last_successful_poll_at).toBeNull();
  });

  it('stale-poll flip by the tick; next successful poll auto-recovers with an info alert', async () => {
    s = await scenario({ mailboxes: 1, sequence: oneStep });
    // Mailbox last polled successfully 7h ago (> stale_poll_hours 6)
    const sevenHoursAgo = new Date(s.clock.now().getTime() - 7 * 3_600_000);
    await s.pool.query(`UPDATE mailboxes SET last_successful_poll_at = $1 WHERE id = 1`, [
      sevenHoursAgo,
    ]);

    await s.scheduler.tick();
    let mb = await s.pool.query(`SELECT status FROM mailboxes WHERE id = 1`);
    expect(mb.rows[0].status).toBe('imap_stale');
    expect(s.alerts.emitted.some((a) => a.kind === 'imap_stale')).toBe(true);

    await s.poller.poll(1); // succeeds (empty queue) → auto-recover
    mb = await s.pool.query(`SELECT status, last_successful_poll_at FROM mailboxes WHERE id = 1`);
    expect(mb.rows[0].status).toBe('ok');
    expect(mb.rows[0].last_successful_poll_at).not.toBeNull();
    expect(s.alerts.emitted.some((a) => a.kind === 'imap_recovered')).toBe(true);
  });

  it('resume_cap auto-clears after 7 clean days (tick housekeeping)', async () => {
    s = await scenario({ mailboxes: 1, sequence: oneStep });
    const eightDaysAgo = new Date(s.clock.now().getTime() - 8 * 86_400_000);
    await s.pool.query(
      `UPDATE mailboxes SET resume_cap = 15, paused_at = $1, status = 'ok' WHERE id = 1`,
      [eightDaysAgo],
    );

    await s.scheduler.tick();

    const mb = await s.pool.query(`SELECT resume_cap, paused_at FROM mailboxes WHERE id = 1`);
    expect(mb.rows[0].resume_cap).toBeNull();
    expect(mb.rows[0].paused_at).toBeNull();
  });

  it('resume_cap survives when a hard bounce happened within the window', async () => {
    s = await scenario({ mailboxes: 1, sequence: oneStep });
    await s.importLeads(1);
    await s.enroll({ count: 1 });
    const eightDaysAgo = new Date(s.clock.now().getTime() - 8 * 86_400_000);
    await s.pool.query(
      `UPDATE mailboxes SET resume_cap = 15, paused_at = $1, status = 'ok' WHERE id = 1`,
      [eightDaysAgo],
    );
    // A hard bounce 2 days ago - inside the 7-day clean window
    await s.store.append([
      buildEvent.sent({
        leadId: 1,
        enrollmentId: 1,
        campaignId: 1,
        occurredAt: new Date(s.clock.now().getTime() - 2 * 86_400_000 - 60_000),
        stepNo: 1,
        mailboxId: 1,
        messageId: '<rc-1@scenario.dev>',
        attributes: { content_hash: 'h1' },
      }),
      buildEvent.hardBounce({
        leadId: 1,
        enrollmentId: 1,
        campaignId: 1,
        occurredAt: new Date(s.clock.now().getTime() - 2 * 86_400_000),
        stepNo: 1,
        mailboxId: 1,
      }),
    ]);

    await s.scheduler.tick();

    const mb = await s.pool.query(`SELECT resume_cap FROM mailboxes WHERE id = 1`);
    expect(mb.rows[0].resume_cap).toBe(15); // not cleared
  });

  it('scheduler budgets honor resume_cap over daily_cap', async () => {
    s = await scenario({ mailboxes: 1, dailyCap: 30, sequence: oneStep, tickMinutes: 5 });
    await s.importLeads(5);
    await s.pool.query(`UPDATE mailboxes SET resume_cap = 2 WHERE id = 1`);
    await s.enroll({ count: 5 });

    await s.advanceHours(8); // whole window at 5-min ticks

    expect(s.mock.sentLog.filter((e) => e.result.accepted)).toHaveLength(2); // capped at resume_cap
  }, 30_000);
});
