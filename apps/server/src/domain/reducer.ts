// THE core function (docs/04 §2): applyEvent(state, event) → state.
// Pure — no I/O, no clock, no randomness. Serves three jobs: live projection
// updates (eventStore), rebuild-projections, and exhaustive unit testing.
import {
  isTerminal,
  SENTIMENT_RANK,
  TERMINAL_PRIORITY,
  type EnrollmentState,
  type Sentiment,
  type TerminalState,
} from '@coldemail/shared';
import type { DomainEvent } from './events';

/** What the reducer needs to know about the campaign's sequence (ctx, not state). */
export interface SequenceShape {
  /** Highest step_no in the sequence (4 for the walkthrough sequence). */
  lastStepNo: number;
  /** Soft bounces beyond this count become terminal BOUNCED (settings.soft_retry_max, default 2). */
  softRetryMax: number;
  /** Defaults to true for legacy/static sequences that predate this control. */
  stopOnReply?: boolean;
}

export interface EnrollmentSnapshot {
  state: EnrollmentState;
  currentStepNo: number;
  softBounceRetries: number;
  bestReplySentiment: Sentiment | null;
  meetingBooked: boolean;
  terminalAt: Date | null;
  /** reply event id → effective sentiment (latest sentiment_tagged wins over the insert value). */
  replySentiments: Record<number, Sentiment | null>;
  reviewHoldIds?: number[];
  reviewRevision?: number;
  delayedUntil?: Date | null;
  resumeDueAt?: Date | null;
  manualStopEventId?: number | null;
}

export function initialSnapshot(): EnrollmentSnapshot {
  return {
    state: 'NEW',
    currentStepNo: 1,
    softBounceRetries: 0,
    bestReplySentiment: null,
    meetingBooked: false,
    terminalAt: null,
    replySentiments: {},
  };
}

function toTerminal(s: EnrollmentSnapshot, t: TerminalState, at: Date): EnrollmentSnapshot {
  // Precedence (spec Part 3): an incoming terminal only wins if its priority
  // is >= the current terminal's. terminalAt keeps the FIRST terminal time.
  if (isTerminal(s.state) && TERMINAL_PRIORITY[t] < TERMINAL_PRIORITY[s.state]) return s;
  return { ...s, state: t, terminalAt: isTerminal(s.state) ? s.terminalAt : at };
}

function bumpSentiment(s: EnrollmentSnapshot, replyEventId: number, sentiment: Sentiment | null) {
  const replySentiments = { ...s.replySentiments, [replyEventId]: sentiment };
  let best: Sentiment | null = null;
  for (const v of Object.values(replySentiments)) {
    if (v !== null && (best === null || SENTIMENT_RANK[v] > SENTIMENT_RANK[best])) best = v;
  }
  return { ...s, replySentiments, bestReplySentiment: best };
}

