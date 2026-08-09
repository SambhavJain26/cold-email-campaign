// The scheduler (docs/06): tick algorithm §1, sendOne §5. Idempotent and
// crash-safe — a pg advisory lock stops overlapping ticks; every send commits
// (event appended) before the next is attempted.
import type { Pool } from 'pg';
import type { Db } from '../db/client';
import type { Clock } from '../clock';
import type { MailTransport, OutboundMessage } from '../transport/types';
import type { Rng } from '../util/rng';
import type { AlertSink } from '../alerts/types';
import type { EventStore } from '../services/eventStore';
import type { JobPort, LeadLite, RenderContext, Renderer, SequenceProvider } from './types';
import type { SendWindow } from '../db/schema/transport';
import { getComplianceSettings, getSettings, type SettingsRow } from '../db/repos/settingsRepo';
import { listMailboxesByStatus, patchMailbox } from '../db/repos/mailboxesRepo';
import {
  countSentForStep,
  countSentSince,
  firstSentEvent,
  hasSoftBounceAfter,
  lastSentEvent,
  type SentEventLite,
} from '../db/repos/eventsRepo';
import {
  activeCampaignIds,
  getById as getEnrollmentById,
  listDue,
  redistributeUnstarted,
  type DueEnrollment,
} from '../db/repos/enrollmentsRepo';
import { insertSentMessage } from '../db/repos/sentMessagesRepo';
import { autoObservationsOf, getCampaign } from '../db/repos/campaignsRepo';
import { getVariantById } from '../db/repos/sequencesRepo';
import { buildEvent } from '../domain/events';
import {
  shapeOf,
  stepOf,
  type SequenceDef,
  type SequenceStepDef,
  type VariantDef,
} from '../domain/sequence';
import { evaluateAutoPause } from '../services/autoPause';
import { resolveTimezone } from './tzmap';
import { insideWindow, startOfLocalDay } from './window';
import { jitterFactor, minGapMs, paceReady } from './pacing';
import { pickMailbox, type RotationCandidate } from './rotation';
import { buildMessageId, buildThreadHeaders } from './mime';
import { isRateLimitError, transientVerdict } from './providerBlock';

const SCHEDULER_LOCK = [2, 0] as const; // advisory keyspace: (2,0) = tick

export interface SchedulerDeps {
  db: Db;
  pool: Pool;
  store: EventStore;
  transport: MailTransport;
  clock: Clock;
  rng: Rng;
  sequences: SequenceProvider;
  renderer: Renderer;
  jobs: JobPort;
  alerts: AlertSink;
}

export type SendOutcomeKind =
  'sent' | 'transient' | 'hard_bounce' | 'auth_failed' | 'no_step' | 'render_failed';

export interface TickResult {
  ran: boolean;
  sent: number;
  completed: number;
  overdueLeft: number;
}

export type SendBlocker = {
  code:
    | 'compliance_missing_address'
    | 'no_healthy_mailbox'
    | 'send_window_closed'
    | 'daily_capacity_exhausted'
    | 'pacing_delay'
    | 'manual_only';
  message: string;
};

interface MailboxBudget extends RotationCandidate {
  window: SendWindow;
  timezone: string;
  fromAddress: string;
}

export class Scheduler {
  /** Consecutive transient SMTP failures per mailbox (docs/06 §5 4b). */
  private transientFailures = new Map<number, number>();
  /** …of which consecutive rate-limit answers (docs/06 §6 provider_blocked). */
  private rateLimitFailures = new Map<number, number>();
  /** catchup_backlog is emitted once per downtime episode (docs/06 §1). */
  private catchupAlerted = false;
  /** render_failed alerted once per variant per process run. */
  private renderFailAlerted = new Set<number>();
  /** Per-tick caches: compliance row, per-campaign auto_observations, round-robin counters. */
  private tickCtx: {
    compliance: { physicalAddress: string; optoutText: string };
    autoObs: Map<number, Record<string, string> | null>;
    roundRobin: Map<string, number>;
  } | null = null;

