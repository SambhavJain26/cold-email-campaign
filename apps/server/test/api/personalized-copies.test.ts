import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentHashOf } from '../../src/render/hash';
import { createSequence } from '../../src/db/repos/sequencesRepo';
import { createApiHarness, type ApiHarness } from './helpers/app';

describe('personalized copy API', () => {
  let h: ApiHarness;

  beforeAll(async () => {
    h = await createApiHarness();
    const sequenceId = await createSequence(h.services.db, {
      name: 'Personalized API sequence',
      steps: [
        { stepNo: 1, waitDays: 0, inThread: false, contentSource: 'personalized', variants: [] },
        {
          stepNo: 2,
          waitDays: 2,
          inThread: true,
          contentSource: 'template',
          variants: [
            {
              label: 'A',
              subjectTemplate: 'Template follow-up',
              bodyTemplate: 'Hi {{first_name|there}}, following up.',
              contentHash: contentHashOf('Template follow-up', 'following up'),
            },
          ],
        },
        { stepNo: 3, waitDays: 3, inThread: true, contentSource: 'personalized', variants: [] },
      ],
    });
    await h.pool.query(
      `INSERT INTO campaigns (name, status, sequence_id, lead_selection_mode)
       VALUES ('Personalized Campaign', 'draft', $1, 'pool')`,
      [sequenceId],
    );
    await h.pool.query(`
      INSERT INTO leads (email, first_name, tier)
      VALUES ('one@copy.dev', 'One', 'A'), ('two@copy.dev', 'Two', 'B')`);
    await h.pool.query(`
      INSERT INTO campaign_lead_pool (campaign_id, lead_id, allocation_order, status)
      VALUES (1, 1, 1, 'available'), (1, 2, 2, 'available')`);
  });

  afterAll(async () => {
    await h.close();
  });

  it('stores a global source, binds it to a step, and keeps campaign copy independent', async () => {
    const source = await h.inject({
      method: 'PUT',
      url: '/api/v1/leads/1/personalized-copy-sources/1',
      payload: {
        subject: 'Source subject',
        body: 'Source body written for One.',
        action: 'mark_ready',
        replace: true,
      },
    });
    expect(source.statusCode).toBe(200);
    expect(source.json()).toMatchObject({
      result: 'created',
      source: { slot_no: 1, status: 'ready', subject: 'Source subject' },
    });

    const bound = await h.inject({
      method: 'PUT',
      url: '/api/v1/leads/1/campaigns/1/steps/1/personalized-copy',
      payload: { action: 'copy_from_source', source_slot_no: 1, replace: true },
    });
    expect(bound.statusCode).toBe(200);
    expect(bound.json()).toMatchObject({
      result: 'created',
      copy: { step_no: 1, status: 'ready', subject: 'Source subject' },
    });
    expect(bound.json().copy.source_copy_id).toBe(source.json().source.id);

    const changedSource = await h.inject({
      method: 'PUT',
      url: '/api/v1/leads/1/personalized-copy-sources/1',
      payload: {
        subject: 'Changed source',
        body: 'Changed globally but not in the campaign snapshot.',
        action: 'save_draft',
        replace: true,
      },
    });
    expect(changedSource.json().source.status).toBe('needs_review');
    const listed = (
      await h.inject({ method: 'GET', url: '/api/v1/leads/1/personalized-copies' })
    ).json();
    expect(listed.sources[0].subject).toBe('Changed source');
    expect(listed.campaign_copies[0]).toMatchObject({
      subject: 'Source subject',
      status: 'ready',
    });
  });

  it('resets edited campaign copy to review, validates readiness, and rejects template steps', async () => {
    const draft = await h.inject({
      method: 'PUT',
      url: '/api/v1/leads/2/campaigns/1/steps/3/personalized-copy',
      payload: {
        subject: 'Later personal note',
        body: 'A lead-specific later message.',
        action: 'save_draft',
        replace: true,
      },
    });
    expect(draft.json().copy.status).toBe('needs_review');

    const invalid = await h.inject({
      method: 'PUT',
      url: '/api/v1/leads/2/campaigns/1/steps/3/personalized-copy',
      payload: { subject: '', body: '', action: 'mark_ready', replace: true },
    });
    expect(invalid.statusCode).toBe(422);

    const ready = await h.inject({
      method: 'PUT',
      url: '/api/v1/leads/2/campaigns/1/steps/3/personalized-copy',
      payload: {
        subject: 'Later personal note',
        body: 'A lead-specific later message.',
        action: 'mark_ready',
        replace: true,
      },
    });
    expect(ready.json().copy.status).toBe('ready');

    const template = await h.inject({
      method: 'PUT',
      url: '/api/v1/leads/2/campaigns/1/steps/2/personalized-copy',
      payload: { subject: 'No', body: 'No', action: 'save_draft', replace: true },
    });
    expect(template.statusCode).toBe(409);
  });

  it('reports step coverage over available pool members', async () => {
    const coverage = (
      await h.inject({ method: 'GET', url: '/api/v1/campaigns/1/personalized-copy-coverage' })
    ).json();
    expect(coverage).toEqual({
      blocked_count: 0,
      steps: [
        { step_no: 1, ready: 1, needs_review: 0, missing: 1, blocked: 0, total: 2 },
        { step_no: 3, ready: 1, needs_review: 0, missing: 1, blocked: 0, total: 2 },
      ],
    });
  });

  it('keeps sent campaign copy immutable', async () => {
    await h.pool.query(
      `UPDATE campaign_personalized_copies
          SET status = 'sent', sent_at = now(), sent_message_id = '<immutable@copy.dev>'
        WHERE lead_id = 1 AND campaign_id = 1 AND step_no = 1`,
    );
    const edit = await h.inject({
      method: 'PUT',
      url: '/api/v1/leads/1/campaigns/1/steps/1/personalized-copy',
      payload: {
        subject: 'Must not change',
        body: 'Must not change',
        action: 'save_draft',
        replace: true,
      },
    });
    expect(edit.statusCode).toBe(409);
    const stored = await h.pool.query(
      `SELECT subject, body FROM campaign_personalized_copies
        WHERE lead_id = 1 AND campaign_id = 1 AND step_no = 1`,
    );
    expect(stored.rows[0]).toEqual({
      subject: 'Source subject',
      body: 'Source body written for One.',
    });
  });
});
