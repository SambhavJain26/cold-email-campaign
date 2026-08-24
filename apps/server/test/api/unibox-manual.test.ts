// B6.7 unibox + enrollment actions, B6.8 manual-sends. Traceability rows:
// sentiment → sentiment_tagged; meeting → meeting_booked; unsubscribe →
// unsubscribe(manual) + suppression side effect; snooze → NO event;
// manual-send → sent on an existing active manual enrollment.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getById } from '../../src/db/repos/enrollmentsRepo';
import { getLeadByEmail } from '../../src/db/repos/leadsRepo';
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

  it('reply disposition is append-only, idempotent, and clears the review queue', async () => {
    const wm = await eventWatermark(h.pool);
    const res = await h.inject({
      method: 'POST',
      url: '/api/v1/unibox/1/disposition',
      payload: { disposition: 'interested' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ disposition: 'interested', recontact_after: null });
    await expectAppended(h.pool, wm, { reply_dispositioned: 1 });

    const retryWatermark = await eventWatermark(h.pool);
    const retry = await h.inject({
      method: 'POST',
      url: '/api/v1/unibox/1/disposition',
      payload: { disposition: 'interested' },
    });
    expect(retry.statusCode).toBe(200);
    await expectNoNewEvents(h.pool, retryWatermark);

    const unhandled = (
      await h.inject({ method: 'GET', url: '/api/v1/unibox?unhandled=true' })
    ).json();
    expect(unhandled.total).toBe(0);

    const pastNotNow = await h.inject({
      method: 'POST',
      url: '/api/v1/unibox/1/disposition',
      payload: { disposition: 'not_now', recontact_after: '2020-01-01T00:00:00.000Z' },
    });
    expect(pastNotNow.statusCode).toBe(400);
  });

  it('meeting-booked appends its milestone event; state unchanged', async () => {
    const wm = await eventWatermark(h.pool);
    const res = await h.inject({ method: 'POST', url: '/api/v1/enrollments/1/meeting-booked' });
    expect(res.statusCode).toBe(200);
    await expectAppended(h.pool, wm, { meeting_booked: 1 });
    const e = await getById(h.services.db, 1);
    expect(e!.currentState).toBe('REPLIED'); // milestone flag, not a state
    expect(e!.meetingBooked).toBe(true);
    const item = (await h.inject({ method: 'GET', url: '/api/v1/unibox' })).json().items[0];
    expect(item.meeting_booked).toBe(true);
  });

  it('Not now creates a reminder; completing it neither sends nor authorizes contact', async () => {
    const wm = await eventWatermark(h.pool);
    const disposition = await h.inject({
      method: 'POST',
      url: '/api/v1/unibox/1/disposition',
      payload: { disposition: 'not_now', recontact_after: '2099-02-03' },
    });
    expect(disposition.statusCode, disposition.body).toBe(200);
    expect(disposition.json().recontact_after).toBe('2099-02-03');
    await expectAppended(h.pool, wm, { reply_dispositioned: 1 });

    const reminders = (
      await h.inject({ method: 'GET', url: '/api/v1/reminders?view=upcoming' })
    ).json();
    expect(reminders.open_count).toBe(1);
    expect(reminders.items[0]).toMatchObject({
      enrollment_id: 1,
      incoming_message_id: 1,
      due_date: '2099-02-03',
      source: 'not_now',
      status: 'open',
    });

    const completeWm = await eventWatermark(h.pool);
    expect(
      (
        await h.inject({
          method: 'PATCH',
          url: `/api/v1/reminders/${reminders.items[0].id}`,
          payload: { status: 'done' },
        })
      ).statusCode,
    ).toBe(200);
    await expectNoNewEvents(h.pool, completeWm);
    const refreshed = (await h.inject({ method: 'GET', url: '/api/v1/unibox/1' })).json();
    expect(refreshed.recontact_after).toBe('2099-02-03');
  });

  it('reply snooze is refused; reminders replace it without appending an event', async () => {
    const wm = await eventWatermark(h.pool);
    const until = '2026-02-01T09:00:00.000Z';
    const res = await h.inject({
      method: 'POST',
      url: '/api/v1/enrollments/1/snooze',
      payload: { until },
    });
    expect(res.statusCode).toBe(409);
    expect((await getById(h.services.db, 1))!.snoozedUntil).toBeNull();
    await expectNoNewEvents(h.pool, wm);
  });

  it('manual unsubscribe appends unsubscribe(manual); suppression side effect fires', async () => {
    const wm = await eventWatermark(h.pool);
    const res = await h.inject({ method: 'POST', url: '/api/v1/enrollments/1/unsubscribe' });
    expect(res.statusCode).toBe(200);
    await expectAppended(h.pool, wm, { unsubscribe: 1 });
    const e = await getById(h.services.db, 1);
    expect(e!.currentState).toBe('UNSUBSCRIBED');
    const lead = await getLeadByEmail(h.services.db, 'rita@reply.dev');
    expect(lead!.isSuppressed).toBe(true);
    expect(lead!.suppressionReason).toBe('unsubscribed');
  });

  it('manual-send uses an existing due enrollment, sends, and returns message_id + checks', async () => {
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
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enrollment_id).toBe(2);
    expect(body.message_id).toMatch(/^<ce-/);
    expect(body.checks.fatal).toEqual([]);
    await expectAppended(h.pool, wm, { sent: 1 });

    const e = await getById(h.services.db, body.enrollment_id);
    expect(e!.personalizationMode).toBe('human_written');
    expect(e!.currentStepNo).toBe(2); // sent advanced the step

    const prefill = (
      await h.inject({
        method: 'GET',
        url: `/api/v1/enrollments/${body.enrollment_id}/manual-compose-prefill`,
      })
    ).json();
    expect(prefill).toMatchObject({
      enrollment_id: 2,
      step_no: 2,
      step_count: 2,
      subject: 'Re: Saw your work at Fresh LLC',
      body: 'Step two for Manny — following up here.',
      thread: { assigned_mailbox_id: 1, in_thread: true },
    });

    const variants = (
      await h.inject({
        method: 'GET',
        url: `/api/v1/analytics/variants?campaign_id=${campaignId}&step_no=1`,
      })
    ).json().items;
    expect(variants).toContainEqual(
      expect.objectContaining({
        label: `Manual · enrollment ${body.enrollment_id}`,
        subject_template: 'Saw your work at Fresh LLC',
        deactivatable: false,
        sent: 1,
      }),
    );
  });

  it('manual-send maps refusals: fatal checks 422, suppressed 409, no mailbox 409', async () => {
    // URL in a step-1 send = fatal check (walkthrough rule) → 422
    const fatal = await h.inject({
      method: 'POST',
      url: '/api/v1/manual-sends',
      payload: {
        lead_id: 3,
        campaign_id: campaignId,
        enrollment_id: 3,
        subject: 'Quick look',
        body: 'Carla — see https://my-portfolio.dev for examples.',
      },
    });
    expect(fatal.statusCode).toBe(422);
    expect(fatal.json().error.code).toBe('validation');

    // suppressed lead (rita, unsubscribed above) — fresh campaign so the
    // enroll-if-needed path hits the suppression wall
    const suppressed = await h.inject({
      method: 'POST',
      url: '/api/v1/manual-sends',
      payload: {
        lead_id: 1,
        campaign_id: campaignId,
        subject: 'Should never send',
        body: 'Nope.',
      },
    });
    expect(suppressed.statusCode).toBe(409);

    // all mailboxes paused → mailbox_unhealthy (lead 3 is still at step 1
    // with no assigned mailbox — lead 2 advanced past the sequence's last step)
    await h.pool.query(`UPDATE mailboxes SET status = 'paused'`);
    const unhealthy = await h.inject({
      method: 'POST',
      url: '/api/v1/manual-sends',
      payload: {
        lead_id: 3,
        campaign_id: campaignId,
        enrollment_id: 3,
        subject: 'Another angle',
        body: 'Different content entirely, still solid.',
      },
    });
    expect(unhealthy.statusCode).toBe(409);
    expect(unhealthy.json().error.code).toBe('mailbox_unhealthy');
    await h.pool.query(`UPDATE mailboxes SET status = 'ok'`);
  });
});
