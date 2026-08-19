// docs/06 §6: the provider_blocked transition. Until now the state existed in
// the enum, the alert kinds and the UI but nothing could reach it — a mailbox
// being throttled just paused as `smtp_failing`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createDb, type Db } from '../../src/db/client';
import { EventStore } from '../../src/services/eventStore';
import { VirtualClock } from '../../src/clock/virtual';
import { MockTransport } from '../../src/transport/mock/mockTransport';
import { Scheduler } from '../../src/scheduler/scheduler';
import { StaticSequenceProvider } from '../../src/scheduler/staticSequenceProvider';
import { RenderEngine } from '../../src/render/engine';
import { CapturingAlerts } from '../../src/alerts/types';
import { seededRng } from '../../src/util/rng';
import { TRANSIENT_FAILURE_LIMIT } from '../../src/scheduler/providerBlock';
import { TEST_DATABASE_URL, resetCoreTables, seedMailboxes } from '../helpers/db';
import { testSequence } from '../helpers/sequences';

const LEAD_EMAIL = 'lead@throttled.dev';

describe('provider_blocked (docs/06 §6)', () => {
  let db: Db;
  let pool: Pool;
  let clock: VirtualClock;
  let mock: MockTransport;
  let alerts: CapturingAlerts;
  let scheduler: Scheduler;

  beforeAll(() => {
    ({ db, pool } = createDb(TEST_DATABASE_URL));
  });

  afterAll(async () => {
    await resetCoreTables(pool);
    await pool.end();
  });

  beforeEach(async () => {
    clock = new VirtualClock('2026-01-05T14:00:00Z'); // Mon 09:00 ET — inside the window
    mock = new MockTransport(clock);
    alerts = new CapturingAlerts();
    const sequences = new StaticSequenceProvider();
    sequences.register(1, testSequence(1, [0, 3]));
    scheduler = new Scheduler({
      db,
      pool,
      store: new EventStore(db),
      transport: mock,
      clock,
      rng: seededRng(42),
      sequences,
      renderer: new RenderEngine(),
      jobs: { scheduleConfirmDelivery: () => Promise.resolve() },
      alerts,
    });

    await resetCoreTables(pool);
    // Two mailboxes: keep sends on mailbox 1 while exercising the transition.
    await seedMailboxes(pool, 2);
    await pool.query(`UPDATE mailboxes SET status = 'paused' WHERE id = 2`); // keep sends on mb1
    await pool.query(`INSERT INTO campaigns (name, status) VALUES ('throttled', 'active')`);
    await pool.query(`INSERT INTO leads (email) VALUES ($1)`, [LEAD_EMAIL]);
    await pool.query(
      `INSERT INTO enrollments (lead_id, campaign_id, current_state, personalization_mode, enrolled_at, next_send_at)
       VALUES (1, 1, 'ACTIVE', 'template_auto', $1, $1)`,
      [clock.now()],
    );
    await pool.query(`UPDATE settings SET send_jitter_pct = 0 WHERE id = 1`);
  });

  /** Drive N consecutive transient failures with the given SMTP text. */
  const failTimes = async (n: number, error: string): Promise<void> => {
    for (let i = 0; i < n; i++) {
      mock.onSend(LEAD_EMAIL, { kind: 'transient', error });
      await scheduler.tick();
      clock.advance({ minutes: 30 }); // clear the pacing gap
    }
  };

  const mailbox = async (id: number) =>
    (await pool.query(`SELECT status, status_reason FROM mailboxes WHERE id = $1`, [id]))
      .rows[0] as { status: string; status_reason: string | null };

  it('a persistent provider rate limit blocks the mailbox; unstarted work stays unassigned', async () => {
    await failTimes(TRANSIENT_FAILURE_LIMIT, '421 4.7.0 Try again later, closing connection');

    expect(await mailbox(1)).toMatchObject({ status: 'provider_blocked' });
    expect(alerts.emitted.map((a) => a.kind)).toContain('provider_blocked');

    // Failed attempts never assign a mailbox. The next healthy scheduler
    // choice can therefore rotate this work without a redistribution update.
    const enrollment = (
      await pool.query(`SELECT assigned_mailbox_id FROM enrollments WHERE id = 1`)
    ).rows[0] as { assigned_mailbox_id: number | null };
    expect(enrollment.assigned_mailbox_id).toBeNull();

    // Nothing was appended for the failed attempts (4b: transient = no event).
    const events = await pool.query(`SELECT count(*)::int AS n FROM events WHERE type = 'sent'`);
    expect(events.rows[0].n).toBe(0);
  });

  it('ordinary SMTP flakiness still just pauses as smtp_failing', async () => {
    await failTimes(TRANSIENT_FAILURE_LIMIT, '451 4.3.0 Temporary system problem');

    expect(await mailbox(1)).toMatchObject({ status: 'paused', status_reason: 'smtp_failing' });
    expect(alerts.emitted.map((a) => a.kind)).toContain('mailbox_smtp_failing');
    expect(alerts.emitted.map((a) => a.kind)).not.toContain('provider_blocked');
  });

  it('one non-throttle failure in the run breaks the streak', async () => {
    await failTimes(TRANSIENT_FAILURE_LIMIT - 1, '421 4.7.0 Try again later');
    await failTimes(1, '451 4.3.0 Temporary system problem');

    // The 5th failure trips the limit, but the run is no longer all-throttle.
    expect(await mailbox(1)).toMatchObject({ status: 'paused', status_reason: 'smtp_failing' });
  });

  it('a few throttles are just retried — the mailbox stays healthy', async () => {
    await failTimes(TRANSIENT_FAILURE_LIMIT - 1, '421 4.7.0 Try again later');

    expect(await mailbox(1)).toMatchObject({ status: 'ok' });
    expect(alerts.emitted).toHaveLength(0);
  });
});
