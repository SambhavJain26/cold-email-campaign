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
      payload: { name: 'Spring Outreach', sequence_id: seqId },
    });
    expect(res.statusCode).toBe(200);
    const c = res.json();
    campaignId = c.id;
    expect(c).toMatchObject({
      name: 'Spring Outreach',
      status: 'draft',
      sequence_id: seqId,
      enrolled_count: 0,
      contacted_count: 0,
      recycled_from_campaign_id: null,
    });
    expect(c.ramp_config).toEqual({ ramp_days: 7, ramp_daily_enroll_cap: 20 });

    const list = (await h.inject({ method: 'GET', url: '/api/v1/campaigns' })).json();
    expect(list.total).toBe(1);

    // unknown sequence refused
    const bad = await h.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      payload: { name: 'X', sequence_id: 999 },
    });
    expect(bad.statusCode).toBe(404);
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
      ramp_cap_remaining: 20, // day 1 of the 7-day ramp
      suggested: 20,
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
    expect(cap.ramp_cap_remaining).toBe(15);
  });

  it('enroll beyond suggested → 409 capacity_exceeded with the suggested number', async () => {
    const res = await h.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/enroll`,
      payload: { count: 50 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('capacity_exceeded');
    expect(res.json().error.details.suggested).toBe(15);
  });

  it('enroll {lead_ids}: per-reason skipped buckets; force bypasses capacity', async () => {
    // suppress one candidate
    await h.pool.query(
      `UPDATE leads SET is_suppressed = true, suppression_reason = 'manual' WHERE email = 'lead12@pool.dev'`,
    );
    const ids = await h.pool.query(
      `SELECT id, email FROM leads WHERE email IN ('lead1@pool.dev','lead11@pool.dev','lead12@pool.dev') ORDER BY id`,
    );
    const byEmail = Object.fromEntries(
      ids.rows.map((r: { id: number; email: string }) => [r.email, r.id]),
    );
    const wm = await eventWatermark(h.pool);
    const res = await h.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/enroll`,
      payload: {
        lead_ids: [
          byEmail['lead1@pool.dev'], // already enrolled (tier A batch)
          byEmail['lead11@pool.dev'], // fine
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
        ['already_enrolled', 1],
      ]),
    );
    await expectAppended(h.pool, wm, { enrolled: 1 });
  });

  it('outcomes panel mirrors the fixture-locked grouping', async () => {
    // hand-place states on the 6 enrollments (projection is fair game in tests)
    await h.pool.query(`
      UPDATE enrollments SET current_state = 'REPLIED', best_reply_sentiment = 'positive'
      WHERE id IN (SELECT id FROM enrollments ORDER BY id LIMIT 2)`);
    await h.pool.query(`
      UPDATE enrollments SET current_state = 'REPLIED', best_reply_sentiment = 'neutral'
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
      REPLIED: { positive: 2, neutral: 1 },
      COMPLETED: 2,
      ACTIVE: 1, // enrolled events fold NEW → ACTIVE at append
      NEW: 0,
      total: 6,
    });
  });

  it('cold storage + recycle: rest gate, hash guard 409, draft-only 409, success path', async () => {
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
        payload: { name: 'Active Target', sequence_id: seqId },
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
        payload: { name: 'Pass 2 (conflict)', sequence_id: seqId },
      })
    ).json();
    const conflicted = await h.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${conflictTarget.id}/recycle`,
      payload: { source_campaign_id: campaignId },
    });
    expect(conflicted.statusCode).toBe(409);
    expect(conflicted.json().error.code).toBe('recycle_sequence_conflict');
    expect(conflicted.json().error.details.step_nos).toEqual([1]);

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
        payload: { name: 'Pass 2', sequence_id: freshSeqId },
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
  });
});
