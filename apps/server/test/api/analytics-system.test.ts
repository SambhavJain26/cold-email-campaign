// B6.9 analytics + B6.12 system routes over a small seeded dataset, plus the
// SIMULATED_CLOCK advance-clock drive (docs/13 §5).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VirtualClock } from '../../src/clock/virtual';
import { seedMailboxes } from '../helpers/db';
import { createApiHarness, type ApiHarness } from './helpers/app';

const SEQ_BODY = {
  name: 'Analytics Seq',
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
          subject_template: 'Hi {{company|there}}',
          body_template: 'Hey {{first_name|there}}, short note.',
          active: true,
        },
        {
          label: 'B',
          subject_template: 'Question for {{company|you}}',
          body_template: 'Hello {{first_name|there}}, quick question.',
          active: true,
        },
      ],
    },
  ],
};

describe('B6.9 analytics + B6.12 system', () => {
  let h: ApiHarness;
  let seqId: number;
  let campaignId: number;
  let variantIds: number[];

  beforeAll(async () => {
    h = await createApiHarness();
    await seedMailboxes(h.pool, 1, 30);
    const seq = (
      await h.inject({ method: 'POST', url: '/api/v1/sequences', payload: SEQ_BODY })
    ).json();
    seqId = seq.id;
    variantIds = seq.steps[0].variants.map((v: { id: number }) => v.id);
    const camp = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        payload: { name: 'Analytics Camp', sequence_id: seqId },
      })
    ).json();
    campaignId = camp.id;

    // two leads, both delivered on step 1 (variants A and B), one positive
    // reply. Timestamps are VIRTUAL-clock-relative (window queries use the
    // harness clock), and projections match the fold exactly (rebuild test).
    // Lead 2 is past the (1-step) sequence with its delivery-confirm window
    // elapsed, so the fold COMPLETES it — terminal_at = last sent + 6h
    // (delivery_confirm_hours default). Seeding it ACTIVE would (correctly)
    // show as rebuild drift now that completion is shape-derived (B7.3).
    await h.pool.query(`
      INSERT INTO leads (email, first_name, tier) VALUES
        ('a1@x.dev', 'A1', 'C'), ('a2@x.dev', 'A2', 'C')`);
    const now = h.clock.now();
    await h.pool.query(
      `INSERT INTO enrollments (campaign_id, lead_id, current_state, current_step_no,
                                personalization_mode, enrolled_tier, best_reply_sentiment,
                                meeting_booked, enrolled_at, terminal_at)
       VALUES ($1, 1, 'REPLIED',   2, 'template_auto', 'C', 'positive', true,
               $2::timestamptz - interval '5 days', $2::timestamptz - interval '2 days'),
              ($1, 2, 'COMPLETED', 2, 'template_auto', 'C', NULL, false,
               $2::timestamptz - interval '5 days',
               $2::timestamptz - interval '4 days' + interval '6 hours')`,
      [campaignId, now],
    );
    await h.pool.query(
      `INSERT INTO events (type, occurred_at, lead_id, enrollment_id, campaign_id, step_no, mailbox_id, message_id, attributes, sentiment)
       VALUES
        ('enrolled',    $2::timestamptz - interval '5 days', 1, 1, $1, NULL, NULL, NULL, '{"tier":"C"}', NULL),
        ('enrolled',    $2::timestamptz - interval '5 days', 2, 2, $1, NULL, NULL, NULL, '{"tier":"C"}', NULL),
        ('sent',        $2::timestamptz - interval '4 days', 1, 1, $1, 1, 1, '<a1@t>', $3, NULL),
        ('sent',        $2::timestamptz - interval '4 days', 2, 2, $1, 1, 1, '<a2@t>', $4, NULL),
        ('delivered',   $2::timestamptz - interval '3 days', 1, 1, $1, 1, NULL, NULL, '{}', NULL),
        ('delivered',   $2::timestamptz - interval '3 days', 2, 2, $1, 1, NULL, NULL, '{}', NULL),
        ('human_reply', $2::timestamptz - interval '2 days', 1, 1, $1, 1, NULL, NULL, '{}', 'positive'),
        ('meeting_booked', $2::timestamptz - interval '1 day', 1, 1, $1, NULL, NULL, NULL, '{}', NULL)`,
      [
        campaignId,
        now,
        JSON.stringify({ content_hash: 'h1', variant_id: variantIds[0] }),
        JSON.stringify({ content_hash: 'h2', variant_id: variantIds[1] }),
      ],
    );
  });
  afterAll(async () => {
    await h.close();
  });

  it('overview: metrics + live capacity + watch flags', async () => {
    const res = await h.inject({
      method: 'GET',
      url: `/api/v1/analytics/overview?campaign_id=${campaignId}`,
    });
    expect(res.statusCode).toBe(200);
    const o = res.json();
    expect(o.progress).toEqual({ contacted: 2, total: 2, pct: 100 });
    expect(o.reply_rate).toEqual({ numerator: 1, denominator: 2, value: 50 });
    expect(o.positive_rate.numerator).toBe(1);
    expect(o.meetings).toEqual({ count: 1, per_100: 50 });
    expect(o.capacity.total_daily_capacity).toBe(30);
    expect(Array.isArray(o.watch_flags)).toBe(true);

    expect(
      (await h.inject({ method: 'GET', url: '/api/v1/analytics/overview?campaign_id=99' }))
        .statusCode,
    ).toBe(404);
  });

  it('variants: per-variant stats joined to the step tree', async () => {
    const res = (
      await h.inject({
        method: 'GET',
        url: `/api/v1/analytics/variants?sequence_id=${seqId}&step_no=1`,
      })
    ).json();
    expect(res.items).toHaveLength(2);
    const a = res.items.find((v: { label: string }) => v.label === 'A');
    const b = res.items.find((v: { label: string }) => v.label === 'B');
    expect(a.sent).toBe(1);
    expect(a.reply_rate.numerator).toBe(1);
    expect(a.meetings).toBe(1);
    expect(b.sent).toBe(1);
    expect(b.reply_rate.numerator).toBe(0);
  });

  it('deactivate routes all to the surviving variant', async () => {
    const res = await h.inject({
      method: 'POST',
      url: `/api/v1/step-variants/${variantIds[0]}/deactivate`,
    });
    expect(res.json()).toEqual({ ok: true });
    const seq = (await h.inject({ method: 'GET', url: '/api/v1/sequences' })).json().items[0];
    const a = seq.steps[0].variants.find((v: { id: number }) => v.id === variantIds[0]);
    expect(a.active).toBe(false);
    expect(
      (await h.inject({ method: 'POST', url: '/api/v1/step-variants/999/deactivate' })).statusCode,
    ).toBe(404);
  });

  it('steps: aggregates by sequence and by campaign identically here', async () => {
    const bySeq = (
      await h.inject({ method: 'GET', url: `/api/v1/analytics/steps?sequence_id=${seqId}` })
    ).json();
    const byCamp = (
      await h.inject({ method: 'GET', url: `/api/v1/analytics/steps?campaign_id=${campaignId}` })
    ).json();
    expect(bySeq).toEqual(byCamp);
    expect(bySeq.items[0]).toMatchObject({ step_no: 1, delivered: 2, positive_replies: 1 });

    expect((await h.inject({ method: 'GET', url: '/api/v1/analytics/steps' })).statusCode).toBe(
      400,
    ); // neither param
  });

  it('tiers: table + the promotable tier_c_engaged count', async () => {
    const res = (
      await h.inject({ method: 'GET', url: `/api/v1/analytics/tiers?campaign_id=${campaignId}` })
    ).json();
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ tier: 'C', contacted: 2, mode: 'template_auto' });
    expect(res.promotable).toEqual({ tier_c_engaged: 1 }); // lead 1 replied
  });

  it('health-trend: series + totals + watch flags', async () => {
    const res = (
      await h.inject({
        method: 'GET',
        url: `/api/v1/analytics/health-trend?days=30&campaign_id=${campaignId}`,
      })
    ).json();
    expect(res.totals.sent).toBe(2);
    expect(res.totals.delivered).toBe(2);
    expect(res.totals.replies).toBe(1);
    expect(res.items.length).toBeGreaterThan(0);
    expect(Array.isArray(res.watch_flags)).toBe(true);
  });

  it('system status + rebuild dry-run + incoming debug + advance-clock 404', async () => {
    const status = (await h.inject({ method: 'GET', url: '/api/v1/system/status' })).json();
    expect(status.transport_mode).toBe('mock');
    expect(status.scheduler_last_tick_at).toBeNull(); // no tick ran in this suite
    expect(status.pollers).toHaveLength(1);
    expect(status.pending_jobs).toBe(0);

    const rebuild = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/system/rebuild-projections',
        payload: { dry_run: true },
      })
    ).json();
    expect(rebuild.diffs).toBe(0); // projections were hand-seeded consistent

    await h.pool.query(`
      INSERT INTO incoming_messages (mailbox_id, imap_uid, from_address, subject, processed_at,
                                     classification, resulting_event_ids, dsn_status)
      VALUES (1, 500, 'mailer-daemon@x', 'Undeliverable', now(), 'bounce', ARRAY[]::bigint[], '5.1.1')`);
    const inc = (
      await h.inject({ method: 'GET', url: '/api/v1/incoming-messages?classification=bounce' })
    ).json();
    expect(inc.total).toBe(1);
    expect(inc.items[0]).toMatchObject({ classification: 'bounce', dsn_status: '5.1.1' });

    // no SIMULATED_CLOCK → the route does not exist
    expect(
      (
        await h.inject({
          method: 'POST',
          url: '/api/v1/system/advance-clock',
          payload: { days: 1 },
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('B6.12 SIMULATED_CLOCK advance-clock', () => {
  let h: ApiHarness;

  beforeAll(async () => {
    h = await createApiHarness(
      { clock: new VirtualClock('2026-01-05T08:00:00Z'), jobPort: undefined },
      { SIMULATED_CLOCK: 'true' },
    );
    await seedMailboxes(h.pool, 1, 30);
    const seq = (
      await h.inject({ method: 'POST', url: '/api/v1/sequences', payload: SEQ_BODY })
    ).json();
    const camp = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        payload: { name: 'Sim Camp', sequence_id: seq.id },
      })
    ).json();
    await h.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${camp.id}`,
      payload: { status: 'active' },
    });
    await h.pool.query(`
      INSERT INTO leads (email, first_name, company, state, tier)
      VALUES ('sim1@x.dev', 'Sim', 'SimCo', 'TX', 'C'), ('sim2@x.dev', 'Sam', 'SamCo', 'CO', 'C')`);
    const enroll = await h.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${camp.id}/enroll`,
      payload: { count: 2 },
    });
    expect(enroll.json().enrolled).toBe(2);
  });
  afterAll(async () => {
    await h.close();
  });

  it('advancing virtual days drives the real scheduler: sends + deliveries happen', async () => {
    const res = await h.inject({
      method: 'POST',
      url: '/api/v1/system/advance-clock',
      payload: { days: 3 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.ticks).toBeGreaterThan(0);
    expect(new Date(body.now).getTime()).toBe(new Date('2026-01-08T08:00:00Z').getTime());

    const sent = await h.pool.query(`SELECT count(*)::int n FROM events WHERE type = 'sent'`);
    expect(sent.rows[0].n).toBe(2);
    const delivered = await h.pool.query(
      `SELECT count(*)::int n FROM events WHERE type = 'delivered'`,
    );
    expect(delivered.rows[0].n).toBe(2); // inline confirm-delivery jobs ran

    const status = (await h.inject({ method: 'GET', url: '/api/v1/system/status' })).json();
    expect(status.scheduler_last_tick_at).not.toBeNull();
  });

  it('advance-clock validates its body', async () => {
    const res = await h.inject({
      method: 'POST',
      url: '/api/v1/system/advance-clock',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
