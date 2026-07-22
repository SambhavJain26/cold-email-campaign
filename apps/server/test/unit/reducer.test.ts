// B1.8: the full transition matrix (docs/04 §2.2) — every cell enumerated —
// plus precedence collisions, soft-retry exhaustion, sentiment resolution,
// and the derived completion rule.
import { describe, expect, it } from 'vitest';
import type { EnrollmentState } from '@coldemail/shared';
import { buildEvent, type DomainEvent } from '../../src/domain/events';
import {
  applyEvent,
  completeSnapshot,
  foldEvents,
  shouldComplete,
  type EnrollmentSnapshot,
  type SequenceShape,
} from '../../src/domain/reducer';

const ctx: SequenceShape = { lastStepNo: 4, softRetryMax: 2 };
const at = (min: number) => new Date(Date.UTC(2026, 2, 1, 10, min));
const ids = { leadId: 1, enrollmentId: 2, campaignId: 3 };

/** Build a snapshot sitting in a given state via a legitimate event history. */
function snapIn(state: EnrollmentState): EnrollmentSnapshot {
  const enrolled = buildEvent.enrolled({ ...ids, occurredAt: at(0) });
  const sent = buildEvent.sent({
    ...ids,
    id: 10,
    occurredAt: at(1),
    stepNo: 1,
    mailboxId: 1,
    messageId: '<m1@x>',
    attributes: { content_hash: 'h1' },
  });
  const history: Record<EnrollmentState, DomainEvent[]> = {
    NEW: [],
    ACTIVE: [enrolled, sent],
    REPLIED: [
      enrolled,
      sent,
      buildEvent.humanReply({ ...ids, id: 20, occurredAt: at(2), stepNo: 1 }),
    ],
    BOUNCED: [enrolled, sent, buildEvent.hardBounce({ ...ids, occurredAt: at(2), stepNo: 1 })],
    UNSUBSCRIBED: [
      enrolled,
      sent,
      buildEvent.unsubscribe({ ...ids, occurredAt: at(2), source: 'link' }),
    ],
    COMPLETED: [], // built via completeSnapshot below
  };
  if (state === 'COMPLETED') {
    return completeSnapshot(
      foldEvents(
        [
          enrolled,
          ...[1, 2, 3, 4].map((n) =>
            buildEvent.sent({
              ...ids,
              id: 10 + n,
              occurredAt: at(n),
              stepNo: n,
              mailboxId: 1,
              messageId: `<m${n}@x>`,
              attributes: { content_hash: `h${n}` },
            }),
          ),
        ],
        ctx,
      ),
      at(30),
    );
  }
  return foldEvents(history[state], ctx);
}

// ── the events used as matrix columns ────────────────────────────────────────
const col = {
  enrolled: () => buildEvent.enrolled({ ...ids, occurredAt: at(5) }),
  sent: () =>
    buildEvent.sent({
      ...ids,
      id: 30,
      occurredAt: at(5),
      stepNo: 2,
      mailboxId: 1,
      messageId: '<m30@x>',
      attributes: { content_hash: 'h2' },
    }),
  soft: (retryNo: number) =>
    buildEvent.softBounce({
      ...ids,
      occurredAt: at(5),
      stepNo: 2,
      attributes: { retry_no: retryNo },
    }),
  hard: () => buildEvent.hardBounce({ ...ids, occurredAt: at(5), stepNo: 2 }),
  reply: () => buildEvent.humanReply({ ...ids, id: 40, occurredAt: at(5), stepNo: 2 }),
  unsub: () => buildEvent.unsubscribe({ ...ids, occurredAt: at(5), source: 'reply' }),
  meeting: () => buildEvent.meetingBooked({ ...ids, occurredAt: at(5) }),
  tag: (replyEventId: number) =>
    buildEvent.sentimentTagged({
      ...ids,
      occurredAt: at(5),
      sentiment: 'positive',
      attributes: { reply_event_id: replyEventId, tagged_by: 'human' },
    }),
};

