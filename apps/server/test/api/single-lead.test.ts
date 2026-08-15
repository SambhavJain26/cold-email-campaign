// Single-lead creation (finding 10). The value of this route is precisely that
// it is NOT a shortcut: every hygiene rule the CSV path enforces must apply
// identically, because the reason POST /leads did not exist was the fear of
// exactly that divergence.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiHarness, type ApiHarness } from './helpers/app';

let h: ApiHarness;

const post = (payload: Record<string, unknown>) =>
  h.inject({ method: 'POST', url: '/api/v1/leads', payload });

const leadRow = async (email: string) =>
  (await h.pool.query(`SELECT * FROM leads WHERE email = $1`, [email])).rows[0];

beforeAll(async () => {
  h = await createApiHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
});

describe('POST /leads', () => {
  it('creates a lead and normalizes the email like the CSV path (decision L)', async () => {
    const res = await post({ email: '  Sarah@Acme.DEV ', first_name: 'Sarah', company: 'Acme' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ created: true });
    const row = await leadRow('sarah@acme.dev');
    expect(row).toBeDefined();
    expect(row.first_name).toBe('Sarah');
    expect(row.company).toBe('Acme');
  });

  it('starts the lead untiered — decision R, same as an import', async () => {
    await post({ email: 'untiered@acme.dev' });
    expect((await leadRow('untiered@acme.dev')).tier).toBeNull();
  });

  it('refuses a syntactically invalid address', async () => {
    const res = await post({ email: 'not-an-email' });
    expect(res.json()).toEqual({ created: false, reason: 'invalid' });
  });

  it('refuses a duplicate rather than creating a second row', async () => {
    await post({ email: 'dupe@acme.dev' });
    const second = await post({ email: 'dupe@acme.dev' });

    expect(second.json()).toEqual({ created: false, reason: 'duplicate' });
    const rows = await h.pool.query(`SELECT count(*)::int AS n FROM leads WHERE email = $1`, [
      'dupe@acme.dev',
    ]);
    expect(rows.rows[0].n).toBe(1);
  });

  it('refuses a suppressed address — the compliance layer is not bypassable', async () => {
    await h.pool.query(
      `INSERT INTO suppressions (email, reason, created_at) VALUES ($1, 'unsubscribed', now())`,
      ['gone@acme.dev'],
    );
    const res = await post({ email: 'gone@acme.dev' });

    expect(res.json()).toEqual({ created: false, reason: 'suppressed' });
    expect(await leadRow('gone@acme.dev')).toBeUndefined();
  });

  it('refuses a role-based address — strict mode, never laxer than bulk', async () => {
    // The single-add path commits with drop_flagged, so it cannot be used to
    // sneak in rows the safe bulk default would have dropped.
    const res = await post({ email: 'info@acme.dev' });
    expect(res.json()).toEqual({ created: false, reason: 'role_based' });
  });

  it('accepts a row with no first name — importable-clean, same as CSV', async () => {
    const res = await post({ email: 'nofirst@acme.dev', company: 'Acme' });
    expect(res.json()).toEqual({ created: true });
  });

  it('survives quotes and commas in a field without corrupting the row', async () => {
    // The one-row CSV is built by us, so quoting is our bug to make.
    const res = await post({
      email: 'quoted@acme.dev',
      company: 'Acme, "The" Agency',
      notes: 'said "yes, maybe"',
    });

    expect(res.json()).toEqual({ created: true });
    expect((await leadRow('quoted@acme.dev')).company).toBe('Acme, "The" Agency');
  });

  it('leaves an audit trail — the add really is an import', async () => {
    await post({ email: 'audit@acme.dev' });
    const imports = await h.pool.query(`SELECT filename, committed FROM imports`);
    expect(imports.rows).toHaveLength(1);
    expect(imports.rows[0].filename).toContain('audit@acme.dev');
    expect(imports.rows[0].committed).toBe(true);
  });
});
