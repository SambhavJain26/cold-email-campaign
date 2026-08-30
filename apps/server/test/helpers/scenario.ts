// Scenario runner DSL (B3.4, docs/13 §4): drives the REAL scheduler + poller
// + eventStore over MockTransport + VirtualClock + test Postgres. This file
// is a test helper — it may import concrete clocks/transports.
//
// Checkpoint plan: B3.4 lands the harness (seeding, scripted outcomes,
// time-stepping, inline job queue); the tick/poll hooks are wired to the real
// scheduler (B3.7) and poller (B3.10) as those land.
import { Pool } from 'pg';
import { createDb, type Db } from '../../src/db/client';
import { EventStore } from '../../src/services/eventStore';
import { buildEvent } from '../../src/domain/events';
import { VirtualClock } from '../../src/clock/virtual';
import { MockTransport } from '../../src/transport/mock/mockTransport';
import { threadedReply, dsnBounce, oooReply } from '../../src/transport/mock/inbound';
import { seededRng, type Rng } from '../../src/util/rng';
import type { SequenceDef } from '../../src/domain/sequence';
import type { SendWindow } from '../../src/db/schema/transport';
import type { CurrentLeadTier, EnrollmentState, LeadTier } from '@coldemail/shared';
import { Scheduler } from '../../src/scheduler/scheduler';
import { Poller } from '../../src/poller/poller';
import { StaticSequenceProvider } from '../../src/scheduler/staticSequenceProvider';
import { RenderEngine } from '../../src/render/engine';
import { runConfirmDelivery } from '../../src/scheduler/confirmDelivery';
import type { JobPort } from '../../src/scheduler/types';
import { CapturingAlerts } from '../../src/alerts/types';
import { enroll as enrollService } from '../../src/services/enrollment';
import { TEST_DATABASE_URL, resetCoreTables } from './db';

export interface ScenarioConfig {
  mailboxes: number;
  dailyCap?: number;
  sendWindow?: SendWindow;
  sequence: SequenceDef;
  /** ISO start instant; default Monday 2026-01-05 08:00 ET. */
  start?: string;
  seed?: number;
  tickMinutes?: number;
  pollMinutes?: number;
  /** send_jitter_pct override (golden L3 uses 0 for exact-slot pacing). */
  jitterPct?: number;
  /** Campaign ramp config; scenarios default to NO ramp (unlimited enroll). */
  ramp?: { ramp_days: number; ramp_daily_enroll_cap: number };
  /** Test-only post-ramp safety cap; production campaigns default to 15. */
  steadyDailyEnrollCap?: number;
  /** Legacy-read fixture override. New campaign behavior is fixed A=researched/B=auto. */
  tierEffortConfig?: {
    A: 'human_written' | 'template_researched' | 'template_auto';
    B: 'human_written' | 'template_researched' | 'template_auto';
    C: 'human_written' | 'template_researched' | 'template_auto';
  };
}

export type LeadRef = string; // 'L0001' … — id 1…, email l0001@scenario.dev

export type ScriptedOutcome =
  | { outcome: 'hard_bounce'; dsn?: string }
  | { outcome: 'soft_bounce_then_deliver'; retries?: number; dsn?: string; atStep?: number }
  /**
   * `error` defaults to the mock's `421 4.7.0 try again later` — which reads as
   * provider THROTTLING (docs/06 §6). Pass a non-throttle string to exercise
   * the plain `smtp_failing` path.
   */
  | { outcome: 'smtp_transient'; times?: number; error?: string };

interface PendingInbound {
  at: Date;
  mailboxId: number;
  build: () => Omit<Parameters<MockTransport['queueInbound']>[1], never>;
}

interface ScheduledJob {
  at: Date;
  name: string;
  run: (now: Date) => Promise<void>;
}

export interface ScenarioHooks {
  /** Real scheduler tick — wired at B3.7. */
  tick?: (now: Date) => Promise<void>;
  /** Real poller cycle — wired at B3.10. */
  poll?: (mailboxId: number, now: Date) => Promise<void>;
}

export function leadId(ref: LeadRef): number {
  return Number(ref.slice(1));
}
export function leadEmail(ref: LeadRef): string {
  return `l${ref.slice(1).padStart(4, '0')}@scenario.dev`;
}