export function applyEvent(
  s: EnrollmentSnapshot,
  e: DomainEvent,
  ctx: SequenceShape,
): EnrollmentSnapshot {
  switch (e.type) {
    case 'incoming_review_required':
      return isTerminal(s.state)
        ? s
        : { ...s, reviewHoldIds: [...(s.reviewHoldIds ?? []), e.id!], reviewRevision: e.id! };
    case 'outreach_review_decided':
      return isTerminal(s.state)
        ? s
        : {
            ...s,
            reviewHoldIds: (s.reviewHoldIds ?? []).filter(
              (id) => !e.attributes.hold_event_ids.includes(id),
            ),
            delayedUntil:
              e.attributes.action === 'delay' && e.attributes.until
                ? new Date(e.attributes.until)
                : null,
            reviewRevision: e.id!,
          };
    case 'sequence_stopped':
      return isTerminal(s.state)
        ? s
        : {
            ...toTerminal(s, 'STOPPED', e.occurredAt),
            reviewHoldIds: [],
            reviewRevision: e.id!,
            manualStopEventId: e.id!,
            resumeDueAt: e.attributes.resume_due_at ? new Date(e.attributes.resume_due_at) : null,
          };
    case 'sequence_restored':
      return s.state !== 'STOPPED' && s.state !== 'REPLIED'
        ? s
        : {
            ...s,
            state: 'ACTIVE',
            terminalAt: null,
            reviewHoldIds: [e.id!],
            reviewRevision: e.id!,
            manualStopEventId: null,
            resumeDueAt: new Date(e.attributes.resume_due_at),
            delayedUntil: null,
          };
    case 'incoming_authorship_confirmed':
      return bumpSentiment(s, -e.attributes.incoming_message_id, e.attributes.authorship === 'human' ? e.sentiment : null);
    case 'address_suppressed':
      return { ...s, reviewHoldIds: [], reviewRevision: e.id! };
    case 'enrolled':
      return s.state === 'NEW' ? { ...s, state: 'ACTIVE', currentStepNo: 1 } : s;

    case 'sent':
      // Completion is NOT triggered here — it's a derived transition (docs/04 §2.1).
      return isTerminal(s.state) ? s : { ...s, currentStepNo: e.stepNo + 1 };

    case 'delivered':
      return s; // metrics-only (feeds `contacted`)

    case 'soft_bounce': {
      const retries = s.softBounceRetries + 1;
      if (retries > ctx.softRetryMax) return toTerminal(s, 'BOUNCED', e.occurredAt);
      // stays ACTIVE; the scheduler re-queues the SAME step
      return { ...s, softBounceRetries: retries };
    }

    case 'hard_bounce':
      return toTerminal(s, 'BOUNCED', e.occurredAt);

    case 'human_reply': {
      if (e.id === undefined) throw new Error('human_reply event must have an id before folding');
      const withSentiment = bumpSentiment(s, e.id, e.sentiment);
      return ctx.stopOnReply === false
        ? withSentiment
        : toTerminal(withSentiment, 'REPLIED', e.occurredAt);
    }

    case 'unsubscribe':
      return toTerminal(s, 'UNSUBSCRIBED', e.occurredAt);
    case 'outreach_stopped':
      return isTerminal(s.state) ? s : toTerminal(s, 'STOPPED', e.occurredAt);

    case 'meeting_booked':
      return { ...s, meetingBooked: true }; // milestone flag — state unchanged (spec Part 3)

    case 'sentiment_tagged':
      // Retag: latest tag wins for that reply. Never changes enrollment state.
      return bumpSentiment(s, e.attributes.reply_event_id, e.sentiment);

    case 'reply_dispositioned':
      // Permission/recontact fact queried from the ledger; state changes only
      // through the accompanying unsubscribe event where applicable.
      return s;

    case 'auto_reply': // OOO is not engagement — sequence continues (spec Part 6)
    case 'deal_won':
    case 'deal_lost':
      return s;
  }
}

/** Fold a full (ordered) event history into a snapshot. */
export function foldEvents(
  events: readonly DomainEvent[],
  ctx: SequenceShape,
  seed: EnrollmentSnapshot = initialSnapshot(),
): EnrollmentSnapshot {
  return events.reduce((s, e) => applyEvent(s, e, ctx), seed);
}

/**
 * Derived COMPLETED transition (docs/04 §2.1): all steps sent (currentStepNo
 * past the last step), still ACTIVE, and the final step's delivery-confirm
 * window has passed. Used by the scheduler tick and rebuild-projections —
 * deliberately not part of applyEvent (no event exists for it).
 */
export function shouldComplete(
  s: EnrollmentSnapshot,
  ctx: SequenceShape,
  lastSentAt: Date | null,
  now: Date,
  deliveryConfirmMs: number,
): boolean {
  return (
    s.state === 'ACTIVE' &&
    s.currentStepNo > ctx.lastStepNo &&
    lastSentAt !== null &&
    now.getTime() >= lastSentAt.getTime() + deliveryConfirmMs
  );
}

export function completeSnapshot(s: EnrollmentSnapshot, at: Date): EnrollmentSnapshot {
  return toTerminal(s, 'COMPLETED', at);
}
