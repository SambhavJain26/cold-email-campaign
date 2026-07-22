// Golden fixture generator (B1.7, docs/13 §2). Deterministic - no randomness.
// buildGoldenEvents() constructs the full 885-lead event log per constants.ts,
// SELF-ASSERTS its composition by folding the reducer over it, and only then
// is it serialized. The committed events.jsonl is written by write.ts and
// locked by a determinism test (regenerating must reproduce it byte-for-byte).
import {
  completeSnapshot,
  foldEvents,
  shouldComplete,
  type EnrollmentSnapshot,
} from '../../../src/domain/reducer';
import { parseDomainEvent, type DomainEvent } from '../../../src/domain/events';
import { GOLDEN, linkUnsubStep, replierStep, sentimentOf, tierOf } from './constants';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface RawEvent {
  leadId: number;
  occurredAt: Date;
  build: (seq: number, replySeqOf: (leadId: number) => number) => DomainEvent;
  isHumanReply?: boolean;
}

export function buildGoldenEvents(): DomainEvent[] {
  const base = new Date(GOLDEN.base).getTime();
  const raw: RawEvent[] = [];

  const enrollDay = (i: number) => Math.floor((i - 1) / GOLDEN.enrollPerDay);
  const leadMinute = (i: number) => (i % 240) * MIN;
  const sentAt = (i: number, step: number) =>
    new Date(base + (enrollDay(i) + GOLDEN.stepDayOffsets[step - 1]!) * DAY + leadMinute(i));
  const mailboxOf = (i: number) => ((i - 1) % GOLDEN.mailboxes) + 1;
  const ids = (i: number) => ({ leadId: i, enrollmentId: i, campaignId: GOLDEN.campaignId });

  const push = (leadId: number, occurredAt: Date, build: RawEvent['build'], isHumanReply = false) =>
    raw.push({ leadId, occurredAt, build, isHumanReply });

  for (let i = 1; i <= GOLDEN.totalLeads; i++) {
    const tier = tierOf(i);
    const enrolledAt = new Date(base + enrollDay(i) * DAY + leadMinute(i) - 2 * HOUR);
    push(i, enrolledAt, (_s) =>
      parseDomainEvent({
        type: 'enrolled',
        occurredAt: enrolledAt,
        ...ids(i),
        attributes: { tier },
      }),
    );

    const isHard = (GOLDEN.hardBounceIds as readonly number[]).includes(i);
    const sentiment = sentimentOf(i);
    const isLinkUnsub = (GOLDEN.linkUnsubIds as readonly number[]).includes(i);
    const isSoft = (GOLDEN.softRecoverIds as readonly number[]).includes(i);
    const lastStep = isHard
      ? 1
      : sentiment !== null
        ? replierStep(i)
        : isLinkUnsub
          ? linkUnsubStep(i)
          : GOLDEN.shape.lastStepNo;

    for (let step = 1; step <= lastStep; step++) {
      const sAt = sentAt(i, step);
      const softHere = isSoft && step === GOLDEN.softBounceStep;

      push(i, sAt, () =>
        parseDomainEvent({
          type: 'sent',
          occurredAt: sAt,
          ...ids(i),
          stepNo: step,
          mailboxId: mailboxOf(i),
          messageId: `<g-${i}-${step}@golden.local>`,
          attributes: { content_hash: `sha-step${step}` },
        }),
      );

      if (isHard && step === 1) {
        const bAt = new Date(sAt.getTime() + 2 * HOUR);
        push(i, bAt, () =>
          parseDomainEvent({
            type: 'hard_bounce',
            occurredAt: bAt,
            ...ids(i),
            stepNo: step,
            mailboxId: mailboxOf(i),
            reason: '5.1.1 user unknown',
          }),
        );
        break; // no delivery, sequence over
      }

      if (softHere) {
        const softAt = new Date(sAt.getTime() + 1 * HOUR);
        const retryAt = new Date(sAt.getTime() + 5 * HOUR);
        const delAt = new Date(retryAt.getTime() + 6 * HOUR);
        push(i, softAt, () =>
          parseDomainEvent({
            type: 'soft_bounce',
            occurredAt: softAt,
            ...ids(i),
            stepNo: step,
            mailboxId: mailboxOf(i),
            reason: '4.2.2 mailbox full',
            attributes: { retry_no: 1 },
          }),
        );
        push(i, retryAt, () =>
          parseDomainEvent({
            type: 'sent',
            occurredAt: retryAt,
            ...ids(i),
            stepNo: step,
            mailboxId: mailboxOf(i),
            messageId: `<g-${i}-${step}-r1@golden.local>`,
            attributes: { content_hash: `sha-step${step}`, retry_no: 1 },
          }),
        );
        push(i, delAt, () =>
          parseDomainEvent({ type: 'delivered', occurredAt: delAt, ...ids(i), stepNo: step }),
        );
      } else {
        const delAt = new Date(sAt.getTime() + 6 * HOUR);
        push(i, delAt, () =>
          parseDomainEvent({ type: 'delivered', occurredAt: delAt, ...ids(i), stepNo: step }),
        );
      }

      if (sentiment !== null && step === lastStep) {
        const replyAt = new Date(sAt.getTime() + DAY + 30 * MIN);
        push(
          i,
          replyAt,
          () =>
            parseDomainEvent({
              type: 'human_reply',
              occurredAt: replyAt,
              ...ids(i),
              stepNo: step,
              // decision M: negative = STOP auto-detect, known at insert;
              // positive/neutral start null and get a sentiment_tagged event
              sentiment: sentiment === 'negative' ? 'negative' : null,
            }),
          true,
        );

        if (sentiment === 'negative') {
          const unsubAt = new Date(replyAt.getTime() + 1 * MIN);
          push(i, unsubAt, () =>
            parseDomainEvent({
              type: 'unsubscribe',
              occurredAt: unsubAt,
              ...ids(i),
              source: 'reply',
              attributes: { matched_keyword: 'remove me' },
            }),
          );
        } else {
          const tagAt = new Date(replyAt.getTime() + 2 * HOUR);
          push(i, tagAt, (_s, replySeqOf) =>
            parseDomainEvent({
              type: 'sentiment_tagged',
              occurredAt: tagAt,
              ...ids(i),
              sentiment,
              attributes: { reply_event_id: replySeqOf(i), tagged_by: 'human' },
            }),
          );
        }

        if ((GOLDEN.meetingIds as readonly number[]).includes(i)) {
          const mAt = new Date(replyAt.getTime() + DAY);
          push(i, mAt, () =>
            parseDomainEvent({ type: 'meeting_booked', occurredAt: mAt, ...ids(i) }),
          );
        }
      }

      if (isLinkUnsub && step === lastStep) {
        const uAt = new Date(sAt.getTime() + 6 * HOUR + DAY);
        push(i, uAt, () =>
          parseDomainEvent({ type: 'unsubscribe', occurredAt: uAt, ...ids(i), source: 'link' }),
        );
      }
    }
  }

  // Chronological order with stable tiebreaks -> seq = position + 1.
  raw.sort(
    (a, b) =>
      a.occurredAt.getTime() - b.occurredAt.getTime() ||
      a.leadId - b.leadId ||
      Number(b.isHumanReply ?? false) - Number(a.isHumanReply ?? false),
  );

  const replySeqByLead = new Map<number, number>();
  const events: DomainEvent[] = raw.map((r, idx) => {
    const seq = idx + 1;
    if (r.isHumanReply) replySeqByLead.set(r.leadId, seq);
    const e = r.build(seq, (leadId) => {
      const s = replySeqByLead.get(leadId);
      if (s === undefined) throw new Error(`no reply seq recorded for lead ${leadId}`);
      return s;
    });
    return { ...e, id: seq };
  });

  assertComposition(events);
  return events;
}

