// @golden L2 (docs/13 §3): the metrics engine reproduces every Part-10 and
// §13 number from the seeded cohort — formulas and denominators proven.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createDb, type Db } from '../../src/db/client';
import { MetricsEngine } from '../../src/services/metrics';
import { mailboxImbalance } from '../../src/services/metrics/watchRules';
import { GOLDEN } from '../fixtures/golden/constants';
import { loadGoldenEvents } from '../fixtures/golden/load';
import { seedGoldenCohort } from '../helpers/goldenSeed';
import { TEST_DATABASE_URL, resetCoreTables } from '../helpers/db';

describe('@golden L2 — metrics reproduce spec Part 10 exactly', () => {
  let db: Db;
  let pool: Pool;
  let m: MetricsEngine;
  const scope = { campaignId: GOLDEN.campaignId };

  beforeAll(async () => {
    ({ db, pool } = createDb(TEST_DATABASE_URL));
    await seedGoldenCohort(db, pool);
    m = new MetricsEngine(db);
  }, 180_000);

  afterAll(async () => {
    await resetCoreTables(pool);
    await pool.end();
  });

  it('reply rate = 72 / 885 accepted recipients = 8.1%', async () => {
    expect(await m.replyRate(scope)).toEqual({ numerator: 72, denominator: 885, value: 8.1 });
  });

  it('positive reply rate = 28 / 885 = 3.2%', async () => {
    expect(await m.positiveReplyRate(scope)).toEqual({
      numerator: 28,
      denominator: 885,
      value: 3.2,
    });
  });

  it('unsubscribe rate = 40 / 885 = 4.5%', async () => {
    expect(await m.unsubscribeRate(scope)).toEqual({ numerator: 40, denominator: 885, value: 4.5 });
  });

  it('hard-bounce rate = 18 / 885 leads sent-to = 2.0%', async () => {
    expect(await m.hardBounceRate(scope)).toEqual({ numerator: 18, denominator: 885, value: 2.0 });
  });

  it('soft-bounce rate = 9 / 885 = 1.0%', async () => {
    expect(await m.softBounceRate(scope)).toEqual({ numerator: 9, denominator: 885, value: 1.0 });
  });

  it('meetings = 17 = 1.9 per 100 contacted', async () => {
    expect(await m.meetings(scope)).toEqual({ count: 17, per100: 1.9 });
  });

  it('progress = 885 / 885 accepted recipients', async () => {
    expect(await m.progress(scope)).toEqual({ numerator: 885, denominator: 885, value: 100 });
  });

  it('reply rate exceeds engaged-terminal share (47/885) — the intended overlap', async () => {
    // The 25 negative "remove me" repliers count toward reply rate but ended
    // UNSUBSCRIBED — Part 10's explicit teaching point.
    const reply = await m.replyRate(scope);
    expect(reply.value).toBeGreaterThan((47 / 885) * 100);
  });

  it('step analytics (13b): delivered 867/831/801/789, positives 15/9/1/3 summing to 28', async () => {
    const steps = await m.stepAnalytics(scope);
    expect(steps.map((s) => s.delivered)).toEqual([...GOLDEN.expected.deliveredPerStep]);
    expect(steps.map((s) => s.positiveRepliers)).toEqual([...GOLDEN.expected.positivesPerStep]);
    expect(steps.map((s) => s.repliers)).toEqual([30, 25, 10, 7]);
    expect(steps.reduce((a, s) => a + s.positiveRepliers, 0)).toBe(28);
  });

  it('tier analytics (13c): contacted/repliers/positives/meetings per tier, meetings sum 17', async () => {
    const tiers = await m.tierAnalytics(scope);
    const byTier = Object.fromEntries(tiers.map((t) => [t.tier, t]));
    for (const t of ['A', 'B', 'C'] as const) {
      const want = GOLDEN.expected.perTier[t];
      expect(byTier[t]!.contacted, `tier ${t} contacted`).toBe(want.enrolled);
      expect(byTier[t]!.replyRate.numerator, `tier ${t} repliers`).toBe(want.repliers);
      expect(byTier[t]!.positiveRate.numerator, `tier ${t} positives`).toBe(want.positives);
      expect(byTier[t]!.meetings, `tier ${t} meetings`).toBe(want.meetings);
    }
    expect(tiers.reduce((a, t) => a + t.meetings, 0)).toBe(17);
    expect(tiers.reduce((a, t) => a + t.contacted, 0)).toBe(885);
    expect(byTier.A!.mode).toBe('human_written');
    expect(byTier.C!.mode).toBe('template_auto');
  });

  it('mid-campaign cutoff equals values computed independently from the fixture (cumulativity)', async () => {
    const asOf = new Date('2026-01-20T00:00:00Z');
    const events = loadGoldenEvents().filter((e) => e.occurredAt.getTime() <= asOf.getTime());
    const expected = {
      contacted: new Set(events.filter((e) => e.type === 'sent').map((e) => e.leadId)).size,
      repliers: new Set(events.filter((e) => e.type === 'human_reply').map((e) => e.leadId)).size,
      meetings: events.filter((e) => e.type === 'meeting_booked').length,
      hard: events.filter((e) => e.type === 'hard_bounce').length,
    };
    expect(expected.contacted).toBeGreaterThan(0);
    expect(expected.contacted).toBeLessThan(885); // genuinely mid-campaign

    const reply = await m.replyRate({ ...scope, asOf });
    expect(reply.numerator).toBe(expected.repliers);
    expect(reply.denominator).toBe(expected.contacted);
    expect((await m.meetings({ ...scope, asOf })).count).toBe(expected.meetings);
    expect((await m.hardBounceRate({ ...scope, asOf })).numerator).toBe(expected.hard);
  });

  it('daily series totals reconcile with the raw log', async () => {
    const events = loadGoldenEvents();
    const series = await m.dailySeries(
      scope,
      new Date(GOLDEN.base),
      new Date(GOLDEN.endOfCampaign),
    );
    const sum = (k: 'sent' | 'replies' | 'hard_bounces' | 'unsubscribes') =>
      series.reduce((a, r) => a + r[k === 'replies' ? 'replies' : k], 0);
    expect(sum('sent')).toBe(events.filter((e) => e.type === 'sent').length);
    expect(sum('replies')).toBe(72);
    expect(sum('hard_bounces')).toBe(18);
    expect(sum('unsubscribes')).toBe(40);
  });

  it('mailbox volume: 4 round-robin mailboxes, no imbalance flag, totals = sent events', async () => {
    const events = loadGoldenEvents();
    const volume = await m.mailboxVolume(new Date(GOLDEN.base), new Date(GOLDEN.endOfCampaign));
    const total = volume.reduce((a, r) => a + r.sends, 0);
    expect(total).toBe(events.filter((e) => e.type === 'sent').length);
    expect(new Set(volume.map((r) => r.mailbox_id)).size).toBe(4);
    expect(mailboxImbalance(volume).flag).toBeNull();
  });

  it('self-check: zero violations on the clean cohort', async () => {
    expect(await m.selfCheck(GOLDEN.campaignId)).toEqual([]);
  });
});
