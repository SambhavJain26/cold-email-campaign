import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiHarness, type ApiHarness } from './helpers/app';
import { seedMailboxes } from '../helpers/db';

describe('campaign CSV copy updates', () => {
  let h: ApiHarness;
  beforeAll(async () => {
    h = await createApiHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  async function upload(csv: string) {
    const boundary = 'copy-update-test';
    const response = await h.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="copies.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`,
      ),
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().import_id as number;
  }
  it('updates a mixed 100-lead cohort without changing progress; rejects stale previews and is idempotent', async () => {
    const sequence = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/sequences',
        payload: {
          name: 'CSV updates',
          stop_on_reply: true,
          steps: [1, 2].map((step_no) => ({
            step_no,
            wait_days: step_no === 1 ? 0 : 3,
            in_thread: step_no === 2,
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
        payload: { name: 'Copy update cohort', sequence_id: sequence.id },
      })
    ).json();
    const header = 'email,step_1_subject,step_1_body,step_2_subject,step_2_body';
    const rows = Array.from(
      { length: 100 },
      (_, i) => `person${i}@company${i}.com,Original,Original body,Followup,Followup body`,
    );
    const initial = await upload([header, ...rows].join('\n'));
    const imported = await h.inject({
      method: 'POST',
      url: `/api/v1/imports/${initial}/commit`,
      payload: { mode: 'import_all', allocations: [{ campaign_id: campaign.id, count: 100 }] },
    });
    expect(imported.statusCode, imported.body).toBe(200);
    await h.pool.query(
      "INSERT INTO enrollments (lead_id,campaign_id,current_state,personalization_mode,enrolled_at,current_step_no,soft_bounce_retries) SELECT id,$1,'ACTIVE','human_written',now(), CASE WHEN id=1 THEN 2 ELSE 1 END, CASE WHEN id=2 THEN 1 ELSE 0 END FROM leads WHERE id<=80",
      [campaign.id],
    );
    await h.pool.query("UPDATE campaigns SET status='paused' WHERE id=$1", [campaign.id]);
    const before = (await h.pool.query('SELECT * FROM enrollments ORDER BY id')).rows;
    await seedMailboxes(h.pool, 1);
    await h.pool.query(
      "INSERT INTO sent_messages (message_id,enrollment_id,lead_id,mailbox_id,step_no,content_hash,rendered_subject,rendered_body_text,rendered_body_html,email_format,sent_at) VALUES ('<protected@history.test>',1,1,1,1,'original','Original','Immutable original body','<p>Immutable original body</p>','minimal_html',now())",
    );
    const sentBefore = (await h.pool.query('SELECT * FROM sent_messages ORDER BY message_id')).rows;
    const csv = [
      header,
      ...rows.map((row) => row.replaceAll('Original', 'New').replaceAll('Followup', 'Updated')),
      'outside@other.com,New,New body,Updated,Updated body',
    ].join('\n');
    const id = await upload(csv);
    const request = { campaign_id: campaign.id };
    const url = `/api/v1/imports/${id}`;
    let preview = await h.inject({
      method: 'POST',
      url: `${url}/copy-update-preview`,
      payload: request,
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().counts).toMatchObject({
      changed: 198,
      sent_protected: 1,
      retry_protected: 1,
      unmatched: 1,
      invalid: 0,
    });
    const lastPage = await h.inject({
      method: 'POST',
      url: `${url}/copy-update-preview`,
      payload: { ...request, page: 3 },
    });
    expect(lastPage.statusCode, lastPage.body).toBe(200);
    expect(lastPage.json().fingerprint).toBe(preview.json().fingerprint);
    expect(lastPage.json().entries).toContainEqual(
      expect.objectContaining({ email: 'outside@other.com', status: 'unmatched' }),
    );
    await h.pool.query(
      "UPDATE campaign_personalized_copies SET body='Concurrent edit' WHERE lead_id=3 AND step_no=2",
    );
    const stale = await h.inject({
      method: 'POST',
      url: `${url}/copy-update-commit`,
      payload: { ...request, fingerprint: preview.json().fingerprint },
    });
    expect(stale.statusCode, stale.body).toBe(409);
    preview = await h.inject({
      method: 'POST',
      url: `${url}/copy-update-preview`,
      payload: request,
    });
    const result = await h.inject({
      method: 'POST',
      url: `${url}/copy-update-commit`,
      payload: { ...request, fingerprint: preview.json().fingerprint },
    });
    expect(result.statusCode, result.body).toBe(200);
    expect((await h.pool.query('SELECT * FROM enrollments ORDER BY id')).rows).toEqual(before);
    expect((await h.pool.query('SELECT count(*)::int AS n FROM leads')).rows[0].n).toBe(100);
    expect((await h.pool.query('SELECT count(*)::int AS n FROM events')).rows[0].n).toBe(0);
    expect((await h.pool.query('SELECT * FROM sent_messages ORDER BY message_id')).rows).toEqual(
      sentBefore,
    );
    const protectedCopies = (
      await h.pool.query(
        'SELECT subject FROM campaign_personalized_copies WHERE lead_id IN (1,2) AND step_no=1 ORDER BY lead_id',
      )
    ).rows;
    expect(protectedCopies).toEqual([{ subject: 'Original' }, { subject: 'Original' }]);
    const repeatId = await upload(csv);
    const repeat = await h.inject({
      method: 'POST',
      url: `/api/v1/imports/${repeatId}/copy-update-preview`,
      payload: request,
    });
    expect(repeat.json().counts).toMatchObject({
      changed: 0,
      unchanged: 198,
      sent_protected: 1,
      retry_protected: 1,
      unmatched: 1,
    });
    const invalidId = await upload(
      `${header}\nperson3@company3.com,One,Body,,\nperson3@company3.com,Two,Body,,`,
    );
    const invalid = await h.inject({
      method: 'POST',
      url: `/api/v1/imports/${invalidId}/copy-update-preview`,
      payload: request,
    });
    expect(invalid.statusCode, invalid.body).toBe(200);
    expect(invalid.json().counts.invalid).toBe(2);
    expect(
      (
        await h.inject({
          method: 'POST',
          url: `/api/v1/imports/${invalidId}/copy-update-commit`,
          payload: { ...request, fingerprint: invalid.json().fingerprint },
        })
      ).statusCode,
    ).toBe(422);
    const genericId = await upload(
      'email,manual_subject,manual_body\nperson3@company3.com,Generic subject,Generic body',
    );
    expect(
      (
        await h.inject({
          method: 'POST',
          url: `/api/v1/imports/${genericId}/copy-update-preview`,
          payload: request,
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await h.inject({
          method: 'POST',
          url: `/api/v1/imports/${genericId}/copy-update-preview`,
          payload: { ...request, generic_copy_step_no: 2 },
        })
      ).json().counts.changed,
    ).toBe(1);
    const partialId = await upload(`${header}\nperson3@company3.com,,Incomplete,,`);
    expect(
      (
        await h.inject({
          method: 'POST',
          url: `/api/v1/imports/${partialId}/copy-update-preview`,
          payload: request,
        })
      ).json().counts.invalid,
    ).toBe(1);
    const blankId = await upload(`${header}\nperson3@company3.com,,,,`);
    expect(
      (
        await h.inject({
          method: 'POST',
          url: `/api/v1/imports/${blankId}/copy-update-preview`,
          payload: request,
        })
      ).json().counts.changed,
    ).toBe(0);
    await h.pool.query("UPDATE campaigns SET status='active' WHERE id=$1", [campaign.id]);
    expect(
      (
        await h.inject({
          method: 'POST',
          url: `/api/v1/imports/${repeatId}/copy-update-preview`,
          payload: request,
        })
      ).statusCode,
    ).toBe(409);
  });
});
