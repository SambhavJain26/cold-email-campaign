// @golden L1 (live DB): the same 885-lead log appended through the REAL
// eventStore chokepoint produces identical projections, suppressions land,
// and rebuild-projections confirms projection == fold(log) with zero drift.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createDb, type Db } from '../../src/db/client';
import { EventStore } from '../../src/services/eventStore';
import { rebuildProjections } from '../../src/services/rebuildProjections';
import { stateCounts } from '../../src/db/repos/enrollmentsRepo';
import { GOLDEN, personalizationModeOf, tierOf } from '../fixtures/golden/constants';
import { loadGoldenEvents } from '../fixtures/golden/load';
import { TEST_DATABASE_URL, resetCoreTables } from '../helpers/db';

const CHUNK = 1000;

describe('@golden L1 — live append + rebuild equivalence', () => {
  let db: Db;
  let pool: Pool;
  let store: EventStore;

  beforeAll(async () => {
    ({ db, pool } = createDb(TEST_DATABASE_URL));
    store = new EventStore(db);
    await resetCoreTables(pool);

    // 885 leads + campaign + enrollments; RESTART IDENTITY makes ids 1..885
    // line up with the fixture's lead/enrollment ids.
    const n = GOLDEN.totalLeads;
    const emails = Array.from({ length: n }, (_, i) => `golden-${i + 1}@fixture.dev`);
    const tiers = Array.from({ length: n }, (_, i) => tierOf(i + 1));
    await pool.query(
      `INSERT INTO leads (email, tier) SELECT * FROM unnest($1::text[], $2::lead_tier[])`,
      [emails, tiers],
    );
    await pool.query(`INSERT INTO campaigns (name, status) VALUES ('Golden Pass 1', 'active')`);
    const modes = Array.from({ length: n }, (_, i) => personalizationModeOf(i + 1));
    await pool.query(
      `INSERT INTO enrollments (lead_id, campaign_id, current_state, enrolled_tier, personalization_mode, enrolled_at)
       SELECT lead_id, 1, 'NEW', tier, mode, '2026-01-05T00:00:00Z'
       FROM unnest($1::bigint[], $2::lead_tier[], $3::personalization_mode[]) AS t(lead_id, tier, mode)`,
      [Array.from({ length: n }, (_, i) => i + 1), tiers, modes],
    );
  }, 60_000);

  afterAll(async () => {
    await resetCoreTables(pool);
    await pool.end();
  });

  it('appends all 7,691 events through eventStore with DB ids matching fixture seqs', async () => {
    const events = loadGoldenEvents();
    let lastId = 0;
    for (let i = 0; i < events.length; i += CHUNK) {
      const ids = await store.append(events.slice(i, i + CHUNK));
      lastId = ids.at(-1)!;
    }
    expect(lastId).toBe(events.length); // seq == DB id, so sentiment_tagged refs hold
    const evCount = (await pool.query(`SELECT count(*)::int n FROM events`)).rows[0].n;
    expect(evCount).toBe(events.length);
  }, 120_000);

  it('completeEligible finishes exactly the 780 cold-storage leads', async () => {
    const completed = await store.completeEligible(
      GOLDEN.shape,
      GOLDEN.deliveryConfirmMs,
      new Date(GOLDEN.endOfCampaign),
      GOLDEN.campaignId,
    );
    expect(completed).toBe(GOLDEN.expected.terminals.COMPLETED);
  }, 60_000);

  it('projections reproduce the Part-10 terminal breakdown, summing to 885', async () => {
    const counts = await stateCounts(db, GOLDEN.campaignId);
    expect(counts).toEqual(GOLDEN.expected.terminals);
  });

  it('58 leads are suppressed: 40 unsubscribed + 18 hard-bounced', async () => {
    const rows = (
      await pool.query(`SELECT reason, count(*)::int n FROM suppressions GROUP BY reason`)
    ).rows as { reason: string; n: number }[];
    const byReason = Object.fromEntries(rows.map((r) => [r.reason, r.n]));
    expect(byReason).toEqual({ unsubscribed: 40, hard_bounce: 18 });
    const flagged = (await pool.query(`SELECT count(*)::int n FROM leads WHERE is_suppressed`))
      .rows[0].n;
    expect(flagged).toBe(GOLDEN.expected.suppressedLeads);
  });

  it('rebuild dry-run finds ZERO drift — projection == fold(log) by construction', async () => {
    const r = await rebuildProjections(db, {
      dryRun: true,
      shapeFor: () => GOLDEN.shape,
      deliveryConfirmMs: GOLDEN.deliveryConfirmMs,
      now: new Date(GOLDEN.endOfCampaign),
    });
    expect(r.checked).toBe(885);
    expect(r.diffs).toEqual([]);
  }, 60_000);

  it('corrupted projections are detected and repaired to the exact same breakdown', async () => {
    await pool.query(
      `UPDATE enrollments SET current_state = 'ACTIVE', meeting_booked = false
       WHERE id IN (1, 300, 885)`,
    );
    const opts = {
      shapeFor: () => GOLDEN.shape,
      deliveryConfirmMs: GOLDEN.deliveryConfirmMs,
      now: new Date(GOLDEN.endOfCampaign),
    };
    const dry = await rebuildProjections(db, { ...opts, dryRun: true });
    expect(new Set(dry.diffs.map((d) => d.enrollmentId))).toEqual(new Set([1, 300, 885]));

    const real = await rebuildProjections(db, { ...opts, dryRun: false });
    expect(real.written).toBe(3);
    expect(await stateCounts(db, GOLDEN.campaignId)).toEqual(GOLDEN.expected.terminals);
  }, 60_000);
});
