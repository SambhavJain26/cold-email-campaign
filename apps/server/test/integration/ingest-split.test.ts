// B5.8: the walkthrough's 1,000 → 885 split, locked against the committed
// fixture CSV. B5.9: the docs/09 §7 edges not already covered by the parse/
// hygiene/service/recycle suites.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createDb, type Db } from '../../src/db/client';
import { EventStore } from '../../src/services/eventStore';
import { VirtualClock } from '../../src/clock/virtual';
import { StaticSequenceProvider } from '../../src/scheduler/staticSequenceProvider';
import { commitImport, createImportPreview } from '../../src/ingest/service';
import { enroll } from '../../src/services/enrollment';
import { generateFixtureCsv, SPLIT } from '../fixtures/ingest/generate';
import { testSequence } from '../helpers/sequences';
import { TEST_DATABASE_URL, resetCoreTables, seedMailboxes } from '../helpers/db';

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/ingest/real_estate_leads.csv',
);

describe('the 1000 → 885 fixture split (B5.8)', () => {
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
  });

  it('generator ⇔ committed CSV (determinism lock — regenerate only deliberately)', () => {
    const committed = readFileSync(FIXTURE_PATH, 'utf8').replaceAll('\r\n', '\n');
    expect(committed).toBe(generateFixtureCsv());
  });

  it('preview reproduces the exact walkthrough split; commit imports 885 with 82 nameless', async () => {
    const content = readFileSync(FIXTURE_PATH);
    const p = await createImportPreview({ db }, { filename: 'real_estate_leads.csv', content });

    expect(p.rowsTotal).toBe(SPLIT.total);
    // spec P10 / docs/09 §3: 1,000 → 60 role + 40 invalid + 15 dup → 885
    expect(p.counts).toEqual({
      ok: 885,
      missing_first_name: 82,
      role_based: 60,
      invalid: 40,
      duplicate: 15,
      suppressed: 0,
    });

    const r = await commitImport({ db }, { importId: p.importId, mode: 'drop_flagged' });
    expect(r).toEqual({
      inserted: 885,
      skipped: 0,
      draftsCreated: 0,
      draftsReplaced: 0,
      draftsSkipped: 0,
      invalidDrafts: 0,
    });

    const leads = await pool.query(
      `SELECT count(*)::int total,
              count(*) FILTER (WHERE first_name IS NULL)::int nameless,
              count(*) FILTER (WHERE tier IS NOT NULL)::int tiered
       FROM leads`,
    );
    expect(leads.rows[0]).toEqual({ total: 885, nameless: 82, tiered: 0 }); // untiered on import
  });

  it("import_all admits the 60 role-based on top — invalid never ('Import 945')", async () => {
    const content = readFileSync(FIXTURE_PATH);
    const p = await createImportPreview({ db }, { filename: 'real_estate_leads.csv', content });
    const r = await commitImport({ db }, { importId: p.importId, mode: 'import_all' });
    expect(r.inserted).toBe(945); // 885 + 60
  });
});

describe('remaining docs/09 §7 edges (B5.9)', () => {
  let db: Db;
  let pool: Pool;
  let store: EventStore;

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
  });

  it('a suppressed address is dropped under BOTH commit modes', async () => {
    await pool.query(
      `INSERT INTO suppressions (email, reason, created_at) VALUES ('opted-out@x.dev', 'unsubscribed', now())`,
    );
    const file = Buffer.from('email,first_name\nopted-out@x.dev,Sam\nfine@x.dev,Ann\n');
    for (const mode of ['drop_flagged', 'import_all'] as const) {
      await resetCoreTables(pool);
      await pool.query(
        `INSERT INTO suppressions (email, reason, created_at) VALUES ('opted-out@x.dev', 'unsubscribed', now())`,
      );
      const p = await createImportPreview({ db }, { filename: 'f.csv', content: file });
      expect(p.counts.suppressed).toBe(1);
      await commitImport({ db }, { importId: p.importId, mode });
      const emails = await pool.query(`SELECT email FROM leads`);
      expect(emails.rows).toEqual([{ email: 'fine@x.dev' }]);
    }
  });

  it('nurture leads are excluded from auto-enroll selection (docs/06 §7)', async () => {
    const clock = new VirtualClock('2026-03-02T15:00:00Z');
    const sequences = new StaticSequenceProvider();
    sequences.register(1, testSequence(1, [0]));
    await seedMailboxes(pool, 1);
    await pool.query(`INSERT INTO campaigns (name, status) VALUES ('c', 'active')`);
    await pool.query(
      `INSERT INTO leads (email, tier) VALUES
       ('a@x.dev', 'nurture'), ('b@x.dev', 'C'), ('c@x.dev', NULL)`,
    );

    const r = await enroll({ db, store, clock, sequences }, 1, 10, { force: true });
    expect(r.enrolled).toBe(2);
    expect(r.leadIds.sort()).toEqual([2, 3]); // the nurture lead stays out
  });
});