describe('transition matrix — one test per cell', () => {
  // NEW row
  it('NEW + enrolled -> ACTIVE at step 1', () => {
    const s = applyEvent(snapIn('NEW'), col.enrolled(), ctx);
    expect(s.state).toBe('ACTIVE');
    expect(s.currentStepNo).toBe(1);
  });

  // ACTIVE row
  it('ACTIVE + enrolled -> no change (already enrolled)', () => {
    expect(applyEvent(snapIn('ACTIVE'), col.enrolled(), ctx).state).toBe('ACTIVE');
  });
  it('ACTIVE + sent -> step advances', () => {
    const s = applyEvent(snapIn('ACTIVE'), col.sent(), ctx);
    expect(s.state).toBe('ACTIVE');
    expect(s.currentStepNo).toBe(3); // sent step 2 -> next is 3
  });
  it('ACTIVE + delivered -> no change', () => {
    const d = buildEvent.delivered({ ...ids, occurredAt: at(5), stepNo: 1 });
    expect(applyEvent(snapIn('ACTIVE'), d, ctx)).toEqual(snapIn('ACTIVE'));
  });
  it('ACTIVE + soft (within max) -> stays ACTIVE, retry counted', () => {
    const s = applyEvent(snapIn('ACTIVE'), col.soft(1), ctx);
    expect(s.state).toBe('ACTIVE');
    expect(s.softBounceRetries).toBe(1);
  });
  it('ACTIVE + soft x3 (beyond max 2) -> BOUNCED', () => {
    let s = snapIn('ACTIVE');
    s = applyEvent(s, col.soft(1), ctx);
    s = applyEvent(s, col.soft(2), ctx);
    expect(s.state).toBe('ACTIVE');
    s = applyEvent(s, col.soft(3), ctx);
    expect(s.state).toBe('BOUNCED');
  });
  it('ACTIVE + hard -> BOUNCED with terminalAt', () => {
    const s = applyEvent(snapIn('ACTIVE'), col.hard(), ctx);
    expect(s.state).toBe('BOUNCED');
    expect(s.terminalAt).toEqual(at(5));
  });
  it('ACTIVE + human_reply -> REPLIED', () => {
    expect(applyEvent(snapIn('ACTIVE'), col.reply(), ctx).state).toBe('REPLIED');
  });
  it('ACTIVE + unsubscribe -> UNSUBSCRIBED', () => {
    expect(applyEvent(snapIn('ACTIVE'), col.unsub(), ctx).state).toBe('UNSUBSCRIBED');
  });
  it('ACTIVE + meeting_booked -> flag only, still ACTIVE', () => {
    const s = applyEvent(snapIn('ACTIVE'), col.meeting(), ctx);
    expect(s.state).toBe('ACTIVE');
    expect(s.meetingBooked).toBe(true);
  });
  it('ACTIVE + auto_reply -> no change (OOO is not engagement)', () => {
    const e = buildEvent.autoReply({ ...ids, occurredAt: at(5) });
    expect(applyEvent(snapIn('ACTIVE'), e, ctx)).toEqual(snapIn('ACTIVE'));
  });

  // REPLIED row
  it('REPLIED + sent (race) -> state unharmed', () => {
    expect(applyEvent(snapIn('REPLIED'), col.sent(), ctx).state).toBe('REPLIED');
  });
  it('REPLIED + soft within max -> retry counted, state kept', () => {
    const s = applyEvent(snapIn('REPLIED'), col.soft(1), ctx);
    expect(s.state).toBe('REPLIED');
  });
  it('REPLIED + soft beyond max -> BOUNCED (3 outranks 2)', () => {
    let s = snapIn('REPLIED');
    s = applyEvent(s, col.soft(1), ctx);
    s = applyEvent(s, col.soft(2), ctx);
    s = applyEvent(s, col.soft(3), ctx);
    expect(s.state).toBe('BOUNCED');
  });
  it('REPLIED + hard -> BOUNCED upgrade (spec: highest priority wins)', () => {
    expect(applyEvent(snapIn('REPLIED'), col.hard(), ctx).state).toBe('BOUNCED');
  });
  it('REPLIED + second reply -> still REPLIED, best sentiment tracked', () => {
    let s = snapIn('REPLIED'); // reply id 20, sentiment null
    s = applyEvent(s, col.tag(20), ctx); // tag it positive
    expect(s.bestReplySentiment).toBe('positive');
    const second = buildEvent.humanReply({
      ...ids,
      id: 41,
      occurredAt: at(6),
      stepNo: 2,
      sentiment: 'negative',
    });
    s = applyEvent(s, second, ctx);
    expect(s.state).toBe('REPLIED');
    expect(s.bestReplySentiment).toBe('positive'); // best across replies
  });
  it('REPLIED + unsubscribe -> UNSUBSCRIBED ("remove me" precedence, spec Part 4)', () => {
    const s = applyEvent(snapIn('REPLIED'), col.unsub(), ctx);
    expect(s.state).toBe('UNSUBSCRIBED');
  });
  it('REPLIED + meeting_booked -> flag set, stays REPLIED', () => {
    const s = applyEvent(snapIn('REPLIED'), col.meeting(), ctx);
    expect(s.state).toBe('REPLIED');
    expect(s.meetingBooked).toBe(true);
  });

  // BOUNCED row
  it('BOUNCED + hard again -> stays BOUNCED, terminalAt unchanged', () => {
    const first = snapIn('BOUNCED');
    const s = applyEvent(first, col.hard(), ctx);
    expect(s.state).toBe('BOUNCED');
    expect(s.terminalAt).toEqual(first.terminalAt);
  });
  it('BOUNCED + human_reply -> logged but cannot downgrade (2 < 3)', () => {
    expect(applyEvent(snapIn('BOUNCED'), col.reply(), ctx).state).toBe('BOUNCED');
  });
  it('BOUNCED + unsubscribe -> UNSUBSCRIBED (4 > 3)', () => {
    expect(applyEvent(snapIn('BOUNCED'), col.unsub(), ctx).state).toBe('UNSUBSCRIBED');
  });
  it('BOUNCED + sent/soft/enrolled -> no change', () => {
    expect(applyEvent(snapIn('BOUNCED'), col.sent(), ctx).state).toBe('BOUNCED');
    expect(applyEvent(snapIn('BOUNCED'), col.soft(1), ctx).state).toBe('BOUNCED');
    expect(applyEvent(snapIn('BOUNCED'), col.enrolled(), ctx).state).toBe('BOUNCED');
  });

  // UNSUBSCRIBED row — nothing overrides it
  it('UNSUBSCRIBED + every other event -> state never changes', () => {
    const base = snapIn('UNSUBSCRIBED');
    for (const e of [col.sent(), col.soft(1), col.hard(), col.reply(), col.unsub()]) {
      expect(applyEvent(base, e, ctx).state).toBe('UNSUBSCRIBED');
    }
  });
  it('UNSUBSCRIBED + meeting/tag -> projections still update, state kept', () => {
    let s = snapIn('UNSUBSCRIBED');
    s = applyEvent(s, col.meeting(), ctx);
    expect(s.meetingBooked).toBe(true);
    expect(s.state).toBe('UNSUBSCRIBED');
  });

  // COMPLETED row — late events upgrade (all terminals outrank 1)
  it('COMPLETED + late human_reply -> REPLIED (late reply still counts)', () => {
    expect(applyEvent(snapIn('COMPLETED'), col.reply(), ctx).state).toBe('REPLIED');
  });
  it('COMPLETED + late hard bounce -> BOUNCED', () => {
    expect(applyEvent(snapIn('COMPLETED'), col.hard(), ctx).state).toBe('BOUNCED');
  });
  it('COMPLETED + late unsubscribe -> UNSUBSCRIBED', () => {
    expect(applyEvent(snapIn('COMPLETED'), col.unsub(), ctx).state).toBe('UNSUBSCRIBED');
  });
  it('COMPLETED + sent -> no change', () => {
    expect(applyEvent(snapIn('COMPLETED'), col.sent(), ctx).state).toBe('COMPLETED');
  });
});

