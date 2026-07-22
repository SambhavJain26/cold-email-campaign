// B2.18: export golden-cohort API fixtures for the web MSW mocks (docs/11 §4).
// Seeds the cohort into the TEST database through the real eventStore, runs
// the real metrics engine, and writes JSON shaped per docs/10-api-contract.md
// into apps/web/src/mocks/fixtures/golden/. Run: npm run golden:export (server).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../../../src/db/client';
import { MetricsEngine } from '../../../src/services/metrics';
import { mailboxImbalance } from '../../../src/services/metrics/watchRules';
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
    const outcomes = {
      UNSUBSCRIBED: count('UNSUBSCRIBED'),
      BOUNCED: count('BOUNCED'),
      REPLIED: { positive: count('REPLIED', 'positive'), neutral: count('REPLIED', 'neutral') },
      COMPLETED: count('COMPLETED'),
      ACTIVE: count('ACTIVE'),
      NEW: count('NEW'),
      total: states.reduce((a, r) => a + r.n, 0),
    };

    // GET /analytics/overview (capacity is scheduler territory — static
    // completed-campaign values until B3/B6 wire the real calculator)
    const [progress, reply, positive, meetings, hard, soft, unsub] = await Promise.all([
      m.progress(scope),
      m.replyRate(scope),
      m.positiveReplyRate(scope),
      m.meetings(scope),
      m.hardBounceRate(scope),
      m.softBounceRate(scope),
      m.unsubscribeRate(scope),
    ]);
    const overview = {
      progress: {
        contacted: progress.numerator,
        total: progress.denominator,
        pct: progress.value,
      },
      reply_rate: reply,
      positive_rate: positive,
      meetings: { count: meetings.count, per_100: meetings.per100 },
      hard_bounce_rate: hard,
      soft_bounce_rate: soft,
      unsubscribe_rate: unsub,
      capacity: {
        total_daily_capacity: 120,
        followups_due_today: 0,
        sent_so_far_today: 0,
        room_for_new: 120,
        ramp_cap_remaining: null,
        suggested: 0,
      },
      watch_flags: [],
    };

    // GET /analytics/steps + /analytics/tiers
    const steps = (await m.stepAnalytics(scope)).map((s) => ({
      step_no: s.stepNo,
      delivered: s.delivered,
      positive_replies: s.positiveRepliers,
      positive_rate: s.positiveRate,
    }));
    const tiers = (await m.tierAnalytics(scope)).map((t) => ({
      tier: t.tier,
      contacted: t.contacted,
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
    const volume = {
      items: [...volumeByMailbox.entries()].map(([mailbox_id, s]) => ({
        mailbox_id,
        seven_day_avg: sevenDayAvg[mailbox_id] ?? 0,
        series: s,
      })),
      imbalance: flag !== null,
    };

    // GET /campaigns (list entry for the golden campaign)
    const campaigns = {
      items: [
        {
          id: GOLDEN.campaignId,
          name: 'Golden Pass 1',
          status: 'completed',
          sequence_id: null,
          enrolled_count: outcomes.total,
          contacted_count: progress.numerator,
          recycled_from_campaign_id: null,
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
