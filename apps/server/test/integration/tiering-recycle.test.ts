// B5.6–B5.7: bulk-tier (ids + filter), cold storage, recycle with the
// content-hash guard, and the campaign-status listDue gate that keeps a
// draft recycle target silent.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createDb, type Db } from '../../src/db/client';
import { EventStore } from '../../src/services/eventStore';
import { VirtualClock } from '../../src/clock/virtual';
import { StaticSequenceProvider } from '../../src/scheduler/staticSequenceProvider';
import { bulkTier } from '../../src/services/tiering';
import { coldStorage, recycle, RecycleSequenceConflictError } from '../../src/services/enrollment';
import { listDue } from '../../src/db/repos/enrollmentsRepo';
import { testSequence, testStep, testVariant } from '../helpers/sequences';
import { TEST_DATABASE_URL, resetCoreTables, seedMailboxes } from '../helpers/db';

const NOW = new Date('2026-03-02T15:00:00Z');
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);

describe('bulk-tier (B5.6)', () => {
  let db: Db;
  let pool: Pool;

  beforeAll(() => {
    ({ db, pool } = createDb(TEST_DATABASE_URL));
  });
  afterAll(async () => {
    await resetCoreTables(pool);
    await pool.end();
  });
  beforeEach(async () => {
    await resetCoreTables(pool);
    await pool.query(
      `INSERT INTO leads (email, first_name, company, state, tier) VALUES
       ('a@x.dev', 'Ann', 'Acme Realty', 'TX', NULL),
       ('b@x.dev', 'Bob', 'Beta Homes', 'TX', 'C'),
       ('c@x.dev', 'Cal', 'Gamma Group', 'CA', NULL),
       ('d@x.dev', 'Dee', 'Acme West', 'CA', 'A')`,
    );
  });

  it('by explicit ids', async () => {
    const r = await bulkTier({ db }, { leadIds: [1, 3], tier: 'B' });
    expect(r).toEqual({ updated: 2 });
    const tiers = await pool.query(`SELECT id, tier FROM leads ORDER BY id`);
    expect(tiers.rows.map((x: { tier: string | null }) => x.tier)).toEqual(['B', 'C', 'B', 'A']);
  });

  it('by filter — untiered + state, and q substring', async () => {
    await pool.query(`INSERT INTO campaigns (name, status) VALUES ('filter campaign', 'active')`);
    await pool.query(
      `INSERT INTO enrollments (lead_id, campaign_id, current_state, personalization_mode, enrolled_at)
       VALUES (1, 1, 'ACTIVE', 'template_auto', now())`,
    );
    const r = await bulkTier({ db }, { filter: { tier: 'untiered', state: 'ACTIVE' }, tier: 'C' });
    expect(r).toEqual({ updated: 1 }); // only a@x.dev is both untiered and ACTIVE

    const q = await bulkTier({ db }, { filter: { q: 'acme' }, tier: 'A' });
    expect(q).toEqual({ updated: 2 }); // Acme Realty + Acme West
  });

  it('tier edits do not touch enrolled_tier snapshots (docs/09 §4)', async () => {
    await pool.query(`INSERT INTO campaigns (name, status) VALUES ('c1', 'active')`);
    await pool.query(
      `INSERT INTO enrollments (lead_id, campaign_id, current_state, personalization_mode, enrolled_tier, enrolled_at)
       VALUES (2, 1, 'ACTIVE', 'template_auto', 'C', now())`,
    );
    await bulkTier({ db }, { leadIds: [2], tier: 'B' });
    const snap = await pool.query(`SELECT enrolled_tier FROM enrollments WHERE id = 1`);
    expect(snap.rows[0].enrolled_tier).toBe('C'); // snapshot survives the promotion
  });

  it('refuses ids+filter together, neither, or an empty filter', async () => {
    await expect(
      bulkTier({ db }, { leadIds: [1], filter: { state: 'TX' }, tier: 'A' }),
    ).rejects.toThrow(/exactly one/);
    await expect(bulkTier({ db }, { tier: 'A' })).rejects.toThrow(/exactly one/);
    await expect(bulkTier({ db }, { filter: {}, tier: 'A' })).rejects.toThrow(/no constraints/);
  });
});