export class Scenario {
  readonly clock: VirtualClock;
  readonly mock: MockTransport;
  readonly db: Db;
  readonly pool: Pool;
  readonly store: EventStore;
  readonly rng: Rng;
  readonly campaignId = 1;
  readonly hooks: ScenarioHooks = {};
  readonly alerts = new CapturingAlerts();
  readonly sequences = new StaticSequenceProvider();
  readonly scheduler: Scheduler;
  readonly poller: Poller;
  /** JobPort backed by the inline queue — pg-boss's stand-in (docs/13 §4). */
  readonly jobPort: JobPort;

  private readonly cfg: Required<
    Pick<ScenarioConfig, 'mailboxes' | 'dailyCap' | 'tickMinutes' | 'pollMinutes'>
  > &
    ScenarioConfig;
  private pendingInbound: PendingInbound[] = [];
  private jobs: ScheduledJob[] = [];
  /** Registered per-lead reactions to accepted sends (bounces, replies). */
  private sendWatchers = new Map<string, ((entry: SentEntryLite) => void)[]>();
  private seenSends = 0;

  constructor(cfg: ScenarioConfig) {
    this.cfg = {
      dailyCap: 30,
      tickMinutes: 15,
      pollMinutes: 15,
      ...cfg,
    };
    this.clock = new VirtualClock(cfg.start ?? '2026-01-05T13:00:00Z');
    this.mock = new MockTransport(this.clock);
    ({ db: this.db, pool: this.pool } = createDb(TEST_DATABASE_URL));
    this.store = new EventStore(this.db);
    this.rng = seededRng(cfg.seed ?? 42);
    this.sequences.register(this.campaignId, cfg.sequence);
    this.jobPort = {
      scheduleConfirmDelivery: (job) => {
        this.scheduleJob('confirm-delivery', job.runAt, () =>
          runConfirmDelivery({ db: this.db, store: this.store, clock: this.clock }, job).then(
            () => undefined,
          ),
        );
        return Promise.resolve();
      },
    };
    this.scheduler = new Scheduler({
      db: this.db,
      pool: this.pool,
      store: this.store,
      transport: this.mock,
      clock: this.clock,
      rng: this.rng,
      sequences: this.sequences,
      renderer: new RenderEngine(),
      jobs: this.jobPort,
      alerts: this.alerts,
    });
    this.poller = new Poller({
      db: this.db,
      store: this.store,
      transport: this.mock,
      clock: this.clock,
      alerts: this.alerts,
    });
    // Default hooks: the REAL scheduler tick (B3.7) + REAL poll cycle (B3.10).
    this.hooks.tick = async () => {
      await this.scheduler.tick();
    };
    this.hooks.poll = async (mailboxId) => {
      await this.poller.poll(mailboxId);
    };
  }

