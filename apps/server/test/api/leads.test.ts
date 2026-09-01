// B6.3 — leads list/detail/patch, bulk-tier, suppression removal (decision U).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { suppressLead } from '../../src/db/repos/suppressionsRepo';
import { getLeadById } from '../../src/db/repos/leadsRepo';
import { createApiHarness, type ApiHarness } from './helpers/app';
import { eventWatermark, expectNoNewEvents } from './helpers/events';

describe('B6.3 leads', () => {
  let h: ApiHarness;

  beforeAll(async () => {
    h = await createApiHarness();
    // three leads: tiered A, untiered, untiered-with-enrollment
    await h.pool.query(`
      INSERT INTO leads (email, first_name, last_name, company, state, tier, custom_fields)
      VALUES
        ('amy@acme.dev',   'Amy',  'Ash',   'Acme Realty', 'TX', 'A', '{"custom_observation":"saw your Dallas listings"}'),
        ('bob@bravo.dev',  'Bob',  'Best',  'Bravo Homes', 'CO', NULL, '{}'),
        ('cara@cedar.dev', 'Cara', 'Cole',  'Cedar Group', 'TX', NULL, '{}')`);
    await h.pool.query(`INSERT INTO campaigns (name, status) VALUES ('Camp 1', 'active')`);
    await h.pool.query(`
      INSERT INTO enrollments (campaign_id, lead_id, current_state, current_step_no, personalization_mode, enrolled_at)
      VALUES (1, 3, 'ACTIVE', 2, 'template_auto', now())`);
    await h.pool.query(`
      INSERT INTO events (type, occurred_at, lead_id, enrollment_id, campaign_id, step_no, attributes)
      VALUES ('enrolled', now(), 3, 1, 1, NULL, '{}'),
             ('sent',     now(), 3, 1, 1, 1,    '{"content_hash":"sha-x"}')`);
  });
  afterAll(async () => {
    await h.close();
  });

  it('lists with filters, pagination envelope, and untiered_count meta', async () => {
    const all = (await h.inject({ method: 'GET', url: '/api/v1/leads' })).json();
    expect(all.total).toBe(3);
    expect(all.untiered_count).toBe(2);
    expect(all.items[0]).toMatchObject({ email: 'amy@acme.dev', tier: 'A' });
    expect(all.items[2].latest_enrollment).toEqual({
      campaign_id: 1,
      campaign_name: 'Camp 1',
      current_state: 'ACTIVE',
      current_step_no: 2,
      awaiting_completion: false,
    });

    const tierA = (await h.inject({ method: 'GET', url: '/api/v1/leads?tier=A' })).json();
    expect(tierA.total).toBe(1);
    const untiered = (await h.inject({ method: 'GET', url: '/api/v1/leads?tier=untiered' })).json();
    expect(untiered.total).toBe(2);
    // `state` is the ENROLLMENT state machine, not leads.state (the postal
    // column — 'TX'/'CO' above). This assertion previously used `state=TX`,
    // which quietly locked in the wrong semantics: the frontend sends
    // ENROLLMENT_STATES values, so every state filter in the UI returned zero
    // rows while the suite stayed green (docs/17 §0 finding 17).
    const replied = (await h.inject({ method: 'GET', url: '/api/v1/leads?state=REPLIED' })).json();
    expect(replied.total).toBe(0);
    const active = (await h.inject({ method: 'GET', url: '/api/v1/leads?state=ACTIVE' })).json();
    expect(active.total).toBe(1);
    expect(active.items[0].email).toBe('cara@cedar.dev');
    // A postal value must NOT match — proves we are not filtering leads.state.
    const tx = (await h.inject({ method: 'GET', url: '/api/v1/leads?state=TX' })).json();
    expect(tx.total).toBe(0);
    // Campaign + state must hold for the SAME enrollment.
    const activeInCamp = (
      await h.inject({ method: 'GET', url: '/api/v1/leads?state=ACTIVE&campaign_id=1' })
    ).json();
    expect(activeInCamp.total).toBe(1);
    const activeOtherCamp = (
      await h.inject({ method: 'GET', url: '/api/v1/leads?state=ACTIVE&campaign_id=99' })
    ).json();
    expect(activeOtherCamp.total).toBe(0);
    const q = (await h.inject({ method: 'GET', url: '/api/v1/leads?q=bravo' })).json();
    expect(q.total).toBe(1);
    const inCamp = (await h.inject({ method: 'GET', url: '/api/v1/leads?campaign_id=1' })).json();
    expect(inCamp.total).toBe(1);
    expect(inCamp.items[0].email).toBe('cara@cedar.dev');
  });

  it('detail returns notes + full event timeline', async () => {
    const res = await h.inject({ method: 'GET', url: '/api/v1/leads/3' });
    expect(res.statusCode).toBe(200);
    const lead = res.json();
    expect(lead.timeline.map((e: { type: string }) => e.type)).toEqual(['enrolled', 'sent']);
    expect(lead.timeline[1].attributes.content_hash).toBe('sha-x');
    expect((await h.inject({ method: 'GET', url: '/api/v1/leads/99' })).statusCode).toBe(404);
  });

  it('PATCH edits tier / notes / custom_fields (custom_observation home)', async () => {
    const wm = await eventWatermark(h.pool);
    const res = await h.inject({
      method: 'PATCH',
      url: '/api/v1/leads/2',
      payload: {
        tier: 'B',
        notes: 'warm intro via Slack',
        custom_fields: { custom_observation: 'your Boulder open house' },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tier).toBe('B');
    expect(res.json().custom_fields.custom_observation).toBe('your Boulder open house');
    const row = await getLeadById(h.services.db, 2);
    expect(row!.notes).toBe('warm intro via Slack');
    await expectNoNewEvents(h.pool, wm);
  });

  it('bulk-tier by ids and by filter; exactly-one-of enforced', async () => {
    const wm = await eventWatermark(h.pool);
    const byIds = await h.inject({
      method: 'POST',
      url: '/api/v1/leads/bulk-tier',
      payload: { lead_ids: [2], tier: null },
    });
    expect(byIds.json()).toEqual({ updated: 1 });

    const byFilter = await h.inject({
      method: 'POST',
      url: '/api/v1/leads/bulk-tier',
      payload: { filter: { state: 'ACTIVE', tier: 'untiered' }, tier: 'B' },
    });
    expect(byFilter.json()).toEqual({ updated: 1 }); // cara — the only untiered lead with an ACTIVE enrollment

    const both = await h.inject({
      method: 'POST',
      url: '/api/v1/leads/bulk-tier',
      payload: { lead_ids: [1], filter: { state: 'ACTIVE' }, tier: 'A' },
    });
    expect(both.statusCode).toBe(400);
    const neither = await h.inject({
      method: 'POST',
      url: '/api/v1/leads/bulk-tier',
      payload: { tier: 'A' },
    });
    expect(neither.statusCode).toBe(400);
    await expectNoNewEvents(h.pool, wm); // bulk-tier: none (traceability)
  });

  it('DELETE /suppressions/:email — typed confirm, audit alert, projection cleared', async () => {
    await suppressLead(h.services.db, 2, 'manual', h.clock.now());
    expect((await getLeadById(h.services.db, 2))!.isSuppressed).toBe(true);

    const wrong = await h.inject({
      method: 'DELETE',
      url: '/api/v1/suppressions/bob@bravo.dev',
      payload: { confirm: 'nope@bravo.dev' },
    });
    expect(wrong.statusCode).toBe(400);

    const wm = await eventWatermark(h.pool);
    const ok = await h.inject({
      method: 'DELETE',
      url: '/api/v1/suppressions/bob@bravo.dev',
      payload: { confirm: 'bob@bravo.dev' },
    });
    expect(ok.statusCode).toBe(200);
    const lead = await getLeadById(h.services.db, 2);
    expect(lead!.isSuppressed).toBe(false);
    expect(lead!.suppressionReason).toBeNull();
    await expectNoNewEvents(h.pool, wm); // removal is alert-audited, not event-logged

    const alerts = (await h.inject({ method: 'GET', url: '/api/v1/alerts?unacked=true' })).json();
    expect(
      alerts.items.some(
        (a: { kind: string; payload: { email?: string } }) =>
          a.kind === 'suppression_removed' && a.payload.email === 'bob@bravo.dev',
      ),
    ).toBe(true);

    // no longer suppressed → 404 on repeat
    const again = await h.inject({
      method: 'DELETE',
      url: '/api/v1/suppressions/bob@bravo.dev',
      payload: { confirm: 'bob@bravo.dev' },
    });
    expect(again.statusCode).toBe(404);
  });

  it('POST /leads/:id/erase irreversibly redacts PII and stops an active enrollment', async () => {
    await h.pool.query(`
      INSERT INTO leads (email, first_name, last_name, company, notes, custom_fields)
      VALUES ('dana@delta.dev', 'Dana', 'Doe', 'Delta Homes', 'private note', '{"source":"import"}')`);
    await h.pool.query(`
      INSERT INTO enrollments (campaign_id, lead_id, current_state, current_step_no, personalization_mode, enrolled_at)
      VALUES (1, 4, 'ACTIVE', 1, 'template_auto', now())`);
    await h.pool.query(`
      INSERT INTO events (type, occurred_at, lead_id, enrollment_id, campaign_id, attributes)
      VALUES ('enrolled', now(), 4, 2, 1, '{}')`);
    await h.pool.query(`
      INSERT INTO alerts (kind, severity, payload)
      VALUES ('operator_note', 'warning', '{"email":"dana@delta.dev","note":"private"}')`);
    const sourceId = (
      await h.pool.query(`
        INSERT INTO personalized_copy_sources
          (lead_id, slot_no, subject, body, status)
        VALUES (4, 1, 'Private source subject', 'Private source body', 'ready')
        RETURNING id`)
    ).rows[0].id as number;
    const copyId = (
      await h.pool.query(
        `INSERT INTO campaign_personalized_copies
          (lead_id, campaign_id, step_no, source_copy_id, subject, body, status, content_hash)
         VALUES (4, 1, 3, $1, 'Private campaign subject', 'Private campaign body',
                 'ready', 'private-copy-hash')
         RETURNING id`,
        [sourceId],
      )
    ).rows[0].id as number;
    await h.pool.query(`
      INSERT INTO mailboxes (display_name, from_address, smtp_host, imap_host)
      VALUES ('Erase snapshot', 'erase-snapshot@test.dev', 'smtp.test.dev', 'imap.test.dev')`);
    await h.pool.query(
      `INSERT INTO sent_messages
        (message_id, enrollment_id, lead_id, mailbox_id, step_no, content_hash,
         rendered_subject, rendered_body_text, rendered_body_html, content_source,
         personalized_copy_id, sent_at)
       VALUES ('<erasure-snapshot@test.dev>', 2, 4, 1, 3, 'private-copy-hash',
               'Private rendered subject', 'Private rendered text', '<p>Private rendered html</p>',
               'personalized', $1, now())`,
      [copyId],
    );
    await suppressLead(h.services.db, 4, 'manual', h.clock.now());

    const wrong = await h.inject({
      method: 'POST',
      url: '/api/v1/leads/4/erase',
      payload: { confirm: 'not-dana@delta.dev' },
    });
    expect(wrong.statusCode).toBe(400);

    const erased = await h.inject({
      method: 'POST',
      url: '/api/v1/leads/4/erase',
      payload: { confirm: 'dana@delta.dev' },
    });
    expect(erased.statusCode).toBe(200);
    expect((await h.inject({ method: 'GET', url: '/api/v1/leads/4' })).statusCode).toBe(404);
    expect((await h.inject({ method: 'GET', url: '/api/v1/leads?q=dana' })).json().total).toBe(0);

    const lead = await h.pool.query(`
      SELECT email, first_name, last_name, company, notes, custom_fields, is_suppressed, is_erased, erased_at
      FROM leads WHERE id = 4`);
    expect(lead.rows[0]).toMatchObject({
      email: 'erased-lead-4@invalid.local',
      first_name: null,
      last_name: null,
      company: null,
      notes: null,
      custom_fields: {},
      is_suppressed: false,
      is_erased: true,
    });
    expect(lead.rows[0].erased_at).not.toBeNull();
    const enrollment = await h.pool.query(`SELECT current_state FROM enrollments WHERE id = 2`);
    expect(enrollment.rows[0].current_state).toBe('UNSUBSCRIBED');
    const eraseEvent = await h.pool.query(`
      SELECT attributes FROM events WHERE enrollment_id = 2 AND type = 'unsubscribe'`);
    expect(eraseEvent.rows[0].attributes).toEqual({ data_erasure: true });
    expect((await h.pool.query(`SELECT 1 FROM suppressions WHERE lead_id = 4`)).rows).toHaveLength(
      0,
    );
    const alert = await h.pool.query(`SELECT payload FROM alerts WHERE kind = 'operator_note'`);
    expect(alert.rows[0].payload).toEqual({ lead_id: 4 });
    expect(
      (await h.pool.query(`SELECT subject, body FROM personalized_copy_sources WHERE lead_id = 4`))
        .rows[0],
    ).toEqual({ subject: '', body: '' });
    expect(
      (
        await h.pool.query(
          `SELECT subject, body FROM campaign_personalized_copies WHERE lead_id = 4`,
        )
      ).rows[0],
    ).toEqual({ subject: '', body: '' });
    expect(
      (
        await h.pool.query(
          `SELECT rendered_subject, rendered_body_text, rendered_body_html
             FROM sent_messages WHERE lead_id = 4`,
        )
      ).rows[0],
    ).toEqual({ rendered_subject: null, rendered_body_text: null, rendered_body_html: null });
  });
});
