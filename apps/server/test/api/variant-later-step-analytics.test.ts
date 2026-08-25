import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedMailboxes } from '../helpers/db';
import { createApiHarness, type ApiHarness } from './helpers/app';

describe('later-step direct and eventual variant analytics', () => {
  let h: ApiHarness;
  let campaignId: number;
  let step2VariantIds: number[];
  let step3VariantId: number;
  let bespokeVariantId: number;

  beforeAll(async () => {
    h = await createApiHarness();
    await seedMailboxes(h.pool, 1, 30);
    const sequence = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/sequences',
        payload: {
          name: 'Three-step attribution fixture',
          stop_on_reply: true,
          stop_on_hard_bounce: true,
          stop_on_unsubscribe: true,
          steps: [
            {
              step_no: 1,
              wait_days: 0,
              in_thread: false,
              variants: [
                {
                  label: 'A',
                  subject_template: 'One',
                  body_template: 'One body',
                  active: true,
                },
              ],
            },
            {
              step_no: 2,
              wait_days: 2,
              in_thread: true,
              variants: [
                {
                  label: 'A',
                  subject_template: 'Two A',
                  body_template: 'Two A body',
                  active: true,
                },
                {
                  label: 'B',
                  subject_template: 'Two B',
                  body_template: 'Two B body',
                  active: true,
                },
              ],
            },
            {
              step_no: 3,
              wait_days: 3,
              in_thread: true,
              variants: [
                {
                  label: 'A',
                  subject_template: 'Three',
                  body_template: 'Three body',
                  active: true,
                },
              ],
            },
          ],
        },
      })
    ).json();
    step2VariantIds = sequence.steps[1].variants.map((variant: { id: number }) => variant.id);
    step3VariantId = sequence.steps[2].variants[0].id;
    const campaign = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        payload: {
          name: 'Attribution campaign',
          sequence_id: sequence.id,
          acknowledge_tier_a_manual: true,
        },
      })
    ).json();
    campaignId = campaign.id;

    await h.pool.query(
      `INSERT INTO leads (email, tier) VALUES
       ('direct-a1@test.dev', 'B'), ('direct-a2@test.dev', 'B'),
       ('eventual-b1@test.dev', 'B'), ('quiet-b2@test.dev', 'B'),
       ('manual@test.dev', 'A'), ('erased@test.dev', 'B')`,
    );
    for (let leadId = 1; leadId <= 6; leadId += 1) {
      await h.pool.query(
        `INSERT INTO enrollments
           (lead_id, campaign_id, current_state, current_step_no, personalization_mode,
            enrolled_tier, enrolled_at)
         VALUES ($1, $2, 'ACTIVE', 2, 'template_researched', 'B', now() - interval '10 days')`,
        [leadId, campaignId],
      );
    }
    await h.pool.query(`UPDATE leads SET is_erased = true WHERE id = 6`);
    const step2Id = sequence.steps[1].id as number;
    bespokeVariantId = (
      await h.pool.query(
        `INSERT INTO step_variants
           (step_id, label, subject_template, body_template, active, content_hash, attributes)
         VALUES ($1, 'bespoke-e5s2-api', 'Manual subject', 'Manual body', false,
                 'manual-hash', '{"bespoke":true}') RETURNING id`,
        [step2Id],
      )
    ).rows[0].id as number;

    const now = h.clock.now();
    const sent = async (leadId: number, stepNo: number, variantId: number, hour: number) => {
      await h.pool.query(
        `INSERT INTO events
           (type, occurred_at, lead_id, enrollment_id, campaign_id, step_no, mailbox_id,
            message_id, attributes)
         VALUES ('sent', $1::timestamptz + ($5::text || ' hours')::interval, $2, $2, $3, $4, 1,
                 $6, jsonb_build_object('variant_id', $7::bigint, 'content_hash', $8::text))`,
        [
          now,
          leadId,
          campaignId,
          stepNo,
          hour,
          `<l${leadId}s${stepNo}@test.dev>`,
          variantId,
          `h-${variantId}`,
        ],
      );
    };
    await sent(1, 2, step2VariantIds[0]!, 1);
    await sent(2, 2, step2VariantIds[0]!, 1);
    await sent(3, 2, step2VariantIds[1]!, 1);
    await sent(4, 2, step2VariantIds[1]!, 1);
    await sent(5, 2, bespokeVariantId, 1);
    await sent(6, 2, step2VariantIds[0]!, 1); // erased: excluded from every metric
    await sent(3, 3, step3VariantId, 3);

    await h.pool.query(
      `INSERT INTO events
         (type, occurred_at, lead_id, enrollment_id, campaign_id, step_no)
       VALUES
         ('delivered', $2::timestamptz + interval '2 hours', 1, 1, $1, 2),
         ('delivered', $2::timestamptz + interval '2 hours', 3, 3, $1, 2),
         ('delivered', $2::timestamptz + interval '2 hours', 4, 4, $1, 2),
         ('delivered', $2::timestamptz + interval '2 hours', 5, 5, $1, 2),
         ('delivered', $2::timestamptz + interval '4 hours', 3, 3, $1, 3)`,
      [campaignId, now],
    );
    const directReply1 = (
      await h.pool.query(
        `INSERT INTO events
           (type, occurred_at, lead_id, enrollment_id, campaign_id, step_no, sentiment)
         VALUES ('human_reply', $2::timestamptz + interval '5 hours', 1, 1, $1, 2, 'neutral')
         RETURNING id`,
        [campaignId, now],
      )
    ).rows[0].id as number;
    await h.pool.query(
      `INSERT INTO events
         (type, occurred_at, lead_id, enrollment_id, campaign_id, step_no, sentiment)
       VALUES ('human_reply', $2::timestamptz + interval '90 minutes', 2, 2, $1, 2, 'positive')`,
      [campaignId, now],
    );
    const laterReply = (
      await h.pool.query(
        `INSERT INTO events
           (type, occurred_at, lead_id, enrollment_id, campaign_id, step_no, sentiment)
         VALUES ('human_reply', $2::timestamptz + interval '6 hours', 3, 3, $1, 3, 'neutral')
         RETURNING id`,
        [campaignId, now],
      )
    ).rows[0].id as number;
    await h.pool.query(
      `INSERT INTO events
         (type, occurred_at, lead_id, enrollment_id, campaign_id, step_no, sentiment, attributes)
       VALUES
         ('sentiment_tagged', $2::timestamptz + interval '7 hours', 1, 1, $1, 2, 'positive',
          jsonb_build_object('reply_event_id', $3::bigint)),
         ('sentiment_tagged', $2::timestamptz + interval '7 hours', 3, 3, $1, 3, 'positive',
          jsonb_build_object('reply_event_id', $4::bigint)),
         ('meeting_booked', $2::timestamptz + interval '8 hours', 1, 1, $1, NULL, NULL, '{}'),
         ('meeting_booked', $2::timestamptz + interval '8 hours', 3, 3, $1, NULL, NULL, '{}')`,
      [campaignId, now, directReply1, laterReply],
    );
  });

  afterAll(async () => {
    await h.close();
  });

  it('separates persisted direct thread matches from later eventual outcomes', async () => {
    const step2 = (
      await h.inject({
        method: 'GET',
        url: `/api/v1/analytics/variants?campaign_id=${campaignId}&step_no=2`,
      })
    ).json().items;
    const a = step2.find((row: { label: string }) => row.label === 'A');
    const b = step2.find((row: { label: string }) => row.label === 'B');
    const manual = step2.find((row: { bespoke: boolean }) => row.bespoke);
    expect(a.direct).toMatchObject({
      sent: 2,
      delivered: 1,
      contacted: 2,
      replies: 2,
      positive_replies: 2,
    });
    expect(a.direct.reply_rate).toEqual({ numerator: 2, denominator: 2, value: 100 });
    expect(a.eventual).toMatchObject({ cohort: 2, replies: 2, positive_replies: 2, meetings: 1 });
    expect(b.direct).toMatchObject({ sent: 2, delivered: 2, contacted: 2, replies: 0 });
    expect(b.eventual).toMatchObject({ cohort: 2, replies: 1, positive_replies: 1, meetings: 1 });
    expect(manual).toMatchObject({ active: false, bespoke: true, deactivatable: false });
    expect(manual.eventual.cohort).toBe(1);

    const step3 = (
      await h.inject({
        method: 'GET',
        url: `/api/v1/analytics/variants?campaign_id=${campaignId}&step_no=3`,
      })
    ).json().items[0];
    expect(step3.direct).toMatchObject({ sent: 1, replies: 1, positive_replies: 1 });
    expect(step3.eventual).toMatchObject({ cohort: 1, replies: 1, meetings: 1 });

    const step1 = await h.inject({
      method: 'GET',
      url: `/api/v1/analytics/variants?campaign_id=${campaignId}&step_no=1`,
    });
    expect(step1.statusCode).toBe(200);
    expect(step1.json().items[0].direct.sent).toBe(0);
  });

  it('keeps bespoke history read-only', async () => {
    const response = await h.inject({
      method: 'POST',
      url: `/api/v1/step-variants/${bespokeVariantId}/deactivate`,
    });
    expect(response.statusCode).toBe(409);
  });

  it('serializes concurrent attempts so one automated variant always survives', async () => {
    const responses = await Promise.all(
      step2VariantIds.map((variantId) =>
        h.inject({ method: 'POST', url: `/api/v1/step-variants/${variantId}/deactivate` }),
      ),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const remaining = (
      await h.pool.query(
        `SELECT count(*)::int n FROM step_variants
         WHERE id = ANY($1::bigint[]) AND active AND NOT (attributes @> '{"bespoke":true}')`,
        [step2VariantIds],
      )
    ).rows[0].n as number;
    expect(remaining).toBe(1);
  });
});
