// B6.4 - multipart CSV import: preview reproduces the walkthrough split on
// the committed 1,000-row fixture, commit inserts, neither appends events.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiHarness, type ApiHarness } from './helpers/app';
import { eventWatermark, expectNoNewEvents } from './helpers/events';

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/ingest/real_estate_leads.csv',
);

function multipartOf(filename: string, content: Buffer): { payload: Buffer; contentType: string } {
  const boundary = '----coldemail-test-boundary';
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: text/csv\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, content, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe('B6.4 imports', () => {
  let h: ApiHarness;

  beforeAll(async () => {
    h = await createApiHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  it('preview reproduces the exact 1000 → 885 walkthrough split; commit imports 885', async () => {
    const wm = await eventWatermark(h.pool);
    const { payload, contentType } = multipartOf('real_estate_leads.csv', readFileSync(FIXTURE));
    const preview = await h.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { 'content-type': contentType },
      payload,
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json();
    expect(body.counts).toEqual({
      ok: 885, // importable-clean display number (incl. 82 nameless)
      missing_first_name: 82,
      role_based: 60,
      invalid: 40,
      duplicate: 15,
      suppressed: 0,
    });
    expect(body.samples.role_based.length).toBeGreaterThan(0);
    expect(body.samples.role_based.length).toBeLessThanOrEqual(20);

    const commit = await h.inject({
      method: 'POST',
      url: `/api/v1/imports/${body.import_id}/commit`,
      payload: { mode: 'drop_flagged' },
    });
    expect(commit.statusCode).toBe(200);
    expect(commit.json()).toEqual({ imported: 885 });

    const leads = await h.pool.query('SELECT count(*)::int AS n FROM leads');
    expect(leads.rows[0].n).toBe(885);
    await expectNoNewEvents(h.pool, wm); // imports: none (traceability)

    // double-commit refused
    const again = await h.inject({
      method: 'POST',
      url: `/api/v1/imports/${body.import_id}/commit`,
      payload: { mode: 'drop_flagged' },
    });
    expect(again.statusCode).toBe(409);

    // history shows the committed import
    const history = (await h.inject({ method: 'GET', url: '/api/v1/imports' })).json();
    expect(history.total).toBe(1);
    expect(history.items[0]).toMatchObject({
      filename: 'real_estate_leads.csv',
      rows_total: 1000,
      committed: true,
      commit_mode: 'drop_flagged',
    });
  });

  it('missing file → 400; unknown import commit → 404', async () => {
    const { contentType } = multipartOf('x.csv', Buffer.from(''));
    const empty = await h.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { 'content-type': contentType },
      payload: Buffer.from(`------coldemail-test-boundary--\r\n`),
    });
    expect([400, 406]).toContain(empty.statusCode); // no file part

    const missing = await h.inject({
      method: 'POST',
      url: '/api/v1/imports/424242/commit',
      payload: { mode: 'import_all' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('oversize upload → 413 import_too_large', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1024, 'a'); // just past MAX_BYTES
    const { payload, contentType } = multipartOf('big.csv', big);
    const res = await h.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { 'content-type': contentType },
      payload,
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('import_too_large');
  });
});
