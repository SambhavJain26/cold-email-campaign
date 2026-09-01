// B2.18: export golden-cohort API fixtures for the web MSW mocks (docs/11 §4).
// Seeds the cohort into the TEST database through the real eventStore, runs
// the real metrics engine, and writes JSON shaped per docs/10-api-contract.md
// into apps/web/src/mocks/fixtures/golden/. Run: npm run golden:export (server).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../../../src/db/client';
import { MetricsEngine } from '../../../src/services/metrics';
import {
  mailboxImbalance,
  replyRateDrop,
  unsubClimbing,
} from '../../../src/services/metrics/watchRules';
import { capacityToday } from '../../../src/services/enrollment';
import { GOLDEN } from './constants';
import { seedGoldenCohort } from '../../helpers/goldenSeed';
import { TEST_DATABASE_URL } from '../../helpers/db';

const OUT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../web/src/mocks/fixtures/golden',
);

async function main(): Promise<void> {
  const { db, pool } = createDb(TEST_DATABASE_URL);
  try {
    console.log('seeding golden cohort into test DB…');
    await seedGoldenCohort(db, pool);
    const m = new MetricsEngine(db);
    const scope = { campaignId: GOLDEN.campaignId };
    const from = new Date(GOLDEN.base);
    const to = new Date(GOLDEN.endOfCampaign);

    // GET /campaigns/:id/outcomes
    const states = (
      await pool.query(
        `SELECT current_state, best_reply_sentiment, count(*)::int n
         FROM enrollments WHERE campaign_id = $1 GROUP BY 1, 2`,
        [GOLDEN.campaignId],
      )
    ).rows as { current_state: string; best_reply_sentiment: string | null; n: number }[];
    const count = (state: string, sentiment?: string) =>
      states
        .filter(
          (r) =>
            r.current_state === state &&
            (sentiment === undefined || r.best_reply_sentiment === sentiment),
        )
        .reduce((a, r) => a + r.n, 0);
    const replied = count('REPLIED');
    const repliedPositive = count('REPLIED', 'positive');
    const outcomes = {
      UNSUBSCRIBED: count('UNSUBSCRIBED'),
      BOUNCED: count('BOUNCED'),
      REPLIED: { positive: repliedPositive, neutral: replied - repliedPositive },
      COMPLETED: count('COMPLETED'),
      ACTIVE: count('ACTIVE'),
      NEW: count('NEW'),
      total: states.reduce((a, r) => a + r.n, 0),
    };

    // GET /analytics/overview — capacity via the REAL calculator (B6), fixed
    // "now" = endOfCampaign so the API reproduces this over the seeded DB.
    // NOTE the seeded campaign's created_at is wall time (seed time), which is
    // always AFTER endOfCampaign — the ramp window therefore always reads
    // "in ramp" here; deterministic as long as that stays true.
    const clock = { now: () => new Date(GOLDEN.endOfCampaign) };
    const [progress, reply, positive, meetings, hard, soft, unsub, cap] = await Promise.all([
      m.progress(scope),
      m.replyRate(scope),
      m.positiveReplyRate(scope),
      m.meetings(scope),
      m.hardBounceRate(scope),
      m.softBounceRate(scope),
      m.unsubscribeRate(scope),
      capacityToday({ db, clock }, GOLDEN.campaignId),
    ]);
    // watch flags exactly as GET /analytics/overview computes them: a 30-day
    // window ending "now"
    const watchFrom = new Date(new Date(GOLDEN.endOfCampaign).getTime() - 30 * 86_400_000);
    const watchTo = new Date(GOLDEN.endOfCampaign);
    const watchSeries = await m.dailySeries(scope, watchFrom, watchTo);
    const watchVolume = await m.mailboxVolume(watchFrom, watchTo);
    const watchFlags = [
      replyRateDrop(watchSeries),
      unsubClimbing(watchSeries),
      mailboxImbalance(watchVolume).flag,
    ]
      .filter((f) => f !== null)
      .map((f) => f.rule);
    const deliveryConfirmed = await m.deliveryConfirmed(scope);
    const pendingDeliveryConfirmation = await m.pendingDeliveryConfirmation(scope);
    const overview = {
      progress: {
        contacted: progress.numerator,
        total: progress.denominator,
        pct: progress.value,
      },
      delivery_confirmation: {
        confirmed: deliveryConfirmed,
        pending: pendingDeliveryConfirmation,
      },
      reply_rate: reply,
      positive_rate: positive,
      meetings: { count: meetings.count, per_100: meetings.per100 },
      hard_bounce_rate: hard,
      soft_bounce_rate: soft,
      unsubscribe_rate: unsub,
      capacity: {
        total_daily_capacity: cap.total,
        followups_due_today: cap.followupsDue,
        sent_so_far_today: cap.sentSoFar,
        room_for_new: cap.roomForNew,
        ramp_cap_remaining: cap.rampCap,
        suggested: cap.suggested,
      },
      watch_flags: watchFlags,
    };

    // GET /analytics/steps + /analytics/tiers
    const steps = (await m.stepAnalytics(scope)).map((s) => ({
      step_no: s.stepNo,
      sent: s.sent,
      delivered: s.delivered,
      pending_delivery_confirmation: s.pendingDeliveryConfirmation,
      replies: s.repliers,
      reply_rate: s.stepReplyRate,
      positive_replies: s.positiveRepliers,
      positive_rate: s.positiveRate,
    }));
    const tiers = (await m.tierAnalytics(scope)).map((t) => ({
      tier: t.tier,
      contacted: t.contacted,
      delivered: t.delivered,
      pending_delivery_confirmation: t.pendingDeliveryConfirmation,
      reply_rate: t.replyRate,
      positive_rate: t.positiveRate,
      meetings: t.meetings,
      mode: t.mode,
    }));

    // GET /analytics/health-trend + /mailboxes/volume
    const series = await m.dailySeries(scope, from, to);
    const volumeRows = await m.mailboxVolume(from, to);
    const { flag, sevenDayAvg } = mailboxImbalance(volumeRows);
    const volumeByMailbox = new Map<number, { date: string; sends: number }[]>();
    for (const r of volumeRows) {
      (
        volumeByMailbox.get(r.mailbox_id) ??
        volumeByMailbox.set(r.mailbox_id, []).get(r.mailbox_id)!
      ).push({ date: r.day, sends: r.sends });
    }
    // contract-verbatim: {mailbox_id, series}[] — seven_day_avg lives on the
    // Mailbox DTO, not here (reconciled at B6.13)
    void sevenDayAvg;
    const volume = {
      items: [...volumeByMailbox.entries()].map(([mailbox_id, s]) => ({
        mailbox_id,
        series: s,
      })),
      imbalance: flag !== null,
    };

    // GET /campaigns (list entry for the golden campaign) — full Campaign DTO
    const campaignRow = (
      await pool.query(
        `SELECT name, status, sequence_id, tier_effort_config, ramp_config,
                recycled_from_campaign_id
         FROM campaigns WHERE id = $1`,
        [GOLDEN.campaignId],
      )
    ).rows[0] as {
      name: string;
      status: string;
      sequence_id: number | null;
      tier_effort_config: unknown;
      ramp_config: unknown;
      recycled_from_campaign_id: number | null;
    };
    const campaigns = {
      items: [
        {
          id: GOLDEN.campaignId,
          name: campaignRow.name,
          status: campaignRow.status,
          sequence_id: campaignRow.sequence_id,
          tier_effort_config: campaignRow.tier_effort_config,
          ramp_config: campaignRow.ramp_config,
          ramp_stages: [
            { start_day: 1, end_day: 1, cap: 5 },
            { start_day: 2, end_day: 2, cap: 8 },
            { start_day: 3, end_day: 3, cap: 10 },
            { start_day: 4, end_day: 4, cap: 12 },
            { start_day: 5, end_day: 7, cap: 15 },
          ],
          first_activated_at: '2027-01-01T00:00:00.000Z',
          variable_overrides: {},
          resolved_variables: {},
          auto_observation: { field: null, rules: {} },
          recycle_sources: [],
          recycled_from_campaign_id: campaignRow.recycled_from_campaign_id,
          enrolled_count: outcomes.total,
          contacted_count: progress.numerator,
          delivery_confirmed_count: deliveryConfirmed,
          pending_delivery_confirmation_count: pendingDeliveryConfirmation,
          finished_count: outcomes.total,
          finishing_count: 0,
          manual_only_count: 0, // golden replay config makes all tiers automated
        },
      ],
      total: 1,
      page: 1,
      per_page: 50,
    };

    mkdirSync(OUT_DIR, { recursive: true });
    const write = (name: string, data: unknown) => {
      writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2) + '\n');
      console.log(`wrote ${name}`);
    };
    write('overview.json', overview);
    write('outcomes.json', outcomes);
    write('analytics-steps.json', steps);
    write('analytics-tiers.json', tiers);
    write('health-trend.json', series);
    write('mailbox-volume.json', volume);
    write('campaigns.json', campaigns);
    // Unibox fixtures need incoming_messages (B3) — exported once the poller exists.
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
