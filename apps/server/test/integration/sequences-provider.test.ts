// B4.1: the 0003_sequences tables + DbSequenceProvider — the DB-backed
// SequenceProvider serves the same SequenceDef shape the scheduler consumed
// from StaticSequenceProvider in B3.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createDb, type Db } from '../../src/db/client';
import { DbSequenceProvider } from '../../src/scheduler/dbSequenceProvider';
import {
  createSequence,
  getVariantById,
  insertBespokeVariant,
} from '../../src/db/repos/sequencesRepo';
import { contentHashOf } from '../../src/render/hash';
import { TEST_DATABASE_URL, resetCoreTables } from '../helpers/db';

describe('0003_sequences + DbSequenceProvider (B4.1)', () => {
  let db: Db;
  let pool: Pool;
  let provider: DbSequenceProvider;

  beforeAll(() => {
    ({ db, pool } = createDb(TEST_DATABASE_URL));
    provider = new DbSequenceProvider(db);
  });
  afterAll(async () => {
    await resetCoreTables(pool);
    await pool.end();
  });
  beforeEach(async () => {
    await resetCoreTables(pool);
  });

  async function seedTwoStep(): Promise<number> {
    return createSequence(db, {
      name: 'two-step',
      steps: [
        {
          stepNo: 1,
          waitDays: 0,
          inThread: false,
          variants: [
            {
              label: 'A',
              subjectTemplate: 's1a',
              bodyTemplate: 'b1a',
              contentHash: contentHashOf('s1a', 'b1a'),
            },
            {
              label: 'B',
              subjectTemplate: 's1b',
              bodyTemplate: 'b1b',
              contentHash: contentHashOf('s1b', 'b1b'),
            },
            // rotated-out variant: must NOT appear in the SequenceDef
            {
              label: 'C',
              subjectTemplate: 's1c',
              bodyTemplate: 'b1c',
              contentHash: contentHashOf('s1c', 'b1c'),
              active: false,
            },
          ],
        },
        {
          stepNo: 2,
          waitDays: 3,
          inThread: true,
          variants: [
            {
              label: 'A',
              subjectTemplate: 's2a',
              bodyTemplate: 'b2a',
              contentHash: contentHashOf('s2a', 'b2a'),
            },
          ],
        },
      ],
    });
  }

  it('serves the campaign sequence: steps ordered, active variants only, label order', async () => {
    const seqId = await seedTwoStep();
    await pool.query(
      `INSERT INTO campaigns (name, status, sequence_id) VALUES ('c1', 'active', $1)`,
      [seqId],
    );

    const def = await provider.sequenceFor(1);
    expect(def.id).toBe(seqId);
    expect(def.steps.map((s) => s.stepNo)).toEqual([1, 2]);
    expect(def.steps[0]).toMatchObject({ waitDays: 0, inThread: false });
    expect(def.steps[0]!.variants.map((v) => v.label)).toEqual(['A', 'B']); // no inactive 'C'
    expect(def.steps[0]!.variants[0]!.contentHash).toBe(contentHashOf('s1a', 'b1a'));
    expect(def.steps[1]).toMatchObject({ waitDays: 3, inThread: true });
  });

  it('throws when the campaign has no sequence assigned', async () => {
    await pool.query(`INSERT INTO campaigns (name, status) VALUES ('bare', 'active')`);
    await expect(provider.sequenceFor(1)).rejects.toThrow(/no sequence assigned/);
  });

  it('campaigns.sequence_id is FK-enforced (deferred from 0001, added in 0003)', async () => {
    await expect(
      pool.query(`INSERT INTO campaigns (name, status, sequence_id) VALUES ('bad', 'draft', 999)`),
    ).rejects.toThrow(/campaigns_sequence_id_fkey/);
  });

  it('UNIQUE(step_id, label) rejects duplicate variant labels', async () => {
    await seedTwoStep();
    await expect(
      pool.query(
        `INSERT INTO step_variants (step_id, label, subject_template, body_template, content_hash)
         VALUES (1, 'A', 's', 'b', 'h')`,
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it('deleting a sequence cascades to steps and variants', async () => {
    const seqId = await seedTwoStep();
    await pool.query(`DELETE FROM sequences WHERE id = $1`, [seqId]);
    const steps = await pool.query(`SELECT count(*)::int AS n FROM sequence_steps`);
    const variants = await pool.query(`SELECT count(*)::int AS n FROM step_variants`);
    expect(steps.rows[0].n).toBe(0);
    expect(variants.rows[0].n).toBe(0);
  });

  it('bespoke variants are inactive + flagged, and still findable by id', async () => {
    await seedTwoStep();
    const id = await insertBespokeVariant(db, {
      stepId: 1,
      label: 'bespoke-e1',
      subjectTemplate: 'Hand-written subject',
      bodyTemplate: 'Hand-written body',
      contentHash: contentHashOf('Hand-written subject', 'Hand-written body'),
    });

    const row = await getVariantById(db, id);
    expect(row).toMatchObject({ active: false, attributes: { bespoke: true } });

    // never served to the round-robin
    const seqId = await pool.query(`SELECT sequence_id FROM sequence_steps WHERE id = 1`);
    await pool.query(
      `INSERT INTO campaigns (name, status, sequence_id) VALUES ('c', 'active', $1)`,
      [seqId.rows[0].sequence_id],
    );
    const def = await provider.sequenceFor(1);
    expect(def.steps[0]!.variants.map((v) => v.label)).not.toContain('bespoke-e1');
  });
});
