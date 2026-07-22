// B1.6: rebuild-projections - drift detection (dry-run) and repair.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createDb, type Db } from '../../src/db/client';
import { EventStore } from '../../src/services/eventStore';
import { rebuildProjections } from '../../src/services/rebuildProjections';
import { buildEvent } from '../../src/domain/events';
import { TEST_DATABASE_URL, resetCoreTables } from '../helpers/db';

const at = (min: number) => new Date(Date.UTC(2026, 2, 3, 9, min));
const shapeFor = () => ({ lastStepNo: 4, softRetryMax: 2 });
const opts = { shapeFor, deliveryConfirmMs: 6 * 3_600_000, now: at(600) };

describe('rebuildProjections', () => {
  let db: Db;
  let pool: Pool;
  let enrollmentId: number;

  beforeAll(async () => {
    ({ db, pool } = createDb(TEST_DATABASE_URL));
    await resetCoreTables(pool);
    const leadId = (
      await pool.query(`INSERT INTO leads (email) VALUES ('rb@test.dev') RETURNING id`)
    ).rows[0].id;
    const campaignId = (await pool.query(`INSERT INTO campaigns (name) VALUES ('rb') RETURNING id`))
      .rows[0].id;
    enrollmentId = (
      await pool.query(
        `INSERT INTO enrollments (lead_id, campaign_id, current_state, personalization_mode, enrolled_at)
         VALUES ($1, $2, 'NEW', 'template_auto', now()) RETURNING id`,
        [leadId, campaignId],
      )
    ).rows[0].id;
    const store = new EventStore(db);
    await store.append([
      buildEvent.enrolled({ leadId, enrollmentId, campaignId, occurredAt: at(0) }),
      buildEvent.humanReply({
        leadId,
        enrollmentId,
        campaignId,
        occurredAt: at(1),
        stepNo: 1,
        sentiment: 'positive',
      }),
    ]);
  });

  afterAll(async () => {
    await resetCoreTables(pool);
    await pool.end();
  });

  it('clean state: dry-run reports zero diffs (projection == fold(log))', async () => {
    const r = await rebuildProjections(db, { ...opts, dryRun: true });
    expect(r.checked).toBe(1);
    expect(r.diffs).toEqual([]);
  });

  it('detects a corrupted projection in dry-run, then repairs it for real', async () => {
    // corrupt the projection directly (enrollments is writable; events is not)
    await pool.query(
      `UPDATE enrollments SET current_state = 'COMPLETED', best_reply_sentiment = NULL WHERE id = $1`,
      [enrollmentId],
    );

    const dry = await rebuildProjections(db, { ...opts, dryRun: true });
    const fields = dry.diffs.map((d) => d.field).sort();
    expect(fields).toEqual(['best_reply_sentiment', 'current_state']);
    expect(dry.written).toBe(0);
    // dry-run wrote nothing
    const still = (
      await pool.query(`SELECT current_state FROM enrollments WHERE id = $1`, [enrollmentId])
    ).rows[0];
    expect(still.current_state).toBe('COMPLETED');

    const real = await rebuildProjections(db, { ...opts, dryRun: false });
    expect(real.written).toBe(1);
    const fixed = (
      await pool.query(
        `SELECT current_state, best_reply_sentiment FROM enrollments WHERE id = $1`,
        [enrollmentId],
      )
    ).rows[0];
    expect(fixed.current_state).toBe('REPLIED');
    expect(fixed.best_reply_sentiment).toBe('positive');
  });
});
