// B6.5 — sequences: nested CRUD, replace-set saves (literal before sends,
// retire-don't-delete after — 2026-07-23 policy), preview via the ONE render
// engine, validate-template. Sequence saves append NO events.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiHarness, type ApiHarness } from './helpers/app';
import { eventWatermark, expectNoNewEvents } from './helpers/events';

const WRITE_BODY = {
  name: 'Real Estate Outreach',
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
          subject_template: 'Quick question about {{company}}',
          body_template:
            'Hi {{first_name|there}}, {{RANDOM|noticed|saw}} {{custom_observation}} — worth a chat about how you generate seller leads?',
          active: true,
        },
        {
          label: 'B',
          subject_template: '{{first_name|Hi}} — seller leads in {{market}}',
          body_template:
            'Hey {{first_name|there}}, {{custom_observation}}. We help teams like {{company|yours}} book more listing appointments.',
          active: true,
        },
      ],
    },
    {
      step_no: 2,
      wait_days: 3,
      in_thread: true,
      variants: [
        {
          label: 'A',
          subject_template: 'Following up',
          body_template:
            'Hi {{first_name|there}}, just floating this back up. Any interest in a quick call?',
          active: true,
        },
      ],
    },
  ],
};

describe('B6.5 sequences', () => {
  let h: ApiHarness;
  let seqId: number;

  beforeAll(async () => {
    h = await createApiHarness();
    await h.pool.query(`
      INSERT INTO leads (email, first_name, company, state, tier, custom_fields)
      VALUES ('amy@acme.dev', 'Amy', 'Acme Realty', 'TX', 'B',
              '{"custom_observation":"your Dallas listings move fast"}')`);
  });
  afterAll(async () => {
    await h.close();
  });

  it('creates a nested sequence and lists it back; no events appended', async () => {
    const wm = await eventWatermark(h.pool);
    const res = await h.inject({ method: 'POST', url: '/api/v1/sequences', payload: WRITE_BODY });
    expect(res.statusCode).toBe(200);
    const seq = res.json();
    seqId = seq.id;
    expect(seq.steps).toHaveLength(2);
    expect(seq.steps[0].variants.map((v: { label: string }) => v.label)).toEqual(['A', 'B']);

    const list = (await h.inject({ method: 'GET', url: '/api/v1/sequences' })).json();
    expect(list.items).toHaveLength(1);
    await expectNoNewEvents(h.pool, wm);
  });

  it('rejects saves with template parse errors → 422 sequence_invalid per variant', async () => {
    const bad = structuredClone(WRITE_BODY);
    bad.steps[0]!.variants[0]!.body_template = 'Hello {{first_name, unclosed tag';
    const res = await h.inject({ method: 'POST', url: '/api/v1/sequences', payload: bad });
    expect(res.statusCode).toBe(422);
    const err = res.json().error;
    expect(err.code).toBe('sequence_invalid');
    expect(err.details.errors[0]).toMatchObject({
      step_no: 1,
      label: 'A',
      field: 'body_template',
    });
  });

  it('replace-set is LITERAL while the sequence has zero sends', async () => {
    const current = (await h.inject({ method: 'GET', url: '/api/v1/sequences' })).json().items[0];
    const save = {
      name: 'Renamed Outreach',
      stop_on_reply: true,
      stop_on_hard_bounce: true,
      stop_on_unsubscribe: false,
      steps: [
        {
          // keep step 1, drop variant B, edit A
          id: current.steps[0].id,
          step_no: 1,
          wait_days: 0,
          in_thread: true,
          variants: [
            {
              id: current.steps[0].variants[0].id,
              label: 'A',
              subject_template: 'Question about {{company}}',
              body_template: current.steps[0].variants[0].body_template,
              active: true,
            },
          ],
        },
        // step 2 dropped entirely
      ],
    };
    const res = await h.inject({
      method: 'PATCH',
      url: `/api/v1/sequences/${seqId}`,
      payload: save,
    });
    expect(res.statusCode).toBe(200);
    const seq = res.json();
    expect(seq.name).toBe('Renamed Outreach');
    expect(seq.stop_on_unsubscribe).toBe(true); // mandatory runtime terminal behavior
    expect(seq.steps).toHaveLength(1);
    expect(seq.steps[0].variants).toHaveLength(1); // B is GONE, not retired
    expect(seq.steps[0].variants[0].subject_template).toBe('Question about {{company}}');
  });

  it('after sends exist: dropped variants retire (active=false), steps cannot be deleted', async () => {
    // restore a two-step, two-variant shape first
    const current = (await h.inject({ method: 'GET', url: '/api/v1/sequences' })).json().items[0];
    const restore = structuredClone(WRITE_BODY);
    restore.steps[0]!.variants[0] = {
      ...restore.steps[0]!.variants[0]!,
      // @ts-expect-error runtime shape carries ids
      id: current.steps[0].variants[0].id,
    };
    // @ts-expect-error runtime shape carries ids
    restore.steps[0].id = current.steps[0].id;
    const restored = (
      await h.inject({
        method: 'PATCH',
        url: `/api/v1/sequences/${seqId}`,
        payload: restore,
      })
    ).json();
    expect(restored.steps).toHaveLength(2);
    const variantB = restored.steps[0].variants.find((v: { label: string }) => v.label === 'B');

    // simulate send history through this sequence
    await h.pool.query(
      `INSERT INTO campaigns (name, status, sequence_id) VALUES ('Camp', 'active', $1)`,
      [seqId],
    );
    await h.pool.query(`
      INSERT INTO enrollments (campaign_id, lead_id, current_state, current_step_no, personalization_mode, enrolled_at)
      VALUES (1, 1, 'ACTIVE', 1, 'template_researched', now())`);
    await h.pool.query(`
      INSERT INTO sent_messages (message_id, enrollment_id, lead_id, mailbox_id, step_no, content_hash, sent_at)
      VALUES ('<ce-test-1@test.dev>', 1, 1, 1, 1, 'sha-whatever', now())`);

    // dropping variant B now RETIRES it — payload built from the server's own
    // nested response so every surviving row carries its id
    const asWrite = (seq: {
      name: string;
      stop_on_reply: boolean;
      stop_on_hard_bounce: boolean;
      stop_on_unsubscribe: boolean;
      steps: Array<{
        id: number;
        step_no: number;
        wait_days: number;
        in_thread: boolean;
        variants: Array<{
          id: number;
          label: string;
          subject_template: string;
          body_template: string;
          active: boolean;
        }>;
      }>;
    }) => ({
      name: seq.name,
      stop_on_reply: seq.stop_on_reply,
      stop_on_hard_bounce: seq.stop_on_hard_bounce,
      stop_on_unsubscribe: seq.stop_on_unsubscribe,
      steps: seq.steps.map((s) => ({
        id: s.id,
        step_no: s.step_no,
        wait_days: s.wait_days,
        in_thread: s.in_thread,
        variants: s.variants.map((v) => ({ ...v })),
      })),
    });

    const retire = asWrite(restored);
    retire.steps[0]!.variants = retire.steps[0]!.variants.filter((v) => v.label !== 'B');
    const retireRes = await h.inject({
      method: 'PATCH',
      url: `/api/v1/sequences/${seqId}`,
      payload: retire,
    });
    expect(retireRes.statusCode).toBe(200);
    const retired = retireRes.json();
    const bAfter = retired.steps[0].variants.find((v: { label: string }) => v.label === 'B');
    expect(bAfter).toBeDefined(); // row kept
    expect(bAfter.active).toBe(false); // retired
    expect(bAfter.id).toBe(variantB.id);

    // deleting a step is refused
    const dropStep = asWrite(retired);
    dropStep.steps = [dropStep.steps[0]!];
    const refused = await h.inject({
      method: 'PATCH',
      url: `/api/v1/sequences/${seqId}`,
      payload: dropStep,
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.code).toBe('sequence_invalid');
    expect(String(refused.json().error.details.conflicts)).toContain('cannot be deleted');
  });

  it('preview renders subject/body with footer + checks for a real lead', async () => {
    await h.pool.query(
      `UPDATE compliance_settings
          SET unsubscribe_base_url = 'https://unsubscribe.{sender_domain}'
        WHERE id = 1`,
    );
    const tokensBefore = await h.pool.query(
      `SELECT count(*)::int AS count FROM unsubscribe_tokens`,
    );
    try {
      const seq = (await h.inject({ method: 'GET', url: '/api/v1/sequences' })).json().items[0];
      const variantA = seq.steps[0].variants.find((v: { label: string }) => v.label === 'A');
      const res = await h.inject({
        method: 'POST',
        url: `/api/v1/sequences/${seqId}/preview`,
        payload: { lead_id: 1, step_no: 1, variant_id: variantA.id },
      });
      expect(res.statusCode).toBe(200);
      const p = res.json();
      expect(p.email_format).toBe('plain_text');
      expect(p.subject).toBe('Quick question about Acme Realty');
      expect(p.body).toContain('Hi Amy');
      expect(p.body).toContain('your Dallas listings move fast'); // researched-mode observation
      expect(p.body).toContain('100 Test Street, Austin TX 78701'); // footer, unconditional
      expect(p.body).not.toContain('Unsubscribe:');
      expect(p.body).toContain('Best,\nSambhav Jain\nAutomation Specialist | ');
      expect(p.checks.score).toBeGreaterThan(0);
      expect(p.checks.fatal).toEqual([]);
      expect(p.checks.variations).toBeGreaterThanOrEqual(1);
      expect(p.body).toContain('[sender domain — select a preview mailbox]');
      const mailbox = await h.pool.query(`
        INSERT INTO mailboxes (display_name, from_address, smtp_host, imap_host)
        VALUES ('Sambhav', 'sambhav@sambhavpmops.com', 'smtp.test', 'imap.test') RETURNING id`);
      const withMailbox = await h.inject({
        method: 'POST',
        url: `/api/v1/sequences/${seqId}/preview`,
        payload: {
          lead_id: 1,
          step_no: 1,
          variant_id: variantA.id,
          mailbox_id: Number(mailbox.rows[0].id),
        },
      });
      expect(withMailbox.statusCode).toBe(200);
      expect(withMailbox.json().body).toContain(
        'Automation Specialist | sambhavpmops.com\n100 Test Street',
      );
      expect(withMailbox.json().body).not.toContain('Unsubscribe:');
      expect(withMailbox.json().body).not.toContain('[sender domain');
      const missingMailbox = await h.inject({
        method: 'POST',
        url: `/api/v1/sequences/${seqId}/preview`,
        payload: { lead_id: 1, step_no: 1, variant_id: variantA.id, mailbox_id: 999999 },
      });
      expect(missingMailbox.statusCode).toBe(404);

      const missingVariant = await h.inject({
        method: 'POST',
        url: `/api/v1/sequences/${seqId}/preview`,
        payload: { lead_id: 1, step_no: 2, variant_id: variantA.id },
      });
      expect(missingVariant.statusCode).toBe(404); // variant belongs to step 1
      const tokensAfter = await h.pool.query(
        `SELECT count(*)::int AS count FROM unsubscribe_tokens`,
      );
      expect(tokensAfter.rows[0].count).toBe(tokensBefore.rows[0].count); // preview never mints capability tokens
    } finally {
      await h.pool.query(`UPDATE compliance_settings SET unsubscribe_base_url = '' WHERE id = 1`);
    }
  });

  it('previews exact campaign copy and derives Tier B Auto Observation in campaign context', async () => {
    const sequence = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/sequences',
        payload: {
          name: 'Personalized preview sequence',
          stop_on_reply: true,
          stop_on_hard_bounce: true,
          stop_on_unsubscribe: true,
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
                  subject_template: 'Follow-up',
                  body_template: '{{custom_observation}}',
                  active: true,
                },
              ],
            },
          ],
        },
      })
    ).json();
    const campaignId = (
      await h.pool.query(
        `INSERT INTO campaigns
           (name, status, sequence_id, auto_observation_field, auto_observation_rules)
         VALUES ('Preview campaign', 'draft', $1, 'state', '{"TX":"Tier B auto observation"}')
         RETURNING id`,
        [sequence.id],
      )
    ).rows[0].id as number;

    const saved = await h.inject({
      method: 'PUT',
      url: `/api/v1/leads/1/campaigns/${campaignId}/steps/1/personalized-copy`,
      payload: {
        subject: 'Exact personalized subject',
        body: 'Exact personalized body for Amy.',
        action: 'mark_ready',
        replace: true,
      },
    });
    expect(saved.statusCode).toBe(200);

    const personalized = await h.inject({
      method: 'POST',
      url: `/api/v1/sequences/${sequence.id}/preview`,
      payload: { lead_id: 1, step_no: 1, campaign_id: campaignId },
    });
    expect(personalized.statusCode).toBe(200);
    expect(personalized.json()).toMatchObject({
      subject: 'Exact personalized subject',
      personalized_copy_status: 'ready',
      resolution_trace: { render_mode: 'template_auto' },
    });
    expect(personalized.json().body).toContain('Exact personalized body for Amy.');
    expect(personalized.json().body).toContain('100 Test Street');

    const template = await h.inject({
      method: 'POST',
      url: `/api/v1/sequences/${sequence.id}/preview`,
      payload: {
        lead_id: 1,
        step_no: 2,
        variant_id: sequence.steps[1].variants[0].id,
        campaign_id: campaignId,
      },
    });
    expect(template.statusCode).toBe(200);
    expect(template.json().body).toContain('Tier B auto observation');
    expect(template.json().body).not.toContain('your Dallas listings move fast');
    expect(template.json().resolution_trace.render_mode).toBe('template_auto');
  });

  it('personalized previews follow the nearest new-conversation subject without mutating copy', async () => {
    const created = await h.inject({
      method: 'POST',
      url: '/api/v1/sequences',
      payload: {
        name: 'Two personalized conversations',
        stop_on_reply: true,
        stop_on_hard_bounce: true,
        stop_on_unsubscribe: true,
        steps: [false, true, false, true, true].map((inThread, index) => ({
          step_no: index + 1,
          wait_days: index === 0 ? 0 : 3,
          in_thread: inThread,
          content_source: 'personalized',
          variants: [],
        })),
      },
    });
    expect(created.statusCode).toBe(200);
    const sequence = created.json();
    const campaignId = (
      await h.pool.query(
        `INSERT INTO campaigns (name, status, sequence_id)
         VALUES ('Two-conversation preview', 'draft', $1) RETURNING id`,
        [sequence.id],
      )
    ).rows[0].id as number;
    const subjects = ['First idea', 'Saved second subject', 'Another idea', 'Fourth', 'Fifth'];
    for (const [index, subject] of subjects.entries()) {
      const saved = await h.inject({
        method: 'PUT',
        url: `/api/v1/leads/1/campaigns/${campaignId}/steps/${index + 1}/personalized-copy`,
        payload: { subject, body: `Amy,\n\nExact step ${index + 1} body.`, action: 'save_draft' },
      });
      expect(saved.statusCode).toBe(200);
    }
    const before = await h.pool.query(
      'SELECT * FROM campaign_personalized_copies WHERE campaign_id=$1 ORDER BY id',
      [campaignId],
    );
    const wm = await eventWatermark(h.pool);
    const expected = [
      'First idea',
      'Re: First idea',
      'Another idea',
      'Re: Another idea',
      'Re: Another idea',
    ];
    for (const [index, subject] of expected.entries()) {
      const preview = await h.inject({
        method: 'POST',
        url: `/api/v1/sequences/${sequence.id}/preview`,
        payload: { lead_id: 1, step_no: index + 1, campaign_id: campaignId },
      });
      expect(preview.statusCode).toBe(200);
      expect(preview.json()).toMatchObject({ subject, personalized_copy_status: 'needs_review' });
      expect(preview.json().body).toContain(`Amy,\n\nExact step ${index + 1} body.`);
    }
    expect(
      (
        await h.pool.query(
          'SELECT * FROM campaign_personalized_copies WHERE campaign_id=$1 ORDER BY id',
          [campaignId],
        )
      ).rows,
    ).toEqual(before.rows);
    await expectNoNewEvents(h.pool, wm);

    // An absent second opener must never borrow the first conversation's copy.
    await h.pool.query(
      'DELETE FROM campaign_personalized_copies WHERE campaign_id=$1 AND sequence_step_id=$2',
      [campaignId, sequence.steps[2].id],
    );
    const missingRoot = await h.inject({
      method: 'POST',
      url: `/api/v1/sequences/${sequence.id}/preview`,
      payload: { lead_id: 1, step_no: 4, campaign_id: campaignId },
    });
    expect(missingRoot.statusCode).toBe(200);
    expect(missingRoot.json().subject).toBe('Re: Fourth');
  });

  it('validate-template returns tokens, errors, and the variation count', async () => {
    const ok = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/sequences/validate-template',
        payload: { template: 'Hi {{first_name|there}}, {{RANDOM|a|b|c}} thing' },
      })
    ).json();
    expect(ok.errors).toEqual([]);
    expect(ok.variations).toBe(3);
    expect(ok.tokens.some((t: { kind: string }) => t.kind === 'random')).toBe(true);

    const bad = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/sequences/validate-template',
        payload: { template: 'Broken {{tag' },
      })
    ).json();
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(bad.errors[0].offset).toBeGreaterThanOrEqual(0);
  });

  it('deletes only unreferenced sequences with a typed name confirmation', async () => {
    const disposable = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/sequences',
        payload: { ...WRITE_BODY, name: 'Disposable sequence' },
      })
    ).json();
    const wrong = await h.inject({
      method: 'DELETE',
      url: `/api/v1/sequences/${disposable.id}`,
      payload: { confirm: 'wrong name' },
    });
    expect(wrong.statusCode).toBe(400);
    const deleted = await h.inject({
      method: 'DELETE',
      url: `/api/v1/sequences/${disposable.id}`,
      payload: { confirm: 'Disposable sequence' },
    });
    expect(deleted.statusCode).toBe(200);
    const refused = await h.inject({
      method: 'DELETE',
      url: `/api/v1/sequences/${seqId}`,
      payload: { confirm: 'Real Estate Outreach' },
    });
    expect(refused.statusCode).toBe(409);
  });
});
