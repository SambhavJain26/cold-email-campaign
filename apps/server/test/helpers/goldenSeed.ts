// Seed the golden cohort into a live DB through the REAL eventStore chokepoint.
// Shared by the golden L1/L2 suites and the API-fixture exporter (B2.18).
import type { Pool } from 'pg';
import type { Db } from '../../src/db/client';
import { EventStore } from '../../src/services/eventStore';
import { GOLDEN, personalizationModeOf, tierOf } from '../fixtures/golden/constants';
import { loadGoldenEvents } from '../fixtures/golden/load';
import { resetCoreTables, seedMailboxes } from './db';

const CHUNK = 1000;

/**
 * Reset core tables, create 885 leads + campaign + enrollments (RESTART
 * IDENTITY aligns ids 1..885 with fixture seqs), append all fixture events
 * via eventStore, then run completeEligible. Returns the appended count.
 */
export async function seedGoldenCohort(db: Db, pool: Pool): Promise<number> {
  await resetCoreTables(pool);
  await seedMailboxes(pool, GOLDEN.mailboxes); // fixture events carry mailbox_id 1..4 (FK since 0004)

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

  const store = new EventStore(db);
  const events = loadGoldenEvents();
  for (let i = 0; i < events.length; i += CHUNK) {
    await store.append(events.slice(i, i + CHUNK));
  }
  await store.completeEligible(
    GOLDEN.shape,
    GOLDEN.deliveryConfirmMs,
    new Date(GOLDEN.endOfCampaign),
    GOLDEN.campaignId,
  );
  return events.length;
}
