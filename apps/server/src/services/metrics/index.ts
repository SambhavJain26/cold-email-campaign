// The metrics engine (docs/05): public API over db/repos/metricsRepo.
// Every rate returns { numerator, denominator, value } so the UI can render
// "72 / 867 = 8.3%" verbatim. value = percentage rounded to 1 decimal.
import type { Db } from '../../db/client';
import * as q from '../../db/repos/metricsRepo';
import type { MetricScope } from '../../db/repos/metricsRepo';

export type { MetricScope };

export interface Metric {
  numerator: number;
  denominator: number | null;
  value: number;
}

const pct = (numerator: number, denominator: number): Metric => ({
  numerator,
  denominator,
  value: denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0,
});

export class MetricsEngine {
  constructor(private readonly db: Db) {}

  contacted(scope: MetricScope = {}): Promise<number> {
    return q.countContacted(this.db, scope);
  }

  /** Reply rate = distinct human-reply leads ÷ contacted. Golden: 72/867 = 8.3%. */
  async replyRate(scope: MetricScope = {}): Promise<Metric> {
    const [n, d] = await Promise.all([
      q.countDistinctRepliers(this.db, scope),
      q.countContacted(this.db, scope),
    ]);
    return pct(n, d);
  }

  /** Positive rate = leads with an effectively-positive reply ÷ contacted. Golden: 28/867 = 3.2%. */
  async positiveReplyRate(scope: MetricScope = {}): Promise<Metric> {
    const [n, d] = await Promise.all([
      q.countPositiveReplierLeads(this.db, scope),
      q.countContacted(this.db, scope),
    ]);
    return pct(n, d);
  }

  /** Meetings booked (absolute) + per-100-contacted. Golden: 17, 2.0. */
  async meetings(scope: MetricScope = {}): Promise<{ count: number; per100: number }> {
    const [n, d] = await Promise.all([
      q.countEvents(this.db, 'meeting_booked', scope),
      q.countContacted(this.db, scope),
    ]);
    return { count: n, per100: d > 0 ? Math.round((n / d) * 1000) / 10 : 0 };
  }

  /** Hard-bounce rate = hard_bounce events ÷ distinct leads sent-to. Golden: 18/885 = 2.0%. */
  async hardBounceRate(scope: MetricScope = {}): Promise<Metric> {
    const [n, d] = await Promise.all([
      q.countEvents(this.db, 'hard_bounce', scope),
      q.countLeadsSentTo(this.db, scope),
    ]);
    return pct(n, d);
  }

  /** Soft-bounce rate = soft_bounce events ÷ distinct leads sent-to. Golden: 9/885 = 1.0%. */
  async softBounceRate(scope: MetricScope = {}): Promise<Metric> {
    const [n, d] = await Promise.all([
      q.countEvents(this.db, 'soft_bounce', scope),
      q.countLeadsSentTo(this.db, scope),
    ]);
    return pct(n, d);
  }

  /** Unsubscribe rate = distinct unsubscribed leads ÷ contacted. Golden: 40/867 = 4.6%. */
  async unsubscribeRate(scope: MetricScope = {}): Promise<Metric> {
    const [n, d] = await Promise.all([
      q.countUnsubscribedLeads(this.db, scope),
      q.countContacted(this.db, scope),
    ]);
    return pct(n, d);
  }

  /** Progress = contacted ÷ total enrollments. Golden: 867/885. */
  async progress(scope: MetricScope = {}): Promise<Metric> {
    const [n, d] = await Promise.all([
      q.countContacted(this.db, scope),
      q.countEnrollments(this.db, scope.campaignId ?? null),
    ]);
    return pct(n, d);
  }

  /** Per-step table (13b): delivered / repliers / positive% per step. */
  async stepAnalytics(scope: MetricScope = {}) {
    const rows = await q.stepStats(this.db, scope);
    return rows.map((r) => ({
      stepNo: r.step_no,
      delivered: r.delivered,
      repliers: r.repliers,
      positiveRepliers: r.positive_repliers,
      stepReplyRate: pct(r.repliers, r.delivered),
      positiveRate: pct(r.positive_repliers, r.delivered),
    }));
  }

  /** Per-tier table (13c). */
  async tierAnalytics(scope: MetricScope = {}) {
    const rows = await q.tierStats(this.db, scope);
    return rows.map((r) => ({
      tier: r.tier,
      contacted: r.contacted,
      replyRate: pct(r.repliers, r.contacted),
      positiveRate: pct(r.positive_repliers, r.contacted),
      meetings: r.meetings,
      mode: r.mode,
    }));
  }

  /** Direct and eventual per-variant outcomes for a selected sequence step. */
  async variantAnalytics(scope: MetricScope = {}, stepNo = 1) {
    const rows = await q.variantStats(this.db, scope, stepNo);
    return rows.map((r) => ({
      variantId: r.variant_id,
      direct: {
        sent: r.sent,
        delivered: r.direct_delivered,
        contacted: r.direct_contacted,
        replies: r.direct_repliers,
        positiveReplies: r.direct_positive_repliers,
        replyRate: pct(r.direct_repliers, r.direct_contacted),
        positiveRate: pct(r.direct_positive_repliers, r.direct_contacted),
      },
      eventual: {
        cohort: r.cohort,
        replies: r.eventual_repliers,
        positiveReplies: r.eventual_positive_repliers,
        meetings: r.meetings,
        replyRate: pct(r.eventual_repliers, r.cohort),
        positiveRate: pct(r.eventual_positive_repliers, r.cohort),
      },
    }));
  }

  /** Terminal-outcome breakdown + self-check (mutually exclusive; must sum). */
  async selfCheck(campaignId: number | null = null) {
    return q.selfCheckViolations(this.db, campaignId);
  }

  dailySeries(scope: MetricScope, from: Date, to: Date) {
    return q.dailySeries(this.db, scope, from, to);
  }

  mailboxVolume(from: Date, to: Date) {
    return q.mailboxVolume(this.db, from, to);
  }
}