describe('sentiment resolution (decision M)', () => {
  it('auto-negative from STOP detection, then human retag to neutral -> neutral wins', () => {
    let s = snapIn('ACTIVE');
    const stopReply = buildEvent.humanReply({
      ...ids,
      id: 50,
      occurredAt: at(5),
      stepNo: 1,
      sentiment: 'negative', // known at insert (STOP match)
    });
    s = applyEvent(s, stopReply, ctx);
    expect(s.bestReplySentiment).toBe('negative');
    s = applyEvent(
      s,
      buildEvent.sentimentTagged({
        ...ids,
        occurredAt: at(6),
        sentiment: 'neutral',
        attributes: { reply_event_id: 50, tagged_by: 'human' },
      }),
      ctx,
    );
    expect(s.bestReplySentiment).toBe('neutral'); // latest tag wins for that reply
  });

  it('retagging one of several replies keeps the best across all', () => {
    let s = snapIn('ACTIVE');
    s = applyEvent(
      s,
      buildEvent.humanReply({ ...ids, id: 60, occurredAt: at(5), sentiment: 'positive' }),
      ctx,
    );
    s = applyEvent(
      s,
      buildEvent.humanReply({ ...ids, id: 61, occurredAt: at(6), sentiment: 'negative' }),
      ctx,
    );
    expect(s.bestReplySentiment).toBe('positive');
    // retag the positive one down to neutral -> best becomes neutral
    s = applyEvent(
      s,
      buildEvent.sentimentTagged({
        ...ids,
        occurredAt: at(7),
        sentiment: 'neutral',
        attributes: { reply_event_id: 60, tagged_by: 'human' },
      }),
      ctx,
    );
    expect(s.bestReplySentiment).toBe('neutral');
  });
});

