// B6.4 — multipart CSV import: preview reproduces the walkthrough split on
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
    expect(commit.json()).toEqual({
      imported: 885,
      leads_created: 885,
      drafts_created: 0,
      drafts_replaced: 0,
      drafts_skipped: 0,
      invalid_drafts: 0,
      allocations_created: 0,
      remaining_global: 885,
    });

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
      pool_allocations: [],
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

  it('preserves an existing lead profile and reserves its imported manual draft first', async () => {
    const existing = (
      await h.pool.query(`SELECT id, email, first_name, company FROM leads ORDER BY id LIMIT 1`)
    ).rows[0] as {
      id: number;
      email: string;
      first_name: string | null;
      company: string | null;
    };
    const sequence = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/sequences',
        payload: {
          name: 'Imported draft sequence',
          stop_on_reply: true,
          stop_on_hard_bounce: true,
          stop_on_unsubscribe: true,
          steps: [
            {
              step_no: 1,
              wait_days: 0,
              in_thread: true,
              variants: [
                {
                  label: 'A',
                  subject_template: 'Hello',
                  body_template: 'Hello there',
                  active: true,
                },
              ],
            },
          ],
        },
      })
    ).json();
    const campaign = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        payload: {
          name: 'Imported draft pool',
          sequence_id: sequence.id,
          acknowledge_tier_a_manual: true,
        },
      })
    ).json();
    const csv = Buffer.from(
      `email,first_name,company,manual_subject,manual_body\r\n` +
        `"${existing.email}","Do not overwrite","Wrong company","A researched idea","Line one\n\nLine two"\r\n` +
        `"new-draft-neighbor@example.dev","New","New Co",,\r\n`,
    );
    const { payload, contentType } = multipartOf('manual-drafts.csv', csv);
    const preview = await h.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { 'content-type': contentType },
      payload,
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().draft_counts).toMatchObject({
      existing_leads: 1,
      valid_drafts: 1,
    });
    const commit = await h.inject({
      method: 'POST',
      url: `/api/v1/imports/${preview.json().import_id}/commit`,
      payload: {
        mode: 'drop_flagged',
        draft_campaign_id: campaign.id,
        allocations: [{ campaign_id: campaign.id, count: 1 }],
      },
    });
    expect(commit.statusCode, commit.body).toBe(200);
    expect(commit.json()).toMatchObject({
      leads_created: 1,
      drafts_created: 1,
      allocations_created: 1,
      remaining_global: 1,
    });

    const unchanged = (
      await h.pool.query(`SELECT first_name, company FROM leads WHERE id = $1`, [existing.id])
    ).rows[0];
    expect(unchanged).toEqual({ first_name: existing.first_name, company: existing.company });
    expect(
      (
        await h.pool.query(
          `SELECT lead_id FROM campaign_lead_pool
            WHERE campaign_id = $1 AND status = 'available'`,
          [campaign.id],
        )
      ).rows,
    ).toEqual([{ lead_id: existing.id }]);
    expect(
      (
        await h.pool.query(
          `SELECT subject, body, status FROM manual_campaign_drafts
            WHERE campaign_id = $1 AND lead_id = $2`,
          [campaign.id, existing.id],
        )
      ).rows,
    ).toEqual([
      {
        subject: 'A researched idea',
        body: 'Line one\n\nLine two',
        status: 'needs_review',
      },
    ]);
  });

  it('aborts the entire import when exact allocation eligibility changes after preview', async () => {
    const sequence = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/sequences',
        payload: {
          name: 'Allocation drift sequence',
          stop_on_reply: true,
          stop_on_hard_bounce: true,
          stop_on_unsubscribe: true,
          steps: [
            {
              step_no: 1,
              wait_days: 0,
              in_thread: true,
              variants: [
                {
                  label: 'A',
                  subject_template: 'Drift test',
                  body_template: 'Safe allocation test',
                  active: true,
                },
              ],
            },
          ],
        },
      })
    ).json();
    const campaign = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        payload: {
          name: 'Allocation drift target',
          sequence_id: sequence.id,
          acknowledge_tier_a_manual: true,
        },
      })
    ).json();
    const csv = Buffer.from(
      'email,first_name\nallocation-drift-a@example.dev,A\nallocation-drift-b@example.dev,B\n',
    );
    const { payload, contentType } = multipartOf('allocation-drift.csv', csv);
    const preview = await h.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { 'content-type': contentType },
      payload,
    });
    expect(preview.statusCode, preview.body).toBe(200);
    const body = {
      mode: 'drop_flagged',
      allocations: [{ campaign_id: campaign.id, count: 2 }],
    };
    expect(
      (
        await h.inject({
          method: 'POST',
          url: `/api/v1/imports/${preview.json().import_id}/allocation-preview`,
          payload: body,
        })
      ).statusCode,
    ).toBe(200);
    await h.pool.query(
      `INSERT INTO suppressions (email, reason) VALUES ('allocation-drift-b@example.dev', 'manual')`,
    );

    const commit = await h.inject({
      method: 'POST',
      url: `/api/v1/imports/${preview.json().import_id}/commit`,
      payload: body,
    });
    expect(commit.statusCode).toBe(409);
    expect(
      (
        await h.pool.query(
          `SELECT count(*)::int AS n FROM leads WHERE email LIKE 'allocation-drift-%'`,
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await h.pool.query(
          `SELECT count(*)::int AS n FROM campaign_lead_pool WHERE campaign_id = $1`,
          [campaign.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await h.pool.query(`SELECT committed FROM imports WHERE id = $1`, [
          preview.json().import_id,
        ])
      ).rows[0].committed,
    ).toBe(false);
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