describe('cold storage + recycle (B5.7)', () => {
  let db: Db;
  let pool: Pool;
  let store: EventStore;
  let clock: VirtualClock;
  let sequences: StaticSequenceProvider;

  const SOURCE = 1;
  const TARGET = 2;

  beforeAll(() => {
    ({ db, pool } = createDb(TEST_DATABASE_URL));
    store = new EventStore(db);
  });
  afterAll(async () => {
    await resetCoreTables(pool);
    await pool.end();
  });

  const deps = () => ({ db, store, clock, sequences });

  /**
   * Source campaign 1 (completed pass) + draft target 2. Leads:
   *  1 rested 61d ago (eligible) · 2 rested 10d ago (gated) ·
   *  3 rested 61d ago but suppressed · 4 rested 61d ago, tier nurture.
   * Lead 1 received hash 'h1' at step 1 of the old pass.
   */
  beforeEach(async () => {
    clock = new VirtualClock(NOW.toISOString());
    sequences = new StaticSequenceProvider();
    await resetCoreTables(pool);
    await seedMailboxes(pool, 1);
    await pool.query(
      `INSERT INTO campaigns (name, status) VALUES ('pass1', 'completed'), ('pass2', 'draft')`,
    );
    await pool.query(
      `INSERT INTO leads (email, tier, is_suppressed) VALUES
       ('r1@x.dev', 'B', false), ('r2@x.dev', 'B', false),
       ('r3@x.dev', 'B', true), ('r4@x.dev', 'nurture', false)`,
    );
    for (const [leadId, completed] of [
      [1, daysAgo(61)],
      [2, daysAgo(10)],
      [3, daysAgo(61)],
      [4, daysAgo(61)],
    ] as const) {
      await pool.query(
        `INSERT INTO enrollments (lead_id, campaign_id, current_state, personalization_mode, enrolled_at, terminal_at)
         VALUES ($1, $2, 'COMPLETED', 'template_researched', $3, $4)`,
        [leadId, SOURCE, daysAgo(100), completed],
      );
    }
    await pool.query(
      `INSERT INTO sent_messages (message_id, enrollment_id, lead_id, mailbox_id, step_no, content_hash, sent_at)
       VALUES ('<m1@x.dev>', 1, 1, 1, 1, 'h1', $1)`,
      [daysAgo(90)],
    );
  });

  it('cold storage view: rest-day gate + suppression exclusion', async () => {
    const items = await coldStorage({ db, clock }, SOURCE);
    expect(items.map((i) => [i.leadId, i.eligible])).toEqual([
      [1, true],
      [4, true],
      [2, false], // 10 days rested < 60
    ]); // lead 3 suppressed — absent entirely
    expect(items[0]!.earliestRecycleAt.getTime()).toBe(daysAgo(61).getTime() + 60 * 86_400_000);
  });

  it('hash conflict blocks the WHOLE action, listing offending steps', async () => {
    // Target sequence still contains the old step-1 content (hash h1).
    sequences.register(TARGET, {
      id: 9,
      steps: [testStep(1, 0, { contentHash: 'h1' }), testStep(2, 3, { contentHash: 'x2' })],
    });
    await expect(recycle(deps(), TARGET, SOURCE)).rejects.toThrow(RecycleSequenceConflictError);
    await expect(recycle(deps(), TARGET, SOURCE)).rejects.toThrow(/step\(s\) 1/);
    const count = await pool.query(`SELECT count(*)::int n FROM enrollments WHERE campaign_id = 2`);
    expect(count.rows[0].n).toBe(0); // nothing partially enrolled
  });

  it('changed sequence passes: rested, non-nurture leads enroll fresh; old pass untouched', async () => {
    // NB: testSequence's default hashes are h1,h2… which would collide with
    // the received 'h1' — a changed sequence means fresh hashes.
    sequences.register(TARGET, {
      id: 9,
      steps: [
        {
          stepNo: 1,
          waitDays: 0,
          inThread: false,
          variants: [testVariant(91, { contentHash: 'fresh1' })],
        },
        {
          stepNo: 2,
          waitDays: 3,
          inThread: true,
          variants: [testVariant(92, { contentHash: 'fresh2' })],
        },
      ],
    });

    const r = await recycle(deps(), TARGET, SOURCE);
    expect(r.enrolled).toBe(1);
    expect(r.leadIds).toEqual([1]); // rested + not suppressed + not nurture + not gated

    const rows = await pool.query(
      `SELECT lead_id, current_state, enrolled_tier FROM enrollments WHERE campaign_id = 2`,
    );
    expect(rows.rows).toEqual([{ lead_id: 1, current_state: 'ACTIVE', enrolled_tier: 'B' }]);
    const old = await pool.query(
      `SELECT current_state FROM enrollments WHERE campaign_id = 1 AND lead_id = 1`,
    );
    expect(old.rows[0].current_state).toBe('COMPLETED'); // per-campaign state machine
    const target = await pool.query(`SELECT recycled_from_campaign_id FROM campaigns WHERE id = 2`);
    expect(target.rows[0].recycled_from_campaign_id).toBe(SOURCE);

    // idempotent-ish: a second recycle finds nobody new
    expect((await recycle(deps(), TARGET, SOURCE)).enrolled).toBe(0);
  });

  it('refuses a non-draft target', async () => {
    await pool.query(`UPDATE campaigns SET status = 'active' WHERE id = 2`);
    sequences.register(TARGET, testSequence(9, [0]));
    await expect(recycle(deps(), TARGET, SOURCE)).rejects.toThrow(/draft/);
  });

  it('listDue ignores draft campaigns — the recycle target stays silent until activated', async () => {
    sequences.register(TARGET, {
      id: 9,
      steps: [
        {
          stepNo: 1,
          waitDays: 0,
          inThread: false,
          variants: [testVariant(91, { contentHash: 'fresh1' })],
        },
      ],
    });
    await recycle(deps(), TARGET, SOURCE);

    expect(await listDue(db, clock.now())).toHaveLength(0); // target is draft
    await pool.query(`UPDATE campaigns SET status = 'active' WHERE id = 2`);
    const due = await listDue(db, clock.now());
    expect(due.map((d) => d.leadId)).toEqual([1]);
  });
});
