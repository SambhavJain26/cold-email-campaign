// @golden L3 — THE FLAGSHIP (docs/13 §3): the Part-10 cohort driven through
// the REAL scheduler + poller + eventStore over MockTransport + VirtualClock
// for ~47 virtual days. Asserts the L1 terminals, the L2 metric numbers, AND
// the pipeline invariants: no send outside windows, no mailbox-day cap
// violation, threading integrity, pace-gap floor. Red here = the math
// stopped closing. NEVER skip.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MetricsEngine } from '../../src/services/metrics';
import { stateCounts } from '../../src/db/repos/enrollmentsRepo';
import { rebuildProjections } from '../../src/services/rebuildProjections';
import { resumeMailbox } from '../../src/services/autoPause';
import { localParts } from '../../src/scheduler/window';
import { scenario, leadEmail, type Scenario } from '../helpers/scenario';
import { GOLDEN } from '../fixtures/golden/constants';
import {
  GOLDEN_SEQUENCE,
  scriptGoldenCohort,
  runGoldenOperatorActions,
} from '../fixtures/golden/scenario';

const RUN_TIMEOUT = 900_000; // the full campaign replay is allowed 15 minutes

describe('@golden L3 — full pipeline over ~47 virtual days', () => {
  let s: Scenario;
  let m: MetricsEngine;
  const scope = { campaignId: GOLDEN.campaignId };

  beforeAll(async () => {
    s = await scenario({
      mailboxes: GOLDEN.mailboxes,
      dailyCap: 30,
      // Preserve the historical 30-enrollment/day cohort explicitly now that
      // production campaigns retain a permanent post-ramp cap.
      steadyDailyEnrollCap: 30,
      // The cohort sends 7 days/week (fixture model); hours stay 08–17 recipient-local.
      sendWindow: { days: [1, 2, 3, 4, 5, 6, 7], start: '08:00', end: '17:00' },
      sequence: GOLDEN_SEQUENCE,
      start: GOLDEN.base,
      seed: 20260105,
      tickMinutes: 9, // divides the 18-min pace gap exactly
      pollMinutes: 54,
      jitterPct: 0, // exact-slot pacing: 30 sends fill the 9h window precisely
    });
    // Leads have no state → default ET; ticking outside 12:00–23:00Z can't
    // produce work (window is 13:00–22:00Z) — skip those steps for speed.
    const realTick = s.hooks.tick!;
    s.hooks.tick = async (now) => {
      const h = now.getUTCHours();
      if (h >= 12 && h < 23) await realTick(now);
    };

    // Current enrollment controls have only A/B. The final 170 leads enter as
    // B, then their immutable enrollment snapshots are marked legacy C below
    // so this locked historical analytics fixture continues proving that old
    // C rows remain readable without permitting new C enrollment.
    await s.importLeads(GOLDEN.totalLeads, { tiers: { A: 260, B: 625 } });
    scriptGoldenCohort(s);

    // 30 days of enrollment at 30/day (the last day enrolls the final 15),
    // exactly the fixture's enrollDay(i) layout because selection is
    // tier-ordered A→B, oldest first.
    for (let day = 0; day < 30; day++) {
      await s.enroll({ count: GOLDEN.enrollPerDay });
      await s.advanceDays(1);
      // Operator model: an auto-pause trip is resumed next morning at 100%.
      const paused = await s.pool.query(`SELECT id FROM mailboxes WHERE status = 'auto_paused'`);
      for (const row of paused.rows as { id: number }[]) {
        await resumeMailbox({ db: s.db }, row.id, 100, s.clock.now());
      }
    }
    await s.pool.query(
      `UPDATE enrollments SET enrolled_tier = 'C'
        WHERE campaign_id = $1 AND lead_id BETWEEN 716 AND 885`,
      [GOLDEN.campaignId],
    );
    // Drain the tail: last cohort's steps 2–4 (+12 days) + confirm + completion.
    await s.advanceDays(17);

    await runGoldenOperatorActions(s);
    m = new MetricsEngine(s.db);
  }, RUN_TIMEOUT);

  afterAll(async () => {
    await s.close();
  });

  // ── L1: terminals ──────────────────────────────────────────────────────────

  it('reproduces the Part-10 terminal breakdown 40/18/47/780, summing to 885', async () => {
    expect(await stateCounts(s.db, GOLDEN.campaignId)).toEqual(GOLDEN.expected.terminals);
  });

  it('58 leads suppressed: 40 unsubscribed + 18 hard-bounced', async () => {
    const rows = await s.pool.query(
      `SELECT reason, count(*)::int n FROM suppressions GROUP BY reason`,
    );
    expect(
      Object.fromEntries(rows.rows.map((r: { reason: string; n: number }) => [r.reason, r.n])),
    ).toEqual({ unsubscribed: 40, hard_bounce: 18 });
  });

  // ── L2: every headline metric ──────────────────────────────────────────────

  it('reply rate 72/885 = 8.1%', async () => {
    expect(await m.replyRate(scope)).toEqual({ numerator: 72, denominator: 885, value: 8.1 });
  });

  it('positive reply rate 28/885 = 3.2%', async () => {
    expect(await m.positiveReplyRate(scope)).toEqual({
      numerator: 28,
      denominator: 885,
      value: 3.2,
    });
  });

  it('unsubscribe rate 40/885 = 4.5% (25 via reply + 15 via link)', async () => {
    expect(await m.unsubscribeRate(scope)).toEqual({ numerator: 40, denominator: 885, value: 4.5 });
    const bySource = await s.pool.query(
      `SELECT source, count(*)::int n FROM events WHERE type = 'unsubscribe' GROUP BY source`,
    );
    expect(
      Object.fromEntries(bySource.rows.map((r: { source: string; n: number }) => [r.source, r.n])),
    ).toEqual({ reply: 25, link: 15 });
  });

  it('hard-bounce rate 18/885 leads sent-to = 2.0%; soft 9/885 = 1.0%', async () => {
    expect(await m.hardBounceRate(scope)).toEqual({ numerator: 18, denominator: 885, value: 2.0 });
    expect(await m.softBounceRate(scope)).toEqual({ numerator: 9, denominator: 885, value: 1.0 });
  });

  it('meetings 17 = 1.9 per 100 contacted; progress 885/885 = 100%', async () => {
    expect(await m.meetings(scope)).toEqual({ count: 17, per100: 1.9 });
    expect(await m.progress(scope)).toEqual({ numerator: 885, denominator: 885, value: 100 });
  });

  it('step analytics (13b): delivered 867/831/801/789, repliers 30/25/10/7, positives 15/9/1/3', async () => {
    const steps = await m.stepAnalytics(scope);
    expect(steps.map((x) => x.delivered)).toEqual([...GOLDEN.expected.deliveredPerStep]);
    expect(steps.map((x) => x.repliers)).toEqual([30, 25, 10, 7]);
    expect(steps.map((x) => x.positiveRepliers)).toEqual([...GOLDEN.expected.positivesPerStep]);
  });

  it('tier analytics (13c): contacted/repliers/positives/meetings per tier', async () => {
    const tiers = await m.tierAnalytics(scope);
    const byTier = Object.fromEntries(tiers.map((t) => [t.tier, t]));
    for (const t of ['A', 'B', 'C'] as const) {
      const want = GOLDEN.expected.perTier[t];
      expect(byTier[t]!.contacted, `tier ${t} contacted`).toBe(want.enrolled);
      expect(byTier[t]!.replyRate.numerator, `tier ${t} repliers`).toBe(want.repliers);
      expect(byTier[t]!.positiveRate.numerator, `tier ${t} positives`).toBe(want.positives);
      expect(byTier[t]!.meetings, `tier ${t} meetings`).toBe(want.meetings);
    }
  });

  it('self-check: zero violations', async () => {
    expect(await m.selfCheck(GOLDEN.campaignId)).toEqual([]);
  });

  // ── Pipeline invariants (the part L1/L2 can't see) ─────────────────────────

  it('every send happened inside the 08:00–17:00 recipient-local window', () => {
    const sends = s.mock.sentLog.filter((e) => e.result.accepted);
    expect(sends.length).toBeGreaterThan(3000);
    for (const e of sends) {
      const p = localParts(e.at, 'America/New_York'); // all golden leads default-tz
      const minutes = p.hour * 60 + p.minute;
      expect(minutes, `send at ${e.at.toISOString()}`).toBeGreaterThanOrEqual(8 * 60);
      expect(minutes, `send at ${e.at.toISOString()}`).toBeLessThan(17 * 60);
    }
  });

  it('no mailbox ever exceeded its daily cap on any local day', () => {
    const perDay = new Map<string, number>();
    for (const e of s.mock.sentLog.filter((x) => x.result.accepted)) {
      const p = localParts(e.at, 'America/New_York');
      const key = `${e.msg.mailboxId}:${p.year}-${p.month}-${p.day}`;
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
    }
    for (const [key, n] of perDay) {
      expect(n, `mailbox-day ${key}`).toBeLessThanOrEqual(30);
    }
  });

  it('per-mailbox pace: no two sends closer than minGap × 0.8 (14.4 min)', () => {
    const byMailbox = new Map<number, number[]>();
    for (const e of s.mock.sentLog.filter((x) => x.result.accepted)) {
      (
        byMailbox.get(e.msg.mailboxId) ?? byMailbox.set(e.msg.mailboxId, []).get(e.msg.mailboxId)!
      ).push(e.at.getTime());
    }
    const floor = (540 / 30) * 60_000 * 0.8;
    for (const [mb, times] of byMailbox) {
      times.sort((a, b) => a - b);
      for (let i = 1; i < times.length; i++) {
        expect(times[i]! - times[i - 1]!, `mailbox ${mb} gap`).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it('threading integrity: every in-thread send anchors to an earlier send of the same lead', () => {
    const sendsByLead = new Map<string, { messageId: string; inReplyTo?: string }[]>();
    for (const e of s.mock.sentLog.filter((x) => x.result.accepted)) {
      const list = sendsByLead.get(e.msg.to) ?? [];
      list.push({ messageId: e.msg.headers.messageId, inReplyTo: e.msg.headers.inReplyTo });
      sendsByLead.set(e.msg.to, list);
    }
    for (const [lead, sends] of sendsByLead) {
      const seen = new Set<string>();
      for (const send of sends) {
        if (send.inReplyTo !== undefined) {
          expect(seen.has(send.inReplyTo), `${lead}: dangling In-Reply-To`).toBe(true);
        }
        seen.add(send.messageId);
      }
    }
  });

  it('every follow-up went out the enrollment’s assigned mailbox (never rerouted)', () => {
    const mailboxByLead = new Map<string, number>();
    for (const e of s.mock.sentLog.filter((x) => x.result.accepted)) {
      const prev = mailboxByLead.get(e.msg.to);
      if (prev === undefined) mailboxByLead.set(e.msg.to, e.msg.mailboxId);
      else expect(e.msg.mailboxId, `${e.msg.to} rerouted`).toBe(prev);
    }
    expect(mailboxByLead.size).toBe(885);
  });

  it('the classifier saw only expected inbound: 27 bounces, 72 human replies, 0 unrelated', async () => {
    const rows = await s.pool.query(
      `SELECT classification, count(*)::int n FROM incoming_messages GROUP BY classification`,
    );
    const byClass = Object.fromEntries(
      rows.rows.map((r: { classification: string; n: number }) => [r.classification, r.n]),
    );
    expect(byClass).toEqual({ bounce: 27, human_reply: 72 }); // 18 hard + 9 soft DSNs
  });

  it('mock log and event log agree on accepted sends', async () => {
    const dbSent = await s.pool.query(`SELECT count(*)::int n FROM events WHERE type = 'sent'`);
    expect(s.mock.sentLog.filter((e) => e.result.accepted)).toHaveLength(dbSent.rows[0].n);
    // an unscripted completer got all 4 steps; the step-1 replier got exactly 1
    expect(s.mock.sentTo(leadEmail('L0400'))).toHaveLength(4);
    expect(s.mock.sentTo(leadEmail('L0001'))).toHaveLength(1);
  });

  it('rebuild-projections dry-run: ZERO drift after the whole live run', async () => {
    const r = await rebuildProjections(s.db, {
      dryRun: true,
      shapeFor: () => GOLDEN.shape,
      deliveryConfirmMs: GOLDEN.deliveryConfirmMs,
      now: s.clock.now(),
    });
    expect(r.checked).toBe(885);
    expect(r.diffs).toEqual([]);
  }, 120_000);
});
