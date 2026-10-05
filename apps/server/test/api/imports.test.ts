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
      sources_created: 0,
      sources_replaced: 0,
      sources_skipped: 0,
      copies_bound: 0,
      copy_conflicts: 0,
      copies_unassigned: 0,
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

  it('discards an abandoned preview but preserves committed history', async () => {
    const wm = await eventWatermark(h.pool);
    const { payload, contentType } = multipartOf(
      'abandoned.csv',
      Buffer.from('email\npreview-only@example.com\n'),
    );
    const preview = await h.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { 'content-type': contentType },
      payload,
    });
    expect(preview.statusCode).toBe(200);
    const importId = preview.json().import_id as number;

    const discarded = await h.inject({ method: 'DELETE', url: `/api/v1/imports/${importId}` });
    expect(discarded.statusCode).toBe(200);
    expect(discarded.json()).toEqual({ ok: true });
    expect((await h.pool.query('SELECT 1 FROM imports WHERE id = $1', [importId])).rowCount).toBe(
      0,
    );

    const committed = (await h.pool.query('SELECT id FROM imports WHERE committed LIMIT 1')).rows[0]
      .id as number;
    const refused = await h.inject({ method: 'DELETE', url: `/api/v1/imports/${committed}` });
    expect(refused.statusCode).toBe(409);
    await expectNoNewEvents(h.pool, wm);
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
              content_source: 'personalized',
              variants: [],
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
        // Older clients may still send false; valid CSV copy is ready regardless.
        mark_valid_copy_ready: false,
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
          `SELECT subject, body, status FROM campaign_personalized_copies
            WHERE campaign_id = $1 AND lead_id = $2`,
          [campaign.id, existing.id],
        )
      ).rows,
    ).toEqual([
      {
        subject: 'A researched idea',
        body: 'Line one\n\nLine two',
        status: 'ready',
      },
    ]);
  });

  it('requires and applies a per-campaign destination for generic copy in multi-personalized-step sequences', async () => {
    const oneStepSequence = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/sequences',
        payload: {
          name: 'Import one personalized step',
          stop_on_reply: true,
          steps: [
            {
              step_no: 1,
              wait_days: 0,
              in_thread: false,
              content_source: 'personalized',
              variants: [],
            },
          ],
        },
      })
    ).json();
    const multiStepSequence = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/sequences',
        payload: {
          name: 'Import two personalized steps',
          stop_on_reply: true,
          steps: [
            {
              step_no: 1,
              wait_days: 0,
              in_thread: false,
              content_source: 'personalized',
              variants: [],
            },
            {
              step_no: 2,
              wait_days: 1,
              in_thread: true,
              content_source: 'template',
              variants: [
                {
                  label: 'A',
                  subject_template: 'Template follow-up',
                  body_template: 'Following up',
                  active: true,
                },
              ],
            },
            {
              step_no: 3,
              wait_days: 1,
              in_thread: true,
              content_source: 'personalized',
              variants: [],
            },
          ],
        },
      })
    ).json();
    const oneStepCampaign = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        payload: { name: 'Import Atlas', sequence_id: oneStepSequence.id },
      })
    ).json();
    const multiStepCampaign = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        payload: { name: 'Import Beacon', sequence_id: multiStepSequence.id },
      })
    ).json();
    const csv = Buffer.from(
      [
        'email,first_name,manual_subject,manual_body',
        ...Array.from(
          { length: 5 },
          (_, index) =>
            `import-binding-${index + 1}@example.dev,Lead ${index + 1},Subject ${index + 1},Body ${index + 1}`,
        ),
      ].join('\n'),
    );
    const multipart = multipartOf('generic-copy-binding.csv', csv);
    const preview = await h.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { 'content-type': multipart.contentType },
      payload: multipart.payload,
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().draft_counts).toMatchObject({
      valid_drafts: 5,
    });

    const incompleteMapping = {
      mode: 'drop_flagged' as const,
      allocations: [
        { campaign_id: oneStepCampaign.id, count: 2 },
        { campaign_id: multiStepCampaign.id, count: 3 },
      ],
    };
    const mappingPreview = await h.inject({
      method: 'POST',
      url: `/api/v1/imports/${preview.json().import_id}/allocation-preview`,
      payload: incompleteMapping,
    });
    expect(mappingPreview.statusCode, mappingPreview.body).toBe(200);
    expect(mappingPreview.json().campaigns).toEqual([
      expect.objectContaining({
        campaign_id: oneStepCampaign.id,
        personalized_steps: [1],
        generic_copies: 2,
        resolved_generic_copy_step_no: 1,
        generic_copy_step_required: false,
        copies_bound: 2,
      }),
      expect.objectContaining({
        campaign_id: multiStepCampaign.id,
        personalized_steps: [1, 3],
        generic_copies: 3,
        resolved_generic_copy_step_no: null,
        generic_copy_step_required: true,
        copies_bound: 0,
        copies_unassigned: 3,
      }),
    ]);

    const refused = await h.inject({
      method: 'POST',
      url: `/api/v1/imports/${preview.json().import_id}/commit`,
      payload: incompleteMapping,
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(
      (
        await h.pool.query(
          `SELECT count(*)::int AS n FROM leads WHERE email LIKE 'import-binding-%'`,
        )
      ).rows[0].n,
    ).toBe(0);

    const invalidStep = await h.inject({
      method: 'POST',
      url: `/api/v1/imports/${preview.json().import_id}/allocation-preview`,
      payload: {
        ...incompleteMapping,
        allocations: [
          incompleteMapping.allocations[0],
          { campaign_id: multiStepCampaign.id, count: 3, generic_copy_step_no: 2 },
        ],
      },
    });
    expect(invalidStep.statusCode, invalidStep.body).toBe(409);

    const completeMapping = {
      ...incompleteMapping,
      allocations: [
        incompleteMapping.allocations[0],
        { campaign_id: multiStepCampaign.id, count: 3, generic_copy_step_no: 1 },
      ],
    };
    const completePreview = await h.inject({
      method: 'POST',
      url: `/api/v1/imports/${preview.json().import_id}/allocation-preview`,
      payload: completeMapping,
    });
    expect(completePreview.statusCode, completePreview.body).toBe(200);
    expect(completePreview.json().campaigns[1]).toMatchObject({
      resolved_generic_copy_step_no: 1,
      generic_copy_step_required: false,
      copies_bound: 3,
      copies_unassigned: 0,
    });

    const commit = await h.inject({
      method: 'POST',
      url: `/api/v1/imports/${preview.json().import_id}/commit`,
      payload: completeMapping,
    });
    expect(commit.statusCode, commit.body).toBe(200);
    expect(commit.json()).toMatchObject({
      leads_created: 5,
      allocations_created: 5,
      sources_created: 5,
      copies_bound: 5,
      copies_unassigned: 0,
    });
    expect(
      (
        await h.pool.query(
          `SELECT campaign_id, step_no, count(*)::int AS n
             FROM campaign_personalized_copies
            WHERE campaign_id IN ($1, $2)
            GROUP BY campaign_id, step_no
            ORDER BY campaign_id`,
          [oneStepCampaign.id, multiStepCampaign.id],
        )
      ).rows,
    ).toEqual([
      { campaign_id: oneStepCampaign.id, step_no: 1, n: 2 },
      { campaign_id: multiStepCampaign.id, step_no: 1, n: 3 },
    ]);
  });

  it('imports 100 leads and 500 Ready copies into an active manual-enrollment campaign without events', async () => {
    const wm = await eventWatermark(h.pool);
    const sequence = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/sequences',
        payload: {
          name: 'Five-step bulk personalized import',
          stop_on_reply: true,
          steps: Array.from({ length: 5 }, (_, index) => ({
            step_no: index + 1,
            wait_days: index === 0 ? 0 : 1,
            in_thread: index !== 0 && index !== 2,
            content_source: 'personalized',
            variants: [],
          })),
        },
      })
    ).json();
    const campaign = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        payload: { name: 'Hundred-lead personalized import', sequence_id: sequence.id },
      })
    ).json();
    await h.pool.query(
      "UPDATE campaigns SET status = 'active', auto_enroll_enabled = false WHERE id = $1",
      [campaign.id],
    );
    const copyColumns = Array.from({ length: 5 }, (_, index) => [
      'step_' + (index + 1) + '_subject',
      'step_' + (index + 1) + '_body',
    ]).flat();
    const rows = Array.from({ length: 100 }, (_, leadIndex) =>
      [
        'bulk-ready-' + (leadIndex + 1) + '@example.dev',
        ...Array.from({ length: 5 }, (_, stepIndex) => [
          'Subject ' + (stepIndex + 1) + ' for lead ' + (leadIndex + 1),
          'Body ' + (stepIndex + 1) + ' for lead ' + (leadIndex + 1),
        ]).flat(),
      ].join(','),
    );
    const csv = Buffer.from([['email', ...copyColumns].join(','), ...rows].join('\n'));
    const multipart = multipartOf('hundred-leads-five-steps.csv', csv);
    const preview = await h.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { 'content-type': multipart.contentType },
      payload: multipart.payload,
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().draft_counts).toMatchObject({ valid_drafts: 500, invalid_drafts: 0 });

    const allocationPayload = {
      mode: 'drop_flagged',
      allocations: [{ campaign_id: campaign.id, count: 100 }],
    };
    const allocationPreview = await h.inject({
      method: 'POST',
      url: `/api/v1/imports/${preview.json().import_id}/allocation-preview`,
      payload: allocationPayload,
    });
    expect(allocationPreview.statusCode, allocationPreview.body).toBe(200);
    expect(allocationPreview.json().campaigns[0]).toMatchObject({
      requested: 100,
      allocatable: 100,
    });

    // A setting change after preview must fail closed and roll back the whole import.
    await h.pool.query('UPDATE campaigns SET auto_enroll_enabled = true WHERE id = $1', [
      campaign.id,
    ]);
    for (const endpoint of ['allocation-preview', 'commit']) {
      const rejected = await h.inject({
        method: 'POST',
        url: `/api/v1/imports/${preview.json().import_id}/${endpoint}`,
        payload: allocationPayload,
      });
      expect(rejected.statusCode, rejected.body).toBe(409);
    }
    expect(
      (await h.pool.query("SELECT count(*)::int AS n FROM leads WHERE email LIKE 'bulk-ready-%'"))
        .rows[0].n,
    ).toBe(0);
    await h.pool.query('UPDATE campaigns SET auto_enroll_enabled = false WHERE id = $1', [
      campaign.id,
    ]);

    const commit = await h.inject({
      method: 'POST',
      url: '/api/v1/imports/' + preview.json().import_id + '/commit',
      payload: {
        mode: 'drop_flagged',
        mark_valid_copy_ready: false,
        allocations: [{ campaign_id: campaign.id, count: 100 }],
      },
    });
    expect(commit.statusCode, commit.body).toBe(200);
    expect(commit.json()).toMatchObject({
      leads_created: 100,
      sources_created: 500,
      copies_bound: 500,
      invalid_drafts: 0,
    });
    const sourceCoverage = (
      await h.pool.query(
        'SELECT count(*)::int AS total, ' +
          "(count(*) FILTER (WHERE status = 'ready'))::int AS ready " +
          'FROM personalized_copy_sources WHERE source_import_id = $1',
        [preview.json().import_id],
      )
    ).rows[0];
    const campaignCoverage = (
      await h.pool.query(
        'SELECT count(*)::int AS total, ' +
          "(count(*) FILTER (WHERE status = 'ready'))::int AS ready " +
          'FROM campaign_personalized_copies WHERE campaign_id = $1',
        [campaign.id],
      )
    ).rows[0];
    expect(sourceCoverage).toEqual({ total: 500, ready: 500 });
    expect(campaignCoverage).toEqual({ total: 500, ready: 500 });
    expect(
      (
        await h.pool.query('SELECT count(*)::int AS n FROM enrollments WHERE campaign_id = $1', [
          campaign.id,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await h.pool.query('SELECT status, auto_enroll_enabled FROM campaigns WHERE id = $1', [
          campaign.id,
        ])
      ).rows[0],
    ).toEqual({ status: 'active', auto_enroll_enabled: false });
    await expectNoNewEvents(h.pool, wm);
  });

  it('binds multiple step-specific subject/body pairs without a generic step choice', async () => {
    const sequence = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/sequences',
        payload: {
          name: 'Import exact personalized steps',
          stop_on_reply: true,
          steps: [
            {
              step_no: 1,
              wait_days: 0,
              in_thread: false,
              content_source: 'personalized',
              variants: [],
            },
            {
              step_no: 3,
              wait_days: 1,
              in_thread: true,
              content_source: 'personalized',
              variants: [],
            },
          ],
        },
      })
    ).json();
    const campaign = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        payload: { name: 'Import exact target', sequence_id: sequence.id },
      })
    ).json();
    const csv = Buffer.from(
      'email,step_1_subject,step_1_body,step_3_subject,step_3_body\n' +
        'exact-copy@example.dev,First subject,First body,Third subject,Third body\n',
    );
    const multipart = multipartOf('exact-copy.csv', csv);
    const preview = await h.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { 'content-type': multipart.contentType },
      payload: multipart.payload,
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().draft_counts).toMatchObject({
      valid_drafts: 2,
    });
    const body = {
      mode: 'drop_flagged' as const,
      allocations: [{ campaign_id: campaign.id, count: 1 }],
    };
    const allocationPreview = await h.inject({
      method: 'POST',
      url: `/api/v1/imports/${preview.json().import_id}/allocation-preview`,
      payload: body,
    });
    expect(allocationPreview.statusCode, allocationPreview.body).toBe(200);
    expect(allocationPreview.json().campaigns[0]).toMatchObject({
      generic_copies: 0,
      generic_copy_step_required: false,
      copies_bound: 2,
      copies_unassigned: 0,
    });
    const commit = await h.inject({
      method: 'POST',
      url: `/api/v1/imports/${preview.json().import_id}/commit`,
      payload: body,
    });
    expect(commit.statusCode, commit.body).toBe(200);
    expect(commit.json()).toMatchObject({ sources_created: 2, copies_bound: 2 });
    expect(
      (
        await h.pool.query(
          `SELECT step_no, subject, body, status FROM campaign_personalized_copies
            WHERE campaign_id = $1 ORDER BY step_no`,
          [campaign.id],
        )
      ).rows,
    ).toEqual([
      { step_no: 1, subject: 'First subject', body: 'First body', status: 'ready' },
      { step_no: 3, subject: 'Third subject', body: 'Third body', status: 'ready' },
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
