// B6.6 — campaigns: CRUD, capacity meter, enroll (both body shapes + typed
// 409s), outcomes panel, recycle + cold storage. Traceability: enroll/recycle
// append `enrolled`×N.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedMailboxes } from '../helpers/db';
import { createApiHarness, type ApiHarness } from './helpers/app';
import { eventWatermark, expectAppended } from './helpers/events';

const SEQ = (name: string, subject: string) => ({
  name,
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
          subject_template: subject,
          body_template: `Hi {{first_name|there}}, quick note about {{company|your team}} from ${name}.`,
          active: true,
        },
      ],
    },
  ],
});

describe('B6.6 campaigns', () => {
  let h: ApiHarness;
  let seqId: number;
  let campaignId: number;

  beforeAll(async () => {
    h = await createApiHarness();
    await seedMailboxes(h.pool, 2, 30);
    seqId = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/sequences',
        payload: SEQ('Seq One', 'Hello {{company}}'),
      })
    ).json().id;
    // a pool of leads to enroll
    for (let i = 1; i <= 25; i++) {
      await h.pool.query(`INSERT INTO leads (email, first_name, tier) VALUES ($1, $2, $3)`, [
        `lead${i}@pool.dev`,
        `Lead${i}`,
        i <= 5 ? 'A' : i <= 10 ? 'B' : null,
      ]);
    }
  });
  afterAll(async () => {
    await h.close();
  });

  it('creates a campaign (draft, zero counts) and lists it', async () => {
    const res = await h.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      payload: { name: 'Spring Outreach', sequence_id: seqId, acknowledge_tier_a_manual: true },
    });
    expect(res.statusCode, res.body).toBe(200);
    const c = res.json();
    campaignId = c.id;
    expect(c).toMatchObject({
      name: 'Spring Outreach',
      status: 'draft',
      sequence_id: seqId,
      enrolled_count: 0,
      contacted_count: 0,
      recycle_sources: [],
      recycled_from_campaign_id: null,
    });
    expect(c.ramp_config).toEqual({ ramp_days: 7, ramp_daily_enroll_cap: 20 });
    expect(c.ramp_stages).toEqual([
      { start_day: 1, end_day: 1, cap: 5 },
      { start_day: 2, end_day: 2, cap: 8 },
      { start_day: 3, end_day: 3, cap: 10 },
      { start_day: 4, end_day: 4, cap: 12 },
      { start_day: 5, end_day: 7, cap: 15 },
    ]);

    const list = (await h.inject({ method: 'GET', url: '/api/v1/campaigns' })).json();
    expect(list.total).toBe(1);

    // unknown sequence refused
    const bad = await h.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      payload: { name: 'X', sequence_id: 999, acknowledge_tier_a_manual: true },
    });
    expect(bad.statusCode).toBe(404);
  });

  it('uses fixed researched/auto tiers without a manual acknowledgement', async () => {
    const res = await h.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      payload: { name: 'No acknowledgement', sequence_id: seqId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tier_effort_config).toEqual({
      A: 'template_researched',
      B: 'template_auto',
      C: 'template_auto',
    });
    await h.inject({
      method: 'DELETE',
      url: `/api/v1/campaigns/${res.json().id}`,
      payload: { confirm: 'No acknowledgement' },
    });
  });

  it('PATCH activates; capacity meter shows the docs/06 §7 numbers', async () => {
    const patched = await h.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${campaignId}`,
      payload: { status: 'active' },
    });
    expect(patched.json().status).toBe('active');

    const cap = (
      await h.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/capacity` })
    ).json();
    expect(cap).toEqual({
      total_daily_capacity: 60, // 2 × 30
      followups_due_today: 0,
      sent_so_far_today: 0,
      room_for_new: 60,
      pending_openers_today: 0,
      ramp_cap_remaining: 5,
      ramp_day: 1,
      ramp_stage: { start_day: 1, end_day: 1, cap: 5 },
      enrolled_today: 0,
      effective_daily_enroll_cap: 5,
      campaign_cap_remaining: 5,
      pool_available: null,
      suggested: 5,
    });
  });

  it('enroll {count}: tier order, enrolled×N events, ramp declines', async () => {
    const wm = await eventWatermark(h.pool);
    const res = await h.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/enroll`,
      payload: { count: 5 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enrolled: 5, skipped: [] });
    await expectAppended(h.pool, wm, { enrolled: 5 });

    // the 5 Tier-A leads went first
    const tiers = await h.pool.query(
      `SELECT enrolled_tier, count(*)::int n FROM enrollments WHERE campaign_id = $1 GROUP BY 1`,
      [campaignId],
    );
    expect(tiers.rows).toEqual([{ enrolled_tier: 'A', n: 5 }]);

    const cap = (
      await h.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/capacity` })
    ).json();
    expect(cap.ramp_cap_remaining).toBe(0);
  });

  it('enroll beyond suggested → 409 capacity_exceeded with the suggested number', async () => {
    const res = await h.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/enroll`,
      payload: { count: 50 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('capacity_exceeded');
    expect(res.json().error.details.suggested).toBe(0);
  });

  it('enroll {lead_ids}: per-reason skipped buckets without bypassing permanent caps', async () => {
    // suppress one candidate
    await h.pool.query(
      `UPDATE leads SET is_suppressed = true, suppression_reason = 'manual' WHERE email = 'lead12@pool.dev'`,
    );
    const ids = await h.pool.query(
      `SELECT id, email FROM leads WHERE email IN ('lead1@pool.dev','lead6@pool.dev','lead12@pool.dev') ORDER BY id`,
    );
    const byEmail = Object.fromEntries(
      ids.rows.map((r: { id: number; email: string }) => [r.email, r.id]),
    );
    const wm = await eventWatermark(h.pool);
    const explicitCampaign = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        payload: {
          name: 'Explicit selection',
          sequence_id: seqId,
          acknowledge_tier_a_manual: true,
        },
      })
    ).json();
    await h.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${explicitCampaign.id}`,
      payload: { status: 'active' },
    });
    const res = await h.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${explicitCampaign.id}/enroll`,
      payload: {
        lead_ids: [
          byEmail['lead1@pool.dev'], // active in another campaign
          byEmail['lead6@pool.dev'], // fine Tier B
          byEmail['lead12@pool.dev'], // suppressed
          999999, // not found
        ],
        force: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enrolled).toBe(1);
    expect(
      new Map(body.skipped.map((s: { reason: string; count: number }) => [s.reason, s.count])),
    ).toEqual(
      new Map([
        ['not_found', 1],
        ['suppressed', 1],
        ['active_enrollment_elsewhere', 1],
      ]),
    );
    await expectAppended(h.pool, wm, { enrolled: 1 });
  });

  it('freezes variables, Auto Observation rules, effort, and staged ramp on first activation', async () => {
    const variableSequence = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/sequences',
        payload: {
          ...SEQ('Variable sequence', '{{sequence.offer_name|the service}} for {{company}}'),
          variable_defaults: {
            offer_name: 'the audit',
            proof_point: '40% faster reviews',
          },
        },
      })
    ).json();
    const created = await h.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      payload: {
        name: 'Frozen personalization',
        sequence_id: variableSequence.id,
        tier_effort_config: {
          A: 'template_auto',
          B: 'template_auto',
          C: 'template_auto',
        },
        ramp_stages: [
          { start_day: 1, end_day: 1, cap: 5 },
          { start_day: 2, end_day: 7, cap: 8 },
        ],
        variable_overrides: { offer_name: 'the teardown' },
        auto_observation: {
          field: 'industry',
          rules: { SaaS: 'noticed your product-led motion', default: 'noticed the growth' },
        },
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().first_activated_at).toBeNull();

    const activated = await h.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${created.json().id}`,
      payload: { status: 'active' },
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json().resolved_variables).toEqual({
      offer_name: 'the teardown',
      proof_point: '40% faster reviews',
    });
    const firstActivatedAt = activated.json().first_activated_at;
    expect(firstActivatedAt).not.toBeNull();

    await h.pool.query(
      `UPDATE sequences SET variable_defaults = '{"offer_name":"changed later"}' WHERE id = $1`,
      [variableSequence.id],
    );
    const paused = await h.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${created.json().id}`,
      payload: { status: 'paused' },
    });
    const resumed = await h.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${created.json().id}`,
      payload: { status: 'active' },
    });
    expect(paused.json().first_activated_at).toBe(firstActivatedAt);
    expect(resumed.json().first_activated_at).toBe(firstActivatedAt);
    expect(resumed.json().resolved_variables.offer_name).toBe('the teardown');

    const frozen = await h.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${created.json().id}`,
      payload: { variable_overrides: { offer_name: 'should fail' } },
    });
    expect(frozen.statusCode).toBe(409);
    expect(frozen.json().error.message).toMatch(/frozen/);

    const dayOne = (
      await h.inject({
        method: 'GET',
        url: `/api/v1/campaigns/${created.json().id}/capacity`,
      })
    ).json();
    expect(dayOne).toMatchObject({
      ramp_day: 1,
      ramp_stage: { start_day: 1, end_day: 1, cap: 5 },
      ramp_cap_remaining: 5,
    });
    h.clock.advance({ days: 1 });
    const dayTwo = (
      await h.inject({
        method: 'GET',
        url: `/api/v1/campaigns/${created.json().id}/capacity`,
      })
    ).json();
    expect(dayTwo).toMatchObject({
      ramp_day: 2,
      ramp_stage: { start_day: 2, end_day: 7, cap: 8 },
      ramp_cap_remaining: 8,
    });
  });

  it('outcomes panel mirrors the fixture-locked grouping', async () => {
    // hand-place states on the 6 enrollments (projection is fair game in tests)
    await h.pool.query(`
      UPDATE enrollments SET current_state = 'REPLIED', best_reply_sentiment = 'positive'
      WHERE id IN (SELECT id FROM enrollments ORDER BY id LIMIT 1)`);
    await h.pool.query(`
      UPDATE enrollments SET current_state = 'REPLIED', best_reply_sentiment = 'neutral'
      WHERE id IN (SELECT id FROM enrollments ORDER BY id OFFSET 1 LIMIT 1)`);
    await h.pool.query(`
      UPDATE enrollments SET current_state = 'REPLIED', best_reply_sentiment = 'negative'
      WHERE id IN (SELECT id FROM enrollments ORDER BY id OFFSET 2 LIMIT 1)`);
    await h.pool.query(`
      UPDATE enrollments SET current_state = 'COMPLETED'
      WHERE id IN (SELECT id FROM enrollments ORDER BY id OFFSET 3 LIMIT 2)`);
    const res = (
      await h.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/outcomes` })
    ).json();
    expect(res).toEqual({
      UNSUBSCRIBED: 0,
      BOUNCED: 0,
      REPLIED: { positive: 1, neutral: 2 },
      COMPLETED: 2,
      ACTIVE: 0, // every enrollment was placed into a terminal state above
      NEW: 0,
      total: 5,
    });
  });

  it('cold storage + recycle: rest gate, conflict skip, draft-only 409, success path', async () => {
    // rest the two COMPLETED leads past the 60-day gate — anchored to the
    // VIRTUAL clock (the API compares against services.clock, not now())
    await h.pool.query(
      `UPDATE enrollments SET terminal_at = $1::timestamptz - interval '61 days'
       WHERE current_state = 'COMPLETED'`,
      [h.clock.now()],
    );

    const cold = (
      await h.inject({
        method: 'GET',
        url: `/api/v1/cold-storage?source_campaign_id=${campaignId}`,
      })
    ).json();
    expect(cold.items).toHaveLength(2);
    expect(cold.items.every((i: { eligible: boolean }) => i.eligible)).toBe(true);

    // recycle into an ACTIVE campaign → refused (draft only)
    const activeTarget = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        payload: { name: 'Active Target', sequence_id: seqId, acknowledge_tier_a_manual: true },
      })
    ).json();
    await h.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${activeTarget.id}`,
      payload: { status: 'active' },
    });
    const notDraft = await h.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${activeTarget.id}/recycle`,
      payload: { source_campaign_id: campaignId },
    });
    expect(notDraft.statusCode).toBe(409);
    expect(notDraft.json().error.code).toBe('conflict');

    // hash-guard: draft target reusing the SAME sequence — the completed leads
    // "received" its step-1 content
    const completed = await h.pool.query(
      `SELECT e.id, e.lead_id FROM enrollments e WHERE e.current_state = 'COMPLETED' LIMIT 1`,
    );
    const seqHash = await h.pool.query(
      `SELECT content_hash FROM step_variants sv
       JOIN sequence_steps ss ON ss.id = sv.step_id WHERE ss.sequence_id = $1 LIMIT 1`,
      [seqId],
    );
    await h.pool.query(
      `INSERT INTO sent_messages (message_id, enrollment_id, lead_id, mailbox_id, step_no, content_hash, sent_at)
       VALUES ('<ce-recycle-test@x>', $1, $2, 1, 1, $3, now())`,
      [completed.rows[0].id, completed.rows[0].lead_id, seqHash.rows[0].content_hash],
    );
    const conflictTarget = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        payload: { name: 'Pass 2 (conflict)', sequence_id: seqId, acknowledge_tier_a_manual: true },
      })
    ).json();
    const shortPreview = await h.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${conflictTarget.id}/recycle/preview`,
      payload: { source_campaign_ids: [campaignId] },
    });
    expect(shortPreview.statusCode).toBe(400);
    const preview = await h.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${conflictTarget.id}/recycle/preview`,
      payload: { source_campaign_ids: [campaignId, activeTarget.id] },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().breakdown).toMatchObject({
      unique_leads: 2,
      prior_content_conflicts: 1,
      eligible: 1,
    });
    expect(preview.json().sources).toHaveLength(2);
    const conflicted = await h.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${conflictTarget.id}/recycle`,
      payload: { source_campaign_id: campaignId },
    });
    expect(conflicted.statusCode).toBe(200);
    expect(conflicted.json().enrolled).toBe(1);
    expect(conflicted.json().breakdown.prior_content_conflicts).toBe(1);
    expect(conflicted.json().skipped).toContainEqual({
      reason: 'content_hash_conflict',
      count: 1,
    });

    // fresh templates → success; enrolled×N; recycled_from tagged
    const freshSeqId = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/sequences',
        payload: SEQ('Seq Two', 'New angle for {{company}}'),
      })
    ).json().id;
    const target = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        payload: { name: 'Pass 2', sequence_id: freshSeqId, acknowledge_tier_a_manual: true },
      })
    ).json();
    const wm = await eventWatermark(h.pool);
    const ok = await h.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${target.id}/recycle`,
      payload: { source_campaign_id: campaignId },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().enrolled).toBe(2);
    await expectAppended(h.pool, wm, { enrolled: 2 });
    const tagged = (await h.inject({ method: 'GET', url: '/api/v1/campaigns' })).json();
    const t = tagged.items.find((c: { id: number }) => c.id === target.id);
    expect(t.recycled_from_campaign_id).toBe(campaignId);
    expect(t.recycle_sources).toEqual([
      {
        campaign_id: campaignId,
        name: 'Spring Outreach',
        contributed_leads: 2,
      },
    ]);
  });

  it('deletes only unreferenced campaigns with a typed name confirmation', async () => {
    const disposable = (
      await h.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        payload: {
          name: 'Disposable campaign',
          sequence_id: seqId,
          acknowledge_tier_a_manual: true,
        },
      })
    ).json();
    const wrong = await h.inject({
      method: 'DELETE',
      url: `/api/v1/campaigns/${disposable.id}`,
      payload: { confirm: 'wrong name' },
    });
    expect(wrong.statusCode).toBe(400);
    const deleted = await h.inject({
      method: 'DELETE',
      url: `/api/v1/campaigns/${disposable.id}`,
      payload: { confirm: 'Disposable campaign' },
    });
    expect(deleted.statusCode).toBe(200);
    const refused = await h.inject({
      method: 'DELETE',
      url: `/api/v1/campaigns/${campaignId}`,
      payload: { confirm: 'Spring Outreach' },
    });
    expect(refused.statusCode).toBe(409);
  });
});
