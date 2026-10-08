// B6.7 unibox + enrollment actions, B6.8 manual-sends. Traceability rows:
// sentiment → sentiment_tagged; meeting → meeting_booked; unsubscribe →
// unsubscribe(manual) + suppression side effect; snooze → NO event;
// manual-send → sent on an existing active manual enrollment.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getById } from '../../src/db/repos/enrollmentsRepo';
import { seedMailboxes } from '../helpers/db';
import { createApiHarness, type ApiHarness } from './helpers/app';
import { eventWatermark, expectAppended, expectNoNewEvents } from './helpers/events';

describe('B6.7 unibox + B6.8 manual-sends', () => {
  let h: ApiHarness;
  let seqId: number;
  let campaignId: number;

  beforeAll(async () => {
    h = await createApiHarness();
    await seedMailboxes(h.pool, 1, 30);
    seqId = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/sequences',
        payload: {
          name: 'Unibox Seq',
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
                  subject_template: 'Hello {{company|there}}',
                  body_template: 'Hi {{first_name|there}}, note from us.',
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
                  subject_template: 'Wrong subject if threading breaks',
                  body_template: 'Step two for {{first_name|there}} — following up here.',
                  active: true,
                },
              ],
            },
          ],
        },
      })
    ).json().id;
    campaignId = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        payload: { name: 'Unibox Camp', sequence_id: seqId, acknowledge_tier_a_manual: true },
      })
    ).json().id;
    await h.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${campaignId}`,
      payload: { status: 'active' },
    });

    // Lead 1 with a replied enrollment — poller output simulated raw:
    await h.pool.query(`
      INSERT INTO leads (email, first_name, last_name, company, tier)
      VALUES ('rita@reply.dev', 'Rita', 'Reyes', 'Reply Co', 'A'),
             ('manny@fresh.dev', 'Manny', 'Fresh', 'Fresh LLC', 'A'),
             ('carla@new.dev', 'Carla', 'New', 'New Co', 'A')`);
    await h.pool.query(
      `INSERT INTO enrollments (campaign_id, lead_id, current_state, current_step_no,
                                personalization_mode, assigned_mailbox_id, enrolled_at)
       VALUES ($1, 1, 'REPLIED', 2, 'human_written', 1, now())`,
      [campaignId],
    );
    await h.pool.query(
      `INSERT INTO enrollments (campaign_id, lead_id, current_state, current_step_no,
                                personalization_mode, next_send_at, enrolled_at)
       VALUES ($1, 2, 'ACTIVE', 1, 'human_written', now(), now()),
              ($1, 3, 'ACTIVE', 1, 'human_written', now(), now())`,
      [campaignId],
    );
    await h.pool.query(
      `INSERT INTO events (type, occurred_at, lead_id, enrollment_id, campaign_id, attributes)
       VALUES ('enrolled', now(), 2, 2, $1, '{"tier":"A"}'),
              ('enrolled', now(), 3, 3, $1, '{"tier":"A"}')`,
      [campaignId],
    );
    await h.pool.query(
      `INSERT INTO events (type, occurred_at, lead_id, enrollment_id, campaign_id, attributes)
       VALUES ('enrolled', now() - interval '3 days', 1, 1, $1, '{"tier":"A"}')`,
      [campaignId],
    );
    await h.pool.query(
      `INSERT INTO events (type, occurred_at, lead_id, enrollment_id, campaign_id, step_no,
                           mailbox_id, message_id, attributes)
       VALUES ('sent', now() - interval '2 days', 1, 1, $1, 1, 1, '<ce-u1@test.dev>',
               '{"content_hash":"sha-u1","variant_id":1}')`,
      [campaignId],
    );
    await h.pool.query(`
      INSERT INTO sent_messages (message_id, enrollment_id, lead_id, mailbox_id, step_no, content_hash, sent_at)
      VALUES ('<ce-u1@test.dev>', 1, 1, 1, 1, 'sha-u1', now() - interval '2 days')`);
    // human reply referencing incoming_messages id 1 (identity starts at 1 post-truncate)
    const hr = await h.pool.query(
      `INSERT INTO events (type, occurred_at, lead_id, enrollment_id, campaign_id, step_no, attributes)
       VALUES ('human_reply', now() - interval '1 day', 1, 1, $1, 1, '{"incoming_message_id":1}')
       RETURNING id`,
      [campaignId],
    );
    await h.pool.query(
      `INSERT INTO incoming_messages (mailbox_id, imap_uid, message_id, from_address, subject,
                                      received_at, processed_at, classification,
                                      matched_enrollment_id, resulting_event_ids,
                                      suggested_sentiment, snippet, body_text)
       VALUES (1, 101, '<reply-1@reply.dev>', 'rita@reply.dev', 'Re: Hello Reply Co',
               now() - interval '1 day', now() - interval '1 day', 'human_reply',
               1, ARRAY[$1::bigint], 'positive', 'Sounds interesting, tell me more',
               'Sounds interesting, tell me more. What does onboarding look like? — Rita')`,
      [hr.rows[0].id],
    );
    // an OOO auto-reply on the same mailbox
    await h.pool.query(`
      INSERT INTO incoming_messages (mailbox_id, imap_uid, message_id, from_address, subject,
                                     received_at, processed_at, classification,
                                     matched_enrollment_id, resulting_event_ids, snippet)
      VALUES (1, 102, '<ooo-1@reply.dev>', 'rita@reply.dev', 'Out of office',
              now(), now(), 'auto_reply', 1, ARRAY[]::bigint[], 'I am away until Monday')`);
  });
  afterAll(async () => {
    await h.close();
  });

  it('lists the human bucket by default; auto_reply is the OOO tab', async () => {
    const human = (await h.inject({ method: 'GET', url: '/api/v1/unibox' })).json();
    expect(human.total).toBe(1);
    expect(human.items[0]).toMatchObject({
      incoming_message_id: 1,
      lead: { id: 1, name: 'Rita Reyes', company: 'Reply Co' },
      campaign_id: campaignId,
      step_no: 1,
      snippet: 'Sounds interesting, tell me more',
      effective_sentiment: null,
      suggested_sentiment: 'positive',
      auto_unsubscribed: false,
      meeting_booked: false,
      enrollment_id: 1,
    });

    const ooo = (await h.inject({ method: 'GET', url: '/api/v1/unibox?bucket=auto_reply' })).json();
    expect(ooo.total).toBe(1);
    expect(ooo.items[0].incoming_message_id).toBe(2);
  });

  it('detail returns full body text + the sent-message thread', async () => {
    const res = (await h.inject({ method: 'GET', url: '/api/v1/unibox/1' })).json();
    expect(res.body_text).toContain('What does onboarding look like?');
    expect(res.thread).toEqual([
      { message_id: '<ce-u1@test.dev>', step_no: 1, sent_at: expect.any(String) },
    ]);
    expect((await h.inject({ method: 'GET', url: '/api/v1/unibox/99' })).statusCode).toBe(404);
  });

  it('sentiment tagging appends sentiment_tagged and updates the effective view', async () => {
    const wm = await eventWatermark(h.pool);
    const unhandledBefore = (
      await h.inject({ method: 'GET', url: '/api/v1/unibox?unhandled=true' })
    ).json();
    expect(unhandledBefore.total).toBe(1);

    const res = await h.inject({
      method: 'POST',
      url: '/api/v1/unibox/1/sentiment',
      payload: { sentiment: 'positive' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().effective_sentiment).toBe('positive');
    await expectAppended(h.pool, wm, { sentiment_tagged: 1 });

    // A retry or second click on the selected value is idempotent.
    const sameValueWatermark = await eventWatermark(h.pool);
    const sameValue = await h.inject({
      method: 'POST',
      url: '/api/v1/unibox/1/sentiment',
      payload: { sentiment: 'positive' },
    });
    expect(sameValue.json().effective_sentiment).toBe('positive');
    await expectNoNewEvents(h.pool, sameValueWatermark);

    // re-tag: latest wins (decision M)
    const retag = await h.inject({
      method: 'POST',
      url: '/api/v1/unibox/1/sentiment',
      payload: { sentiment: 'neutral' },
    });
    expect(retag.json().effective_sentiment).toBe('neutral');

    // Sentiment and outcome are separate operator facts. A sentiment tag does
    // not clear the reply-review queue.
    const unhandledAfterSentiment = (
      await h.inject({ method: 'GET', url: '/api/v1/unibox?unhandled=true' })
    ).json();
    expect(unhandledAfterSentiment.total).toBe(1);
    const filtered = (
      await h.inject({ method: 'GET', url: '/api/v1/unibox?sentiment=neutral' })
    ).json();
    expect(filtered.total).toBe(1);

    // OOO rows can't be tagged
    expect(
      (
        await h.inject({
          method: 'POST',
          url: '/api/v1/unibox/2/sentiment',
          payload: { sentiment: 'neutral' },
        })
      ).statusCode,
    ).toBe(409);
  });

  it('retired dispositions cannot silently suppress or release legacy replies', async () => {
    const wm = await eventWatermark(h.pool);
    for (const disposition of [
      'interested',
      'not_now',
      'not_interested',
      'wrong_person',
      'explicit_unsubscribe',
    ]) {
      const response = await h.inject({
        method: 'POST',
        url: '/api/v1/unibox/1/disposition',
        payload: { disposition },
      });
      expect(response.statusCode).toBe(410);
    }
    await expectNoNewEvents(h.pool, wm);
    expect((await getById(h.services.db, 1))!.currentState).toBe('REPLIED');
  });

  it('manual reminders remain independent of outreach and completion does not send', async () => {
    const wm = await eventWatermark(h.pool);
    const created = await h.inject({
      method: 'POST',
      url: '/api/v1/unibox/1/reminders',
      payload: { due_date: '2099-02-03', note: 'Operator follow-up' },
    });
    expect(created.statusCode).toBe(200);
    const list = (
      await h.inject({ method: 'GET', url: '/api/v1/reminders?view=all&status=open' })
    ).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].note).toBe('Operator follow-up');
    expect(
      (
        await h.inject({
          method: 'PATCH',
          url: `/api/v1/reminders/${list.items[0].id}`,
          payload: { status: 'done' },
        })
      ).statusCode,
    ).toBe(200);
    await expectNoNewEvents(h.pool, wm);
    expect((await getById(h.services.db, 1))!.currentState).toBe('REPLIED');
  });

  it('reply snooze is refused; reminders replace it without appending an event', async () => {
    const wm = await eventWatermark(h.pool);
    const until = '2026-02-01T09:00:00.000Z';
    const res = await h.inject({
      method: 'POST',
      url: '/api/v1/enrollments/1/snooze',
      payload: { until },
    });
    expect(res.statusCode).toBe(410);
    expect((await getById(h.services.db, 1))!.snoozedUntil).toBeNull();
    await expectNoNewEvents(h.pool, wm);
  });

  it('legacy unsubscribe route requires the explicit permanent-suppression confirmation', async () => {
    const wm = await eventWatermark(h.pool);
    expect(
      (await h.inject({ method: 'POST', url: '/api/v1/enrollments/1/unsubscribe' })).statusCode,
    ).toBe(410);
    await expectNoNewEvents(h.pool, wm);
    expect((await getById(h.services.db, 1))!.currentState).toBe('REPLIED');
  });

  it('manual-send is permanently retired in favor of sequence-only personalized copy', async () => {
    const wm = await eventWatermark(h.pool);
    const res = await h.inject({
      method: 'POST',
      url: '/api/v1/manual-sends',
      payload: {
        lead_id: 2,
        campaign_id: campaignId,
        enrollment_id: 2,
        subject: 'Saw your work at Fresh LLC',
        body: 'Manny — impressive portfolio. Fifteen minutes this week to talk seller leads?',
      },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.message).toMatch(/sequence/i);
    await expectNoNewEvents(h.pool, wm);
  });

  it('legacy manual prefill and draft APIs return sequence-only guidance', async () => {
    const wm = await eventWatermark(h.pool);
    const prefill = await h.inject({
      method: 'GET',
      url: '/api/v1/enrollments/2/manual-compose-prefill',
    });
    expect(prefill.statusCode).toBe(410);
    expect(prefill.json().error.message).toMatch(/Personalized Copy/i);

    const readDraft = await h.inject({ method: 'GET', url: '/api/v1/manual-drafts/1' });
    expect(readDraft.statusCode).toBe(410);
    expect(readDraft.json().error.message).toMatch(/personalized-copy/i);

    const editDraft = await h.inject({
      method: 'PATCH',
      url: '/api/v1/manual-drafts/1',
      payload: { subject: 'must not be accepted' },
    });
    expect(editDraft.statusCode).toBe(410);
    await expectNoNewEvents(h.pool, wm);
  });
});
