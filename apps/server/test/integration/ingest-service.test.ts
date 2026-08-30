// B5.3–B5.5: preview persistence, commit modes, suppression-at-ingest —
// against the real test DB.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createDb, type Db } from '../../src/db/client';
import { commitImport, createImportPreview } from '../../src/ingest/service';
import { TEST_DATABASE_URL, resetCoreTables } from '../helpers/db';

const buf = (s: string): Buffer => Buffer.from(s, 'utf8');

const FILE =
  'email,first_name,company,Deal Size\n' +
  'ann@acme.dev,Ann,Acme,10k\n' + // ok
  'bob@beta.dev,,Beta,\n' + // missing_first_name (importable)
  'info@gamma.dev,Pat,Gamma,\n' + // role_based
  'broken@@x,Zed,,\n' + // invalid
  'ann@acme.dev,Ann2,,\n' + // duplicate (within file)
  'gone@delta.dev,Del,Delta,\n'; // suppressed (seeded below)

describe('ingest service (B5.3–B5.5)', () => {
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
      `INSERT INTO suppressions (email, reason, created_at) VALUES ('gone@delta.dev', 'unsubscribed', now())`,
    );
  });

  it('preview: counts follow the docs/03 contract; rows + samples persist', async () => {
    const p = await createImportPreview({ db }, { filename: 'leads.csv', content: buf(FILE) });
    expect(p.rowsTotal).toBe(6);
    expect(p.counts).toEqual({
      ok: 2, // importable-clean display number (1 ok + 1 missing_first_name)
      missing_first_name: 1,
      role_based: 1,
      invalid: 1,
      duplicate: 1,
      suppressed: 1,
    });
    expect(p.samples.suppressed).toEqual([{ rowNo: 6, email: 'gone@delta.dev' }]);

    const persisted = await pool.query(
      `SELECT flag, count(*)::int n FROM import_rows GROUP BY flag ORDER BY flag`,
    );
    expect(
      Object.fromEntries(persisted.rows.map((r: { flag: string; n: number }) => [r.flag, r.n])),
    ).toEqual({
      ok: 1,
      missing_first_name: 1,
      role_based: 1,
      invalid: 1,
      duplicate: 1,
      suppressed: 1,
    });
    expect((await pool.query(`SELECT count(*)::int n FROM leads`)).rows[0].n).toBe(0); // nothing committed
  });

  it('drop_flagged commits ok + missing_first_name only; fields + custom_fields land; tier NULL', async () => {
    const p = await createImportPreview({ db }, { filename: 'leads.csv', content: buf(FILE) });
    const r = await commitImport({ db }, { importId: p.importId, mode: 'drop_flagged' });
    expect(r).toEqual({
      inserted: 2,
      skipped: 0,
      sourcesCreated: 0,
      sourcesReplaced: 0,
      sourcesSkipped: 0,
      copiesBound: 0,
      copiesUnassigned: 0,
      copyConflicts: 0,
      draftsCreated: 0,
      draftsReplaced: 0,
      draftsSkipped: 0,
      invalidDrafts: 0,
      allocationsCreated: 0,
      remainingGlobal: 2,
    });

    const rows = await pool.query(
      `SELECT email, first_name, company, custom_fields, tier, import_id FROM leads ORDER BY email`,
    );
    expect(rows.rows).toEqual([
      {
        email: 'ann@acme.dev',
        first_name: 'Ann',
        company: 'Acme',
        custom_fields: { deal_size: '10k' },
        tier: null,
        import_id: p.importId,
      },
      {
        email: 'bob@beta.dev',
        first_name: null,
        company: 'Beta',
        custom_fields: {},
        tier: null,
        import_id: p.importId,
      },
    ]);

    // lead_id backfilled on exactly the imported rows; import marked committed
    const backfilled = await pool.query(
      `SELECT count(*)::int n FROM import_rows WHERE lead_id IS NOT NULL`,
    );
    expect(backfilled.rows[0].n).toBe(2);
    const imp = await pool.query(`SELECT committed, commit_mode FROM imports`);
    expect(imp.rows[0]).toEqual({ committed: true, commit_mode: 'drop_flagged' });
  });

  it('import_all additionally admits role_based — but NEVER invalid or suppressed', async () => {
    const p = await createImportPreview({ db }, { filename: 'leads.csv', content: buf(FILE) });
    const r = await commitImport({ db }, { importId: p.importId, mode: 'import_all' });
    expect(r.inserted).toBe(3);
    const emails = await pool.query(`SELECT email FROM leads ORDER BY email`);
    expect(emails.rows.map((x: { email: string }) => x.email)).toEqual([
      'ann@acme.dev',
      'bob@beta.dev',
      'info@gamma.dev',
    ]);
  });

  it('an address suppressed AFTER preview is still dropped at commit', async () => {
    const p = await createImportPreview({ db }, { filename: 'leads.csv', content: buf(FILE) });
    await pool.query(
      `INSERT INTO suppressions (email, reason, created_at) VALUES ('ann@acme.dev', 'manual', now())`,
    );
    const r = await commitImport({ db }, { importId: p.importId, mode: 'drop_flagged' });
    expect(r).toEqual({
      inserted: 1,
      skipped: 1,
      sourcesCreated: 0,
      sourcesReplaced: 0,
      sourcesSkipped: 0,
      copiesBound: 0,
      copiesUnassigned: 0,
      copyConflicts: 0,
      draftsCreated: 0,
      draftsReplaced: 0,
      draftsSkipped: 0,
      invalidDrafts: 0,
      allocationsCreated: 0,
      remainingGlobal: 1,
    }); // only bob
    const emails = await pool.query(`SELECT email FROM leads`);
    expect(emails.rows).toEqual([{ email: 'bob@beta.dev' }]);
  });

  it('re-importing a committed file flags every row duplicate (or suppressed)', async () => {
    const p1 = await createImportPreview({ db }, { filename: 'a.csv', content: buf(FILE) });
    await commitImport({ db }, { importId: p1.importId, mode: 'drop_flagged' });

    const p2 = await createImportPreview({ db }, { filename: 'b.csv', content: buf(FILE) });
    expect(p2.counts).toEqual({
      ok: 0,
      missing_first_name: 0,
      role_based: 1, // role check ranks above duplicate
      invalid: 1,
      duplicate: 3, // ann (exists), bob (exists), in-file dup of ann
      suppressed: 1,
    });
    const r = await commitImport({ db }, { importId: p2.importId, mode: 'drop_flagged' });
    expect(r).toEqual({
      inserted: 0,
      skipped: 0,
      sourcesCreated: 0,
      sourcesReplaced: 0,
      sourcesSkipped: 0,
      copiesBound: 0,
      copiesUnassigned: 0,
      copyConflicts: 0,
      draftsCreated: 0,
      draftsReplaced: 0,
      draftsSkipped: 0,
      invalidDrafts: 0,
      allocationsCreated: 0,
      remainingGlobal: 2,
    });
  });

  it('a lead created between preview and commit is skipped, not an error', async () => {
    const p = await createImportPreview({ db }, { filename: 'leads.csv', content: buf(FILE) });
    await pool.query(`INSERT INTO leads (email) VALUES ('ann@acme.dev')`);
    const r = await commitImport({ db }, { importId: p.importId, mode: 'drop_flagged' });
    expect(r).toEqual({
      inserted: 1,
      skipped: 1,
      sourcesCreated: 0,
      sourcesReplaced: 0,
      sourcesSkipped: 0,
      copiesBound: 0,
      copiesUnassigned: 0,
      copyConflicts: 0,
      draftsCreated: 0,
      draftsReplaced: 0,
      draftsSkipped: 0,
      invalidDrafts: 0,
      allocationsCreated: 0,
      remainingGlobal: 2,
    });
  });

  it('double commit is refused', async () => {
    const p = await createImportPreview({ db }, { filename: 'leads.csv', content: buf(FILE) });
    await commitImport({ db }, { importId: p.importId, mode: 'drop_flagged' });
    await expect(
      commitImport({ db }, { importId: p.importId, mode: 'import_all' }),
    ).rejects.toThrow(/already committed/);
  });

  it('imports multiline personalized sources globally and replaces them only when explicit', async () => {
    await pool.query(
      `INSERT INTO leads (email, first_name, company, custom_fields)
       VALUES ('existing@acme.dev', 'Original', 'Original Co', '{"industry":"saas"}')`,
    );
    await pool.query(
      `INSERT INTO suppressions (email, reason) VALUES ('blocked@acme.dev', 'unsubscribed')`,
    );
    const csv =
      'email,first_name,company,manual_subject,manual_body\n' +
      'new@acme.dev,New,New Co,"Idea for New Co","Hi New,\n\nI noticed the expansion.\n\nWorth comparing notes?"\n' +
      'existing@acme.dev,Overwrite,Wrong Co,"Idea for Original Co","Hi Original,\n\nYour SaaS motion stood out."\n' +
      'blocked@acme.dev,Blocked,Blocked Co,"Blocked","Must never be stored"\n' +
      'incomplete@acme.dev,Incomplete,Test,"Only a subject",\n';

    const preview = await createImportPreview(
      { db },
      { filename: 'researched.csv', content: buf(csv) },
    );
    expect(preview.draftCounts).toMatchObject({ validDrafts: 2, invalidDrafts: 1 });
    const committed = await commitImport(
      { db },
      { importId: preview.importId, mode: 'drop_flagged' },
    );
    expect(committed).toMatchObject({
      inserted: 2,
      sourcesCreated: 2,
      sourcesReplaced: 0,
      sourcesSkipped: 1,
      copiesBound: 0,
      copiesUnassigned: 2,
      invalidDrafts: 1,
    });
    const existing = await pool.query(
      `SELECT first_name, company, custom_fields FROM leads WHERE email = 'existing@acme.dev'`,
    );
    expect(existing.rows[0]).toEqual({
      first_name: 'Original',
      company: 'Original Co',
      custom_fields: { industry: 'saas' },
    });
    const sources = await pool.query(
      `SELECT l.email, d.slot_no, d.status, d.subject, d.body
         FROM personalized_copy_sources d JOIN leads l ON l.id = d.lead_id
        ORDER BY l.email`,
    );
    expect(sources.rows).toHaveLength(2);
    expect(sources.rows[1].body).toContain('I noticed the expansion.\n\nWorth comparing notes?');

    const second = await createImportPreview(
      { db },
      {
        filename: 'replacement.csv',
        content: buf(
          'email,manual_subject,manual_body\nexisting@acme.dev,"Replacement","Replacement body"\n',
        ),
      },
    );
    expect(
      await commitImport({ db }, { importId: second.importId, mode: 'drop_flagged' }),
    ).toMatchObject({ sourcesCreated: 0, sourcesReplaced: 0, sourcesSkipped: 1 });

    const third = await createImportPreview(
      { db },
      {
        filename: 'replacement-explicit.csv',
        content: buf(
          'email,manual_subject,manual_body\nexisting@acme.dev,"Replacement","Replacement body"\n',
        ),
      },
    );
    expect(
      await commitImport(
        { db },
        {
          importId: third.importId,
          mode: 'drop_flagged',
          replaceExistingDrafts: true,
        },
      ),
    ).toMatchObject({ sourcesReplaced: 1 });
    const replaced = await pool.query(
      `SELECT subject, body, status FROM personalized_copy_sources d
       JOIN leads l ON l.id = d.lead_id WHERE l.email = 'existing@acme.dev'`,
    );
    expect(replaced.rows[0]).toEqual({
      subject: 'Replacement',
      body: 'Replacement body',
      status: 'needs_review',
    });
  });
});