/** Fold the generated log and verify it reproduces spec Part 10 exactly. */
function assertComposition(events: DomainEvent[]): void {
  const byEnrollment = new Map<number, DomainEvent[]>();
  for (const e of events) {
    const eid = 'enrollmentId' in e ? e.enrollmentId : undefined;
    if (eid === undefined) continue;
    (byEnrollment.get(eid) ?? byEnrollment.set(eid, []).get(eid)!).push(e);
  }

  const end = new Date(GOLDEN.endOfCampaign);
  const counts: Record<string, number> = {};
  const bestSentiments: Record<string, number> = { positive: 0, neutral: 0, negative: 0 };
  let repliers = 0;
  let meetings = 0;

  for (const evs of byEnrollment.values()) {
    let s: EnrollmentSnapshot = foldEvents(evs, GOLDEN.shape);
    const lastSentAt = evs.filter((e) => e.type === 'sent').at(-1)?.occurredAt ?? null;
    if (shouldComplete(s, GOLDEN.shape, lastSentAt, end, GOLDEN.deliveryConfirmMs)) {
      s = completeSnapshot(s, new Date(lastSentAt!.getTime() + GOLDEN.deliveryConfirmMs));
    }
    counts[s.state] = (counts[s.state] ?? 0) + 1;
    if (evs.some((e) => e.type === 'human_reply')) repliers += 1;
    if (s.bestReplySentiment) bestSentiments[s.bestReplySentiment]! += 1;
    if (s.meetingBooked) meetings += 1;
  }

  const x = GOLDEN.expected;
  const canon = (v: unknown): string =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? JSON.stringify(Object.fromEntries(Object.entries(v as object).sort()))
      : JSON.stringify(v);
  const check = (label: string, actual: unknown, wanted: unknown) => {
    if (canon(actual) !== canon(wanted)) {
      throw new Error(
        `golden generator self-check failed: ${label} = ${canon(actual)}, expected ${canon(wanted)}`,
      );
    }
  };
  check('terminals', counts, x.terminals);
  check('distinct repliers', repliers, x.distinctRepliers);
  check('best sentiments', bestSentiments, x.sentiments);
  check('meetings', meetings, x.meetings);
  check(
    'delivered per step',
    [1, 2, 3, 4].map(
      (n) =>
        new Set(events.filter((e) => e.type === 'delivered' && e.stepNo === n).map((e) => e.leadId))
          .size,
    ),
    x.deliveredPerStep,
  );
  check('total enrolled', byEnrollment.size, GOLDEN.totalLeads);
}

/** Stable JSONL serialization (snake_case keys, ISO dates). */
export function serializeGoldenEvents(events: DomainEvent[]): string {
  return (
    events
      .map((e) =>
        JSON.stringify({
          seq: e.id,
          type: e.type,
          occurred_at: e.occurredAt.toISOString(),
          lead_id: e.leadId,
          enrollment_id: 'enrollmentId' in e ? e.enrollmentId : undefined,
          campaign_id: 'campaignId' in e ? e.campaignId : undefined,
          step_no: 'stepNo' in e ? e.stepNo : undefined,
          mailbox_id: 'mailboxId' in e ? e.mailboxId : undefined,
          message_id: 'messageId' in e ? e.messageId : undefined,
          sentiment: 'sentiment' in e ? e.sentiment : undefined,
          source: 'source' in e ? e.source : undefined,
          reason: 'reason' in e ? e.reason : undefined,
          attributes: 'attributes' in e ? e.attributes : undefined,
        }),
      )
      .join('\n') + '\n'
  );
}