  /** Last completed tick (in-memory — single process, GET /system/status). */
  private _lastTickAt: Date | null = null;
  private _sendBlockers: SendBlocker[] = [];
  private blockerAlerted = new Set<SendBlocker['code']>();

  get lastTickAt(): Date | null {
    return this._lastTickAt;
  }

  get sendBlockers(): readonly SendBlocker[] {
    return this._sendBlockers;
  }

  private async setSendBlockers(blockers: SendBlocker[]): Promise<void> {
    this._sendBlockers = blockers;
    const active = new Set(blockers.map((b) => b.code));
    for (const blocker of blockers) {
      if (!this.blockerAlerted.has(blocker.code)) {
        await this.deps.alerts.emit(`send_blocked_${blocker.code}`, 'warning', {
          code: blocker.code,
          message: blocker.message,
        });
      }
    }
    this.blockerAlerted = active;
  }

  constructor(private readonly deps: SchedulerDeps) {}

  async tick(): Promise<TickResult> {
    const { pool, clock } = this.deps;
    const now = clock.now();
    this._lastTickAt = now;

    const client = await pool.connect();
    const locked = (
      await client.query('SELECT pg_try_advisory_lock($1, $2) AS ok', [...SCHEDULER_LOCK])
    ).rows[0].ok as boolean;
    if (!locked) {
      client.release();
      return { ran: false, sent: 0, completed: 0, overdueLeft: 0 };
    }
    try {
      return await this.tickBody(now);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [...SCHEDULER_LOCK]);
      client.release();
    }
  }

  private async tickBody(now: Date): Promise<TickResult> {
    const { db } = this.deps;
    const settings = await getSettings(db);
    const compliance = await getComplianceSettings(db);
    this.tickCtx = { compliance, autoObs: new Map(), roundRobin: new Map() };
    try {
      return await this.tickInner(now, settings, compliance);
    } finally {
      this.tickCtx = null;
    }
  }

  private async tickInner(
    now: Date,
    settings: SettingsRow,
    compliance: { physicalAddress: string; optoutText: string },
  ): Promise<TickResult> {
    const { db, rng, alerts } = this.deps;

    // A. housekeeping
    await this.refreshMailboxHealth(now, settings);
    const completed = await this.completeFinished(now, settings);

    // CAN-SPAM global guard (docs/08 §4): empty physical address → refuse all
    // sends. setSendBlockers emits one durable alert per blocker episode.
    if (compliance.physicalAddress.trim() === '') {
      await this.setSendBlockers([
        {
          code: 'compliance_missing_address',
          message: 'Set a physical address in Settings → Compliance.',
        },
      ]);
      return { ran: true, sent: 0, completed, overdueLeft: 0 };
    }

    // B. Per-mailbox budgets reset at midnight in the mailbox timezone.
    const boxes = await listMailboxesByStatus(db, ['ok']);
    const budgets = new Map<number, MailboxBudget>();
    for (const mb of boxes) {
      const capToday = mb.resumeCap ?? mb.dailyCap;
      const sentToday = await countSentSince(
        db,
        mb.id,
        startOfLocalDay(now, mb.timezone || settings.defaultTimezone),
      );
      const gap = minGapMs(mb.sendWindow, capToday) * jitterFactor(rng, settings.sendJitterPct);
      const remaining = Math.max(0, capToday - sentToday);
      budgets.set(mb.id, {
        id: mb.id,
        sentToday,
        capToday,
        budget: paceReady(now, mb.lastSendAt, gap) ? remaining : 0,
        lastSendAt: mb.lastSendAt,
        window: mb.sendWindow,
        timezone: mb.timezone,
        fromAddress: mb.fromAddress,
      });
    }

    // C. due work, oldest-first — this ordering + budgets IS never-burst catch-up.
    const due = await listDue(db, now);
    const blockers: SendBlocker[] = [];
    const automaticDue = due.filter((e) => e.personalizationMode !== 'human_written');
    const manualDue = due.filter((e) => e.personalizationMode === 'human_written');
    if (due.length > 0 && budgets.size === 0) {
      blockers.push({
        code: 'no_healthy_mailbox',
        message: 'Reconnect or resume a mailbox before sending.',
      });
    }
    if (manualDue.length > 0) {
      blockers.push({
        code: 'manual_only',
        message: `${manualDue.length} due Tier A enrollment${manualDue.length === 1 ? '' : 's'} require the manual composer.`,
      });
    }
    if (automaticDue.length > 0 && budgets.size > 0) {
      const windowOpen =
        !settings.enforceSendWindow ||
        automaticDue.some((e) =>
          [...budgets.values()].some((b) =>
            insideWindow(
              b.window,
              now,
              resolveTimezone(e.leadState, b.timezone || settings.defaultTimezone),
            ),
          ),
        );
      const capacityAvailable = [...budgets.values()].some((b) => b.capToday > b.sentToday);
      const paceAvailable = [...budgets.values()].some((b) => b.budget > 0);
      if (!windowOpen) {
        blockers.push({
          code: 'send_window_closed',
          message: 'Wait for the recipient-local send window to open.',
        });
      } else if (!capacityAvailable) {
        blockers.push({
          code: 'daily_capacity_exhausted',
          message: 'Increase capacity or wait for the next mailbox-local day.',
        });
      } else if (!paceAvailable) {
        blockers.push({
          code: 'pacing_delay',
          message: 'Mailbox pacing is active; the next send resumes after its minimum gap.',
        });
      }
    }
    await this.setSendBlockers(blockers);
    const attempted = new Set<number>(); // one send attempt per mailbox per tick (pacing)
    let sent = 0;
    let terminal = 0;
    for (const e of due) {
      // Mode 1 is an explicit operator action only.  Leaving these due makes
      // the blocker/guidance visible without letting the scheduler silently
      // turn a human-written enrollment into an automated send.
      if (e.personalizationMode === 'human_written') continue;
      const windowSource = e.assignedMailboxId
        ? budgets.get(e.assignedMailboxId)
        : budgets.values().next().value;
      if (!windowSource) continue; // follow-up's mailbox not ok, or no ok mailboxes
      const tz = resolveTimezone(e.leadState, windowSource.timezone || settings.defaultTimezone);
      if (settings.enforceSendWindow && !insideWindow(windowSource.window, now, tz)) {
        continue; // stays due; retried next tick
      }

      let mb: MailboxBudget | undefined;
      if (e.assignedMailboxId !== null) {
        // Follow-up: FIXED mailbox — never rerouted (threading, spec Part 9).
        mb = budgets.get(e.assignedMailboxId);
        if (!mb || mb.budget <= 0 || attempted.has(mb.id)) continue;
      } else {
        const candidates = [...budgets.values()].filter((c) => !attempted.has(c.id));
        const picked = pickMailbox(candidates, rng);
        if (!picked) continue;
        mb = picked as MailboxBudget;
      }

      const outcome = await this.sendOne(e, mb, now, settings);
      switch (outcome) {
        case 'sent':
          sent += 1;
          mb.budget -= 1;
          mb.sentToday += 1;
          attempted.add(mb.id); // paceReady = false for the rest of this tick
          break;
        case 'transient':
          attempted.add(mb.id); // don't hammer a failing mailbox within one tick
          break;
        case 'hard_bounce':
          terminal += 1; // RCPT-time 5xx — enrollment went terminal, no send slot used
          break;
        case 'auth_failed':
          budgets.delete(mb.id);
          break;
        case 'no_step':
        case 'render_failed': // nothing sent; enrollment stays due until the template is fixed
          break;
      }
    }

    // Catch-up detection (docs/06 §1): more overdue work than today's remaining
    // budget → one alert per episode; resets when the backlog drains.
    const overdueLeft = due.length - sent - terminal;
    const remainingBudget = [...budgets.values()].reduce(
      (sum, b) => sum + Math.max(0, b.capToday - b.sentToday),
      0,
    );
    if (overdueLeft > remainingBudget) {
      if (!this.catchupAlerted) {
        await alerts.emit('catchup_backlog', 'info', {
          overdue: overdueLeft,
          remainingBudgetToday: remainingBudget,
        });
        this.catchupAlerted = true;
      }
    } else {
      this.catchupAlerted = false;
    }

    return { ran: true, sent, completed, overdueLeft };
  }

  /** §6 housekeeping: stale-poll detection + resume_cap auto-clear. */
  private async refreshMailboxHealth(now: Date, settings: SettingsRow): Promise<void> {
    const { db, alerts } = this.deps;
    const staleMs = settings.stalePollHours * 3_600_000;
    const boxes = await listMailboxesByStatus(db, ['ok']);
    for (const mb of boxes) {
      // Replies might be sitting undetected — sequences must not keep firing.
      if (
        mb.lastSuccessfulPollAt !== null &&
        now.getTime() - mb.lastSuccessfulPollAt.getTime() > staleMs
      ) {
        await patchMailbox(db, mb.id, {
          status: 'imap_stale',
          statusReason: `no successful poll since ${mb.lastSuccessfulPollAt.toISOString()}`,
        });
        await alerts.emit('imap_stale', 'warning', {
          mailboxId: mb.id,
          lastSuccessfulPollAt: mb.lastSuccessfulPollAt.toISOString(),
        });
        continue;
      }
      // resume_cap clears after 7 consecutive clean days (docs/06 §6).
      if (mb.resumeCap !== null && mb.pausedAt !== null) {
        const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
        if (mb.pausedAt.getTime() <= sevenDaysAgo.getTime()) {
          const bounces = await this.hardBouncesSince(mb.id, sevenDaysAgo);
          if (bounces === 0) {
            await patchMailbox(db, mb.id, { resumeCap: null, pausedAt: null });
          }
        }
      }
    }
  }

  private async hardBouncesSince(mailboxId: number, since: Date): Promise<number> {
    const { pool } = this.deps;
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM events
       WHERE mailbox_id = $1 AND type = 'hard_bounce' AND occurred_at >= $2`,
      [mailboxId, since],
    );
    return r.rows[0].n as number;
  }

  /** Derived COMPLETED transitions per campaign (docs/04 §2.1). */
  private async completeFinished(now: Date, settings: SettingsRow): Promise<number> {
    const { db, store, sequences } = this.deps;
    let completed = 0;
    for (const campaignId of await activeCampaignIds(db)) {
      let seq;
      try {
        seq = await sequences.sequenceFor(campaignId);
      } catch {
        continue; // campaign without a sequence — nothing to complete against
      }
      completed += await store.completeEligible(
        shapeOf(seq, settings.softRetryMax),
        settings.deliveryConfirmHours * 3_600_000,
        now,
        campaignId,
      );
    }
    return completed;
  }

  /** docs/06 §5 — one send, committed before the next is attempted. */
  async sendOne(
    e: DueEnrollment,
    mb: { id: number; fromAddress: string },
    now: Date,
    settings: SettingsRow,
    opts: { variantOverride?: VariantDef; literal?: boolean } = {},
  ): Promise<SendOutcomeKind> {
    const { db, store, transport, renderer, sequences, jobs, alerts } = this.deps;

    const seq = await sequences.sequenceFor(e.campaignId);

    // Soft-bounce retry resends the SAME step (docs/07 §2.1): the reducer
    // already advanced current_step_no at the original send.
    let stepNo = e.currentStepNo;
    let retryOf: SentEventLite | null = null;
    const last = await lastSentEvent(db, e.id);
    if (last && (await hasSoftBounceAfter(db, e.id, last.stepNo, last.occurredAt))) {
      stepNo = last.stepNo;
      retryOf = last;
    }

    const step = stepOf(seq, stepNo);
    if (!step) return 'no_step'; // past the end — completion housekeeping owns this

    // Variant selection (B4.8): manual override > retry pins the ORIGINAL
    // variant (the retry must resend the same text) > round-robin.
    let variant = opts.variantOverride ?? (retryOf ? this.variantOf(seq, retryOf) : null);
    let literal = opts.literal ?? false;
    if (variant === null && retryOf?.variantId != null) {
      // Original variant left the active set (rotation/bespoke) — DB lookup.
      const row = await getVariantById(db, retryOf.variantId);
      if (row) {
        variant = {
          id: row.id,
          label: row.label,
          contentHash: row.contentHash,
          subjectTemplate: row.subjectTemplate,
          bodyTemplate: row.bodyTemplate,
        };
        literal = row.attributes.bespoke === true;
      }
    }
    if (variant === null) {
      if (step.variants.length === 0) {
        await this.alertRenderFailed(-step.stepNo, e, ['no_active_variants']);
        return 'render_failed';
      }
      variant = await this.pickVariant(e.campaignId, step);
    }

    const rendered = renderer.render({
      variant,
      step,
      lead: this.leadLiteOf(e),
      enrollmentId: e.id,
      ctx: await this.renderContextFor(e, seq, step, { literal }),
    });

    // Fatal pre-send checks block the send (docs/08 §5); the enrollment stays
    // due so a fixed template resumes it naturally.
    if (rendered.checks.fatal.length > 0) {
      await this.alertRenderFailed(
        variant.id,
        e,
        rendered.checks.fatal.map((f) => f.id),
      );
      return 'render_failed';
    }
    this.renderFailAlerted.delete(variant.id);

    // Threading (docs/07 §4) via buildMime (docs/08 §6).
    const messageId = buildMessageId(e.id, stepNo, now, mb.fromAddress);
    const { inReplyTo, references } = await buildThreadHeaders(db, e.id, stepNo, step.inThread);

    const msg: OutboundMessage = {
      mailboxId: mb.id,
      to: e.leadEmail,
      subject: rendered.subject,
      bodyText: rendered.bodyText,
      bodyHtml: rendered.bodyHtml,
      headers: { messageId, inReplyTo, references },
    };

    // `listDue` is a snapshot.  Re-read and send while holding the same
    // enrollment lock EventStore uses for inbound poller appends.  A reply that
    // gets the lock first turns the projection terminal and this sends nothing.
    const result = await store.withEnrollmentLock(e.id, async (tx) => {
      const current = await getEnrollmentById(tx, e.id);
      if (!current || current.currentState !== 'ACTIVE') return null;
      const delivery = await transport.send(msg);
      if (!delivery.accepted) return delivery;

      const nextStep = stepOf(seq, stepNo + 1);
      const nextSendAt = nextStep ? new Date(now.getTime() + nextStep.waitDays * 86_400_000) : null;
      await store.appendUnderEnrollmentLock(
        tx,
        e.id,
        [
          buildEvent.sent({
            leadId: e.leadId,
            enrollmentId: e.id,
            campaignId: e.campaignId,
            occurredAt: now,
            stepNo,
            mailboxId: mb.id,
            messageId,
            attributes: { content_hash: rendered.contentHash, variant_id: variant.id },
          }),
        ],
        {
          patches: [
            {
              enrollmentId: e.id,
              nextSendAt,
              // fixed at FIRST send; every later step threads from this mailbox
              assignedMailboxId: e.assignedMailboxId ?? mb.id,
            },
          ],
          txWork: async (lockedTx) => {
            await insertSentMessage(lockedTx, {
              messageId,
              enrollmentId: e.id,
              leadId: e.leadId,
              mailboxId: mb.id,
              stepNo,
              contentHash: rendered.contentHash,
              sentAt: now,
            });
          },
        },
      );
      return delivery;
    });
    if (result === null) return 'no_step';

    if (result.accepted) {
      await patchMailbox(db, mb.id, { lastSendAt: now });
      await jobs.scheduleConfirmDelivery({
        enrollmentId: e.id,
        stepNo,
        sentAt: now,
        runAt: new Date(now.getTime() + settings.deliveryConfirmHours * 3_600_000),
      });
      this.transientFailures.delete(mb.id);
      return 'sent';
    }

    if (result.transientError !== undefined) {
      // 4b: append NOTHING; next_send_at unchanged — retried next tick.
      const failures = (this.transientFailures.get(mb.id) ?? 0) + 1;
      this.transientFailures.set(mb.id, failures);
      const rateLimited = isRateLimitError(result.transientError)
        ? (this.rateLimitFailures.get(mb.id) ?? 0) + 1
        : 0; // a non-rate-limit failure breaks the run
      this.rateLimitFailures.set(mb.id, rateLimited);

      const verdict = transientVerdict(failures, rateLimited);
      if (verdict !== 'keep_retrying') {
        this.transientFailures.delete(mb.id);
        this.rateLimitFailures.delete(mb.id);
      }
      if (verdict === 'provider_blocked') {
        // docs/06 §6: the provider keeps refusing us. Same shape as
        // auth_failed — stop sending, alert, and hand unstarted enrollments
        // back to rotation so the campaign keeps moving on other mailboxes.
        await patchMailbox(db, mb.id, {
          status: 'provider_blocked',
          statusReason: result.transientError,
          pausedAt: now,
        });
        await alerts.emit('provider_blocked', 'error', {
          mailboxId: mb.id,
          failures,
          lastError: result.transientError,
        });
        await redistributeUnstarted(db, mb.id);
      } else if (verdict === 'smtp_failing') {
        await patchMailbox(db, mb.id, {
          status: 'paused',
          statusReason: 'smtp_failing',
          pausedAt: now,
        });
        await alerts.emit('mailbox_smtp_failing', 'error', {
          mailboxId: mb.id,
          failures,
          lastError: result.transientError,
        });
      }
      return 'transient';
    }

    if (result.errorScope === 'recipient') {
      // 4c: RCPT-time 5xx — the mailbox doesn't exist; hard bounce directly.
      await store.append([
        buildEvent.hardBounce({
          leadId: e.leadId,
          enrollmentId: e.id,
          campaignId: e.campaignId,
          occurredAt: now,
          stepNo,
          mailboxId: mb.id,
          reason: result.permanentError,
        }),
      ]);
      await this.afterHardBounce(mb.id, now);
      return 'hard_bounce';
    }

    // 4c: auth/connection-level permanent failure.
    await patchMailbox(db, mb.id, {
      status: 'auth_failed',
      statusReason: result.permanentError ?? 'permanent SMTP failure',
      pausedAt: now,
    });
    await alerts.emit('mailbox_auth_failed', 'error', {
      mailboxId: mb.id,
      error: result.permanentError,
    });
    // Redistribution (docs/06 §6): unstarted enrollments re-enter rotation;
    // mid-thread enrollments keep their assignment and wait.
    await redistributeUnstarted(db, mb.id);
    return 'auth_failed';
  }

  /** Post-commit hook on every hard_bounce append (docs/06 §6, B3.13). */
  protected async afterHardBounce(mailboxId: number, now: Date): Promise<void> {
    await evaluateAutoPause({ db: this.deps.db, alerts: this.deps.alerts }, mailboxId, now);
  }

  // ── render wiring (B4.8) ───────────────────────────────────────────────────

  private leadLiteOf(e: DueEnrollment): LeadLite {
    return {
      id: e.leadId,
      email: e.leadEmail,
      firstName: e.leadFirstName,
      company: e.leadCompany,
      state: e.leadState,
    };
  }

  /** The caller-loaded RenderContext (docs/08: the engine itself is pure). */
  private async renderContextFor(
    e: DueEnrollment,
    seq: SequenceDef,
    step: SequenceStepDef,
    opts: { literal: boolean },
  ): Promise<RenderContext> {
    const compliance = this.tickCtx?.compliance ?? (await getComplianceSettings(this.deps.db));
    const base: RenderContext = {
      mode: e.personalizationMode,
      customFields: e.leadCustomFields,
      autoObservations: await this.autoObsFor(e.campaignId),
      compliance,
      literal: opts.literal,
    };
    if (step.inThread && step.stepNo > 1) {
      base.threadSubject = await this.threadSubjectFor(e, seq, base);
    }
    return base;
  }

  private async autoObsFor(campaignId: number): Promise<Record<string, string> | null> {
    const cache = this.tickCtx?.autoObs;
    const cached = cache?.get(campaignId);
    if (cached !== undefined) return cached;
    const campaign = await getCampaign(this.deps.db, campaignId);
    const table = campaign ? autoObservationsOf(campaign) : null;
    cache?.set(campaignId, table);
    return table;
  }

  /** The variant a past send used, if it is still in the active def. */
  private variantOf(seq: SequenceDef, sent: SentEventLite): VariantDef | null {
    if (sent.variantId === null) return null;
    const step = stepOf(seq, sent.stepNo);
    return step?.variants.find((v) => v.id === sent.variantId) ?? null;
  }

  /**
   * Round-robin among active variants (docs/06 pickVariant, B4.8): stateless —
   * the counter is the campaign-step's sent count, so it survives restarts and
   * rebuilds; the per-tick cache keeps it one query per (campaign, step) per tick.
   */
  private async pickVariant(campaignId: number, step: SequenceStepDef): Promise<VariantDef> {
    const key = `${campaignId}:${step.stepNo}`;
    const cache = this.tickCtx?.roundRobin;
    let count = cache?.get(key);
    if (count === undefined) {
      count = await countSentForStep(this.deps.db, campaignId, step.stepNo);
    }
    cache?.set(key, count + 1);
    return step.variants[count % step.variants.length]!;
  }

  /**
   * The rendered step-1 subject for `Re:` threading (docs/08 §6): re-rendered
   * deterministically (same seed → same spintax picks). Bespoke step-1 renders
   * literal. Undefined on any lookup failure — the engine then Re:-prefixes
   * the step's own subject instead of crashing the send.
   */
  private async threadSubjectFor(
    e: DueEnrollment,
    seq: SequenceDef,
    base: RenderContext,
  ): Promise<string | undefined> {
    const { db, renderer } = this.deps;
    const first = await firstSentEvent(db, e.id);
    if (!first) return undefined;
    let variant = this.variantOf(seq, first);
    let literal = false;
    if (!variant && first.variantId !== null) {
      const row = await getVariantById(db, first.variantId);
      if (row) {
        variant = {
          id: row.id,
          label: row.label,
          contentHash: row.contentHash,
          subjectTemplate: row.subjectTemplate,
          bodyTemplate: row.bodyTemplate,
        };
        literal = row.attributes.bespoke === true;
      }
    }
    if (!variant) return undefined;
    return renderer.render({
      variant,
      step: { stepNo: first.stepNo, inThread: false },
      lead: this.leadLiteOf(e),
      enrollmentId: e.id,
      ctx: { ...base, threadSubject: undefined, literal },
    }).subject;
  }

  private async alertRenderFailed(
    variantKey: number,
    e: DueEnrollment,
    fatalIds: string[],
  ): Promise<void> {
    if (this.renderFailAlerted.has(variantKey)) return;
    this.renderFailAlerted.add(variantKey);
    await this.deps.alerts.emit('render_failed', 'error', {
      enrollmentId: e.id,
      campaignId: e.campaignId,
      fatal: fatalIds,
    });
  }
}