describe('derived completion (docs/04 §2.1)', () => {
  const confirmMs = 6 * 3_600_000;

  function activePastLastStep(): EnrollmentSnapshot {
    const evs: DomainEvent[] = [
      buildEvent.enrolled({ ...ids, occurredAt: at(0) }),
      ...[1, 2, 3, 4].map((n) =>
        buildEvent.sent({
          ...ids,
          id: 70 + n,
          occurredAt: at(n),
          stepNo: n,
          mailboxId: 1,
          messageId: `<c${n}@x>`,
          attributes: { content_hash: `h${n}` },
        }),
      ),
    ];
    return foldEvents(evs, ctx);
  }

  it('completes only after the confirm window past the final send', () => {
    const s = activePastLastStep();
    const lastSentAt = at(4);
    expect(s.currentStepNo).toBe(5);
    expect(shouldComplete(s, ctx, lastSentAt, at(10), confirmMs)).toBe(false); // too soon
    const later = new Date(lastSentAt.getTime() + confirmMs);
    expect(shouldComplete(s, ctx, lastSentAt, later, confirmMs)).toBe(true);
    expect(completeSnapshot(s, later).state).toBe('COMPLETED');
  });

  it('never completes mid-sequence or from terminal states', () => {
    const mid = snapIn('ACTIVE'); // step 2 of 4
    expect(shouldComplete(mid, ctx, at(1), at(30), confirmMs)).toBe(false);
    expect(shouldComplete(snapIn('REPLIED'), ctx, at(1), at(30), confirmMs)).toBe(false);
  });
});

describe('fold determinism', () => {
  it('folding is pure — same events, same result, inputs untouched', () => {
    const evs = [
      buildEvent.enrolled({ ...ids, occurredAt: at(0) }),
      buildEvent.sent({
        ...ids,
        id: 80,
        occurredAt: at(1),
        stepNo: 1,
        mailboxId: 1,
        messageId: '<d1@x>',
        attributes: { content_hash: 'h1' },
      }),
      buildEvent.humanReply({ ...ids, id: 81, occurredAt: at(2), stepNo: 1 }),
      buildEvent.unsubscribe({ ...ids, occurredAt: at(3), source: 'reply' }),
    ];
    const a = foldEvents(evs, ctx);
    const b = foldEvents(evs, ctx);
    expect(a).toEqual(b);
    expect(a.state).toBe('UNSUBSCRIBED');
    expect(a.terminalAt).toEqual(at(2)); // first terminal entry (REPLIED) time kept
  });
});
