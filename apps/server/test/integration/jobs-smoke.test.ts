// B3.16: thin pg-boss smoke — boot, cron schedules registered, a delayed
// confirm-delivery job executes for real. Business logic is tested inline via
// the scenario runner; this only proves the wiring.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createDb, type Db } from '../../src/db/client';
import { EventStore } from '../../src/services/eventStore';
import { buildEvent } from '../../src/domain/events';
import { SystemClock } from '../../src/clock/system';
import { MockTransport } from '../../src/transport/mock/mockTransport';
import { Scheduler } from '../../src/scheduler/scheduler';
import { Poller } from '../../src/poller/poller';
import { Jobs } from '../../src/jobs';
import { StaticSequenceProvider } from '../../src/scheduler/staticSequenceProvider';
import { RenderEngine } from '../../src/render/engine';
import { CapturingAlerts } from '../../src/alerts/types';
import { systemRng } from '../../src/util/rng';
import { AutoEnrollmentService } from '../../src/services/autoEnrollment';
import { TEST_DATABASE_URL, resetCoreTables, seedMailboxes } from '../helpers/db';

describe('pg-boss wiring smoke (B3.16)', () => {
  let db: Db;
  let pool: Pool;
  let jobs: Jobs;

  beforeAll(async () => {
    ({ db, pool } = createDb(TEST_DATABASE_URL));
    await resetCoreTables(pool);
    await seedMailboxes(pool, 1);
    await pool.query(`INSERT INTO campaigns (name, status) VALUES ('smoke', 'active')`);
    await pool.query(`INSERT INTO leads (email) VALUES ('smoke@t.dev')`);
    await pool.query(
      `INSERT INTO enrollments (lead_id, campaign_id, current_state, personalization_mode, enrolled_at)
       VALUES (1, 1, 'NEW', 'template_auto', now())`,
    );

    const clock = new SystemClock();
    const store = new EventStore(db);
    const transport = new MockTransport(clock);
    const alerts = new CapturingAlerts();
    const sequences = new StaticSequenceProvider();
    const scheduler = new Scheduler({
      db,
      pool,
      store,
      transport,
      clock,
      rng: systemRng,
      sequences,
      renderer: new RenderEngine(),
      jobs: { scheduleConfirmDelivery: () => Promise.resolve() },
      alerts,
    });
    const poller = new Poller({ db, store, transport, clock, alerts });
    const autoEnrollment = new AutoEnrollmentService({ db, store, clock, sequences, alerts });
    jobs = new Jobs({
      connectionString: TEST_DATABASE_URL,
      db,
      clock,
      scheduler,
      poller,
      sequences,
      confirmDelivery: { db, store, clock },
      alerts,
      autoEnrollment,
    });
  });

  afterAll(async () => {
    await jobs.stop();
    await pool.query(`DROP SCHEMA IF EXISTS pgboss CASCADE`); // keep the test DB clean
    await resetCoreTables(pool);
    await pool.end();
  });

  it('boots and registers the cron schedules', async () => {
    await jobs.start();
    const schedules = await pool.query(`SELECT name, cron FROM pgboss.schedule ORDER BY name`);
    const names = schedules.rows.map((r: { name: string }) => r.name);
    expect(names).toContain('scheduler-tick');
    expect(names).toContain('imap-poll-1');
    expect(names).toContain('self-check'); // B7.3 daily
    expect(names).toContain('rebuild-compare'); // B7.3 weekly
  }, 30_000);

  it('registers a runtime-added mailbox once, and is inert before start()', async () => {
    // The B6.2 routes call this when a mailbox is created or recovers from
    // auth_failed — twice must not attach a second worker to the same queue
    // (that would double-poll the mailbox).
    await pool.query(
      `INSERT INTO mailboxes (display_name, from_address, smtp_host, imap_host)
       VALUES ('Late', 'late@t.dev', 'smtp.t.dev', 'imap.t.dev')`,
    );
    const late = (await pool.query(`SELECT id FROM mailboxes WHERE from_address = 'late@t.dev'`))
      .rows[0] as { id: number };

    await jobs.registerMailboxPoll(late.id);
    await jobs.registerMailboxPoll(late.id); // idempotent

    const schedules = await pool.query(
      `SELECT count(*)::int AS n FROM pgboss.schedule WHERE name = $1`,
      [`imap-poll-${late.id}`],
    );
    expect(schedules.rows[0].n).toBe(1);

    // Before start() (ROLE=api, SIMULATED_CLOCK, tests) there is nothing to
    // schedule — the call must be a silent no-op, not a throw.
    const notStarted = new Jobs({
      connectionString: TEST_DATABASE_URL,
      db,
      clock: new SystemClock(),
      scheduler: {} as never,
      poller: {} as never,
      sequences: new StaticSequenceProvider(),
      confirmDelivery: { db, store: new EventStore(db), clock: new SystemClock() },
      alerts: new CapturingAlerts(),
      autoEnrollment: new AutoEnrollmentService({
        db,
        store: new EventStore(db),
        clock: new SystemClock(),
        sequences: new StaticSequenceProvider(),
        alerts: new CapturingAlerts(),
      }),
    });
    await expect(notStarted.registerMailboxPoll(999)).resolves.toBeUndefined();
  }, 30_000);

  it('a delayed confirm-delivery job runs and appends delivered', async () => {
    const store = new EventStore(db);
    const sentAt = new Date(Date.now() - 6 * 3_600_000);
    await store.append([
      buildEvent.enrolled({ leadId: 1, enrollmentId: 1, campaignId: 1, occurredAt: sentAt }),
      buildEvent.sent({
        leadId: 1,
        enrollmentId: 1,
        campaignId: 1,
        occurredAt: sentAt,
        stepNo: 1,
        mailboxId: 1,
        messageId: '<smoke-1@t.dev>',
        attributes: { content_hash: 'h1' },
      }),
    ]);

    await jobs.scheduleConfirmDelivery({
      enrollmentId: 1,
      stepNo: 1,
      sentAt,
      runAt: new Date(), // due immediately
    });

    // pg-boss polls its queues every ~2s — wait for the delivered event.
    const deadline = Date.now() + 20_000;
    let delivered = 0;
    while (Date.now() < deadline) {
      const r = await pool.query(`SELECT count(*)::int n FROM events WHERE type = 'delivered'`);
      delivered = r.rows[0].n;
      if (delivered > 0) break;
      await new Promise((res) => setTimeout(res, 500));
    }
    expect(delivered).toBe(1);
  }, 30_000);
});