  /** Reset DB, seed mailboxes + campaign + settings. Call once, first. */
  async init(): Promise<void> {
    await resetCoreTables(this.pool);
    const window = this.cfg.sendWindow ?? { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' };
    for (let i = 1; i <= this.cfg.mailboxes; i++) {
      await this.pool.query(
        `INSERT INTO mailboxes (display_name, from_address, smtp_host, imap_host, daily_cap, send_window)
         VALUES ($1, $2, 'smtp.scenario.dev', 'imap.scenario.dev', $3, $4)`,
        [`mb${i}`, `mb${i}@scenario.dev`, this.cfg.dailyCap, JSON.stringify(window)],
      );
    }
    const ramp = this.cfg.ramp ?? { ramp_days: 0, ramp_daily_enroll_cap: 0 }; // no ramp by default
    const rampStages =
      ramp.ramp_days > 0
        ? [{ start_day: 1, end_day: ramp.ramp_days, cap: ramp.ramp_daily_enroll_cap }]
        : [];
    await this.pool.query(
      `INSERT INTO campaigns
         (name, status, ramp_config, ramp_stages, tier_effort_config, steady_daily_enroll_cap)
       VALUES ('Scenario Campaign', 'active', $1, $2, $3, $4)`,
      [
        JSON.stringify(ramp),
        JSON.stringify(rampStages),
        JSON.stringify(
          this.cfg.tierEffortConfig ?? {
            A: 'template_researched',
            B: 'template_auto',
            C: 'template_auto',
          },
        ),
        this.cfg.steadyDailyEnrollCap ?? 15,
      ],
    );
    // Settings survive resetCoreTables (single seeded row) — restore the
    // tunables tests mutate so runs stay order-independent.
    await this.pool.query(
      `UPDATE settings SET scheduler_tick_minutes = $1, poll_interval_minutes = $2,
              optout_detection = 'auto', send_jitter_pct = $3 WHERE id = 1`,
      [this.cfg.tickMinutes, this.cfg.pollMinutes, this.cfg.jitterPct ?? 20],
    );
  }

  // ── seeding & scripting ────────────────────────────────────────────────────

  /** Insert `count` leads (ids 1..count == L0001..). Tier layout by contiguous ranges. */
  async importLeads(
    count: number,
    opts: { tiers?: Partial<Record<LeadTier, number>>; state?: string } = {},
  ): Promise<void> {
    const tierOf = (i: number): LeadTier | null => {
      // Most scheduler scenarios exercise delivery, so their default leads
      // must be currently enrollable. Import-specific tests continue to
      // create genuinely untiered leads through the ingest service.
      if (!opts.tiers) return 'B';
      let cursor = 0;
      for (const [tier, n] of Object.entries(opts.tiers) as [LeadTier, number][]) {
        cursor += n;
        if (i <= cursor) return tier;
      }
      return null;
    };
    const emails: string[] = [];
    const tiers: (LeadTier | null)[] = [];
    const states: (string | null)[] = [];
    for (let i = 1; i <= count; i++) {
      emails.push(leadEmail(`L${i}`));
      tiers.push(tierOf(i));
      states.push(opts.state ?? null);
    }
    await this.pool.query(
      `INSERT INTO leads (email, tier, state)
       SELECT * FROM unnest($1::text[], $2::lead_tier[], $3::text[])`,
      [emails, tiers, states],
    );
  }

  /** Enroll leads via the REAL enrollment service (B3.9, docs/06 §7). */
  async enroll(opts: {
    count: number;
    tier?: CurrentLeadTier;
    force?: boolean;
  }): Promise<number[]> {
    const result = await enrollService(
      { db: this.db, store: this.store, clock: this.clock, sequences: this.sequences },
      this.campaignId,
      opts.count,
      { tier: opts.tier, force: opts.force ?? true }, // scenarios default past the capacity gate
    );
    return result.leadIds;
  }

  /** Script what happens when we send to a lead (docs/13 §4). */
  onSend(ref: LeadRef, script: ScriptedOutcome): void {
    const email = leadEmail(ref);
    if (script.outcome === 'smtp_transient') {
      for (let i = 0; i < (script.times ?? 1); i++) {
        this.mock.onSend(email, {
          kind: 'transient',
          ...(script.error !== undefined && { error: script.error }),
        });
      }
      return;
    }
    if (script.outcome === 'hard_bounce') {
      this.watchSends(email, (entry) => {
        this.pendingInbound.push({
          at: new Date(entry.at.getTime() + 5 * 60_000), // DSN ~5 min after send
          mailboxId: entry.mailboxId,
          build: () =>
            dsnBounce({
              recipient: email,
              status: script.dsn ?? '5.1.1',
              receivedAt: new Date(entry.at.getTime() + 5 * 60_000),
            }),
        });
      });
      return;
    }
    // soft_bounce_then_deliver: `retries` consecutive accepted sends starting
    // at the atStep-th (default: the first) soft-bounce, then delivery sticks.
    const retries = script.retries ?? 1;
    const firstBounced = script.atStep ?? 1;
    let count = 0;
    this.watchSends(email, (entry) => {
      count += 1;
      if (count < firstBounced || count >= firstBounced + retries) return;
      this.pendingInbound.push({
        at: new Date(entry.at.getTime() + 5 * 60_000),
        mailboxId: entry.mailboxId,
        build: () =>
          dsnBounce({
            recipient: email,
            status: script.dsn ?? '4.2.2',
            receivedAt: new Date(entry.at.getTime() + 5 * 60_000),
          }),
      });
    });
  }

  /**
   * A human reply `days` after the lead's Nth accepted send (`afterStep`,
   * default 1 — soft-retry resends count as their own sends, so scripts that
   * combine both must account for the extra attempt).
   */
  replyAfter(ref: LeadRef, opts: { days: number; text: string; afterStep?: number }): void {
    const email = leadEmail(ref);
    this.afterNthSend(email, opts.afterStep ?? 1, (entry) => {
      const at = new Date(entry.at.getTime() + opts.days * 86_400_000);
      this.pendingInbound.push({
        at,
        mailboxId: entry.mailboxId,
        build: () =>
          threadedReply({
            from: email,
            bodyText: opts.text,
            receivedAt: at,
            inReplyTo: entry.messageId,
          }),
      });
    });
  }

  /** An OOO auto-reply `days` after the lead's Nth accepted send. */
  oooAfter(ref: LeadRef, opts: { days: number; afterStep?: number }): void {
    const email = leadEmail(ref);
    this.afterNthSend(email, opts.afterStep ?? 1, (entry) => {
      const at = new Date(entry.at.getTime() + opts.days * 86_400_000);
      this.pendingInbound.push({
        at,
        mailboxId: entry.mailboxId,
        build: () => oooReply({ from: email, receivedAt: at, inReplyTo: entry.messageId }),
      });
    });
  }

  /**
   * A link unsubscribe `days` after the lead's Nth accepted send (the compliance
   * footer link — no inbound message involved; appended via the eventStore
   * exactly like the future API route will).
   */
  linkUnsubAfter(ref: LeadRef, opts: { days: number; afterStep: number }): void {
    const email = leadEmail(ref);
    this.afterNthSend(email, opts.afterStep, (entry) => {
      const at = new Date(entry.at.getTime() + opts.days * 86_400_000);
      this.scheduleJob('link-unsub', at, async (now) => {
        const r = await this.pool.query(
          `SELECT id, lead_id FROM enrollments WHERE lead_id = $1 AND campaign_id = $2`,
          [leadId(ref), this.campaignId],
        );
        if (r.rows.length !== 1) throw new Error(`linkUnsubAfter(${ref}): enrollment not found`);
        await this.store.append([
          buildEvent.unsubscribe({
            leadId: leadId(ref),
            enrollmentId: r.rows[0].id,
            campaignId: this.campaignId,
            occurredAt: now,
            source: 'link',
          }),
        ]);
      });
    });
  }

  /** Operator action: tag a reply's sentiment (appends sentiment_tagged, decision M). */
  async tagSentiment(ref: LeadRef, sentiment: 'positive' | 'neutral' | 'negative'): Promise<void> {
    const r = await this.pool.query(
      `SELECT e.id, e.enrollment_id FROM events e
       WHERE e.lead_id = $1 AND e.type = 'human_reply' ORDER BY e.id DESC LIMIT 1`,
      [leadId(ref)],
    );
    if (r.rows.length !== 1) throw new Error(`tagSentiment(${ref}): no human_reply found`);
    await this.store.append([
      buildEvent.sentimentTagged({
        leadId: leadId(ref),
        enrollmentId: r.rows[0].enrollment_id,
        campaignId: this.campaignId,
        occurredAt: this.clock.now(),
        sentiment,
        attributes: { reply_event_id: Number(r.rows[0].id), tagged_by: 'human' },
      }),
    ]);
  }

  /** Operator action: mark a meeting booked (milestone flag, not a state). */
  async bookMeeting(ref: LeadRef): Promise<void> {
    const r = await this.pool.query(
      `SELECT id FROM enrollments WHERE lead_id = $1 AND campaign_id = $2`,
      [leadId(ref), this.campaignId],
    );
    if (r.rows.length !== 1) throw new Error(`bookMeeting(${ref}): enrollment not found`);
    await this.store.append([
      buildEvent.meetingBooked({
        leadId: leadId(ref),
        enrollmentId: r.rows[0].id,
        campaignId: this.campaignId,
        occurredAt: this.clock.now(),
      }),
    ]);
  }

  /** Inline job queue — the test-side JobPort (pg-boss equivalent, docs/13 §4). */
  scheduleJob(name: string, at: Date, run: (now: Date) => Promise<void>): void {
    this.jobs.push({ name, at, run });
  }

  // ── time ───────────────────────────────────────────────────────────────────

  async advanceDays(days: number): Promise<void> {
    await this.advanceMs(days * 86_400_000);
  }
  async advanceHours(hours: number): Promise<void> {
    await this.advanceMs(hours * 3_600_000);
  }

  /**
   * Step the clock in tick-interval increments; at each step: harvest new
   * sends → feed watchers; release due inbound to the mock; run due jobs;
   * run scheduler tick + due pollers (once wired).
   */
  private async advanceMs(ms: number): Promise<void> {
    const target = new Date(this.clock.now().getTime() + ms);
    let sinceLastPoll = Number.POSITIVE_INFINITY; // poll immediately on first step
    await this.clock.stepTo(target, { minutes: this.cfg.tickMinutes }, async (now) => {
      this.harvestSends();
      this.releaseInbound(now);
      await this.runDueJobs(now);
      if (this.hooks.tick) await this.hooks.tick(now);
      sinceLastPoll += this.cfg.tickMinutes;
      if (this.hooks.poll && sinceLastPoll >= this.cfg.pollMinutes) {
        sinceLastPoll = 0;
        for (let mb = 1; mb <= this.cfg.mailboxes; mb++) {
          await this.hooks.poll(mb, now);
        }
      }
      // Anything sent/queued by this step's tick becomes visible next step.
      this.harvestSends();
    });
  }

  // ── assertions ─────────────────────────────────────────────────────────────

  async expectEnrollment(
    ref: LeadRef,
    expected: { state?: EnrollmentState; meetingBooked?: boolean },
  ): Promise<void> {
    const r = await this.pool.query(
      `SELECT current_state, meeting_booked FROM enrollments WHERE lead_id = $1 AND campaign_id = $2`,
      [leadId(ref), this.campaignId],
    );
    if (r.rows.length !== 1) {
      throw new Error(`expectEnrollment(${ref}): no enrollment found`);
    }
    const row = r.rows[0] as { current_state: string; meeting_booked: boolean };
    if (expected.state !== undefined && row.current_state !== expected.state) {
      throw new Error(
        `expectEnrollment(${ref}): state ${row.current_state}, expected ${expected.state}`,
      );
    }
    if (expected.meetingBooked !== undefined && row.meeting_booked !== expected.meetingBooked) {
      throw new Error(
        `expectEnrollment(${ref}): meeting_booked ${row.meeting_booked}, expected ${expected.meetingBooked}`,
      );
    }
  }

  /** Accepted sends from one mailbox on one campaign-day (0-based, UTC of scenario start). */
  sendsOnDay(mailboxId: number, day: number): number {
    const dayStart = new Date(
      Date.UTC(2026, 0, 5 + day) /* aligned with default start */,
    ).getTime();
    return this.mock.sentLog.filter(
      (e) =>
        e.result.accepted &&
        e.msg.mailboxId === mailboxId &&
        e.at.getTime() >= dayStart &&
        e.at.getTime() < dayStart + 86_400_000,
    ).length;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private watchSends(email: string, fn: (entry: SentEntryLite) => void): void {
    const key = email.toLowerCase();
    const list = this.sendWatchers.get(key) ?? [];
    list.push(fn);
    this.sendWatchers.set(key, list);
  }

  /** Fire once, on the lead's Nth ACCEPTED send. */
  private afterNthSend(email: string, nth: number, fn: (entry: SentEntryLite) => void): void {
    let count = 0;
    this.watchSends(email, (entry) => {
      count += 1;
      if (count === nth) fn(entry);
    });
  }

  /** Feed newly-accepted sends to registered watchers exactly once. */
  private harvestSends(): void {
    while (this.seenSends < this.mock.sentLog.length) {
      const entry = this.mock.sentLog[this.seenSends]!;
      this.seenSends += 1;
      if (!entry.result.accepted) continue;
      const watchers = this.sendWatchers.get(entry.msg.to.toLowerCase());
      if (!watchers) continue;
      for (const w of watchers) {
        w({
          at: entry.at,
          mailboxId: entry.msg.mailboxId,
          messageId: entry.msg.headers.messageId,
          references: entry.msg.headers.references,
        });
      }
    }
  }

  private releaseInbound(now: Date): void {
    const due = this.pendingInbound.filter((p) => p.at.getTime() <= now.getTime());
    this.pendingInbound = this.pendingInbound.filter((p) => p.at.getTime() > now.getTime());
    for (const p of due.sort((a, b) => a.at.getTime() - b.at.getTime())) {
      this.mock.queueInbound(p.mailboxId, p.build());
    }
  }

  private async runDueJobs(now: Date): Promise<void> {
    const due = this.jobs
      .filter((j) => j.at.getTime() <= now.getTime())
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    this.jobs = this.jobs.filter((j) => j.at.getTime() > now.getTime());
    for (const j of due) {
      await j.run(now);
    }
  }
}

interface SentEntryLite {
  at: Date;
  mailboxId: number;
  messageId: string;
  references?: string[];
}

/** DSL entry point (docs/13 §4). */
export async function scenario(cfg: ScenarioConfig): Promise<Scenario> {
  const s = new Scenario(cfg);
  await s.init();
  return s;
}
