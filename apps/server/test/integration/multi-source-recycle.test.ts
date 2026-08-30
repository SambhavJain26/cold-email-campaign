import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createDb, type Db } from '../../src/db/client';
import { EventStore } from '../../src/services/eventStore';
import { VirtualClock } from '../../src/clock/virtual';
import { commitRecycle, previewRecycle } from '../../src/services/recycling';
import { TEST_DATABASE_URL, resetCoreTables, seedMailboxes } from '../helpers/db';

const NOW = new Date('2026-08-25T10:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

describe('multi-source cold-storage recycling', () => {
  let db: Db;
  let pool: Pool;
  let store: EventStore;
  let clock: VirtualClock;

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
    clock = new VirtualClock(NOW.toISOString());

    await pool.query(`INSERT INTO sequences (name) VALUES ('new second-pass angle')`);
    await pool.query(
      `INSERT INTO sequence_steps (sequence_id, step_no, wait_days, in_thread)
       VALUES (1, 1, 0, false)`,
    );
    await pool.query(
      `INSERT INTO step_variants
         (step_id, label, subject_template, body_template, content_hash)
       VALUES (1, 'A', 'A new angle', 'Fresh copy', 'new-angle-hash')`,
    );
    await pool.query(
      `INSERT INTO campaigns (name, status, sequence_id) VALUES
       ('Source Alpha', 'completed', NULL),
       ('Source Beta', 'completed', NULL),
       ('Combined Pass', 'draft', 1)`,
    );
    await pool.query(
      `INSERT INTO leads (email, tier, outreach_status, is_suppressed) VALUES
       ('both@example.test', 'A', 'standard', false),
       ('alpha-only@example.test', 'B', 'standard', false),
       ('resting@example.test', 'B', 'standard', false),
       ('nurture@example.test', NULL, 'nurture', false),
       ('suppressed@example.test', 'B', 'standard', true),
       ('replied@example.test', 'B', 'standard', false),
       ('already-target@example.test', 'B', 'standard', false),
       ('conflict@example.test', 'B', 'standard', false),
       ('changes-after-preview@example.test', 'B', 'standard', false)`,
    );

    const sourceRows = [
      [1, 1, 90],
      [1, 2, 90],
      [2, 1, 90],
      [3, 1, 10],
      [4, 1, 90],
      [5, 2, 90],
      [6, 2, 90],
      [7, 1, 90],
      [8, 2, 90],
      [9, 1, 90],
    ] as const;
    for (const [leadId, campaignId, restDays] of sourceRows) {
      await pool.query(
        `INSERT INTO enrollments
           (lead_id, campaign_id, current_state, personalization_mode, enrolled_tier,
            enrolled_at, terminal_at)
         VALUES ($1, $2, 'COMPLETED', 'template_researched',
                 (SELECT tier FROM leads WHERE id = $1), $3, $4)`,
        [leadId, campaignId, daysAgo(120), daysAgo(restDays)],
      );
    }

    await pool.query(
      `INSERT INTO enrollments
         (lead_id, campaign_id, current_state, personalization_mode, enrolled_tier, enrolled_at)
       VALUES (7, 3, 'NEW', 'template_researched', 'B', $1)`,
      [daysAgo(1)],
    );
    await pool.query(
      `INSERT INTO sent_messages
         (message_id, enrollment_id, lead_id, mailbox_id, step_no, content_hash, sent_at)
       VALUES ('<conflict@example.test>', 9, 8, 1, 1, 'new-angle-hash', $1)`,
      [daysAgo(80)],
    );
    await pool.query(
      `INSERT INTO events
         (type, occurred_at, lead_id, enrollment_id, campaign_id, step_no, message_id, sentiment)
       VALUES ('human_reply', $1, 6, 7, 2, 1, '<reply@example.test>', 'neutral')`,
      [daysAgo(70)],
    );
  });

  it('deduplicates, reports every exclusion, rechecks at commit, and preserves provenance', async () => {
    const preview = await previewRecycle({ db, clock }, 3, [1, 2]);
    expect(preview.breakdown).toEqual({
      uniqueLeads: 9,
      duplicates: 1,
      restPeriodFailures: 1,
      nurtureExclusions: 1,
      untieredExclusions: 0,
      personalizedCopyBlocks: 0,
      suppressionRecontactBlocks: 2,
      existingTargetEnrollments: 1,
      priorContentConflicts: 1,
      eligible: 3,
    });
    expect(preview.sources).toEqual([
      { sourceCampaignId: 1, name: 'Source Alpha', candidates: 6, eligible: 3 },
      { sourceCampaignId: 2, name: 'Source Beta', candidates: 4, eligible: 1 },
    ]);

    // Eligibility changed after preview: confirmation must not trust stale preview results.
    await pool.query(`UPDATE leads SET is_suppressed = true WHERE id = 9`);
    const committed = await commitRecycle({ db, store, clock }, 3, [1, 2]);
    expect(committed.leadIds).toEqual([1, 2]);
    expect(committed.enrolled).toBe(2);
    expect(committed.breakdown.suppressionRecontactBlocks).toBe(3);

    const targetRows = await pool.query(
      `SELECT lead_id, current_state FROM enrollments WHERE campaign_id = 3 ORDER BY lead_id`,
    );
    expect(targetRows.rows).toEqual([
      { lead_id: 1, current_state: 'ACTIVE' },
      { lead_id: 2, current_state: 'ACTIVE' },
      { lead_id: 7, current_state: 'NEW' },
    ]);
    expect(
      (
        await pool.query(
          `SELECT source_campaign_id, count(DISTINCT target_enrollment_id)::int AS leads
           FROM recycle_enrollment_sources GROUP BY source_campaign_id ORDER BY source_campaign_id`,
        )
      ).rows,
    ).toEqual([
      { source_campaign_id: 1, leads: 2 },
      { source_campaign_id: 2, leads: 1 },
    ]);
    expect(
      (
        await pool.query(
          `SELECT source_campaign_id FROM campaign_recycle_sources
           WHERE target_campaign_id = 3 ORDER BY source_campaign_id`,
        )
      ).rows,
    ).toEqual([{ source_campaign_id: 1 }, { source_campaign_id: 2 }]);
    expect(
      (await pool.query(`SELECT recycled_from_campaign_id FROM campaigns WHERE id = 3`)).rows[0]
        .recycled_from_campaign_id,
    ).toBeNull();
    expect(
      (
        await pool.query(
          `SELECT count(*)::int n FROM events WHERE campaign_id = 3 AND type = 'enrolled'`,
        )
      ).rows[0].n,
    ).toBe(2);
  });

  it('rolls the enrollment and event ledger back together if provenance persistence fails', async () => {
    await pool.query(`
      CREATE FUNCTION fail_recycle_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test provenance failure'; END $$;
      CREATE TRIGGER fail_recycle_provenance
        BEFORE INSERT ON recycle_enrollment_sources
        FOR EACH STATEMENT EXECUTE FUNCTION fail_recycle_provenance();`);
    try {
      await expect(commitRecycle({ db, store, clock }, 3, [1, 2])).rejects.toThrow(
        /recycle_enrollment_sources/,
      );
    } finally {
      await pool.query(`DROP TRIGGER fail_recycle_provenance ON recycle_enrollment_sources`);
      await pool.query(`DROP FUNCTION fail_recycle_provenance()`);
    }
    expect(
      (await pool.query(`SELECT count(*)::int n FROM enrollments WHERE campaign_id = 3`)).rows[0].n,
    ).toBe(1);
    expect(
      (await pool.query(`SELECT count(*)::int n FROM events WHERE campaign_id = 3`)).rows[0].n,
    ).toBe(0);
    expect(
      (await pool.query(`SELECT count(*)::int n FROM campaign_recycle_sources`)).rows[0].n,
    ).toBe(0);
  });

  it('fails safely when the target is activated after preview', async () => {
    expect((await previewRecycle({ db, clock }, 3, [1, 2])).breakdown.eligible).toBe(3);
    await pool.query(`UPDATE campaigns SET status = 'active' WHERE id = 3`);
    await expect(commitRecycle({ db, store, clock }, 3, [1, 2])).rejects.toThrow(/draft/);
    expect(
      (await pool.query(`SELECT count(*)::int n FROM enrollments WHERE campaign_id = 3`)).rows[0].n,
    ).toBe(1);
  });
});
