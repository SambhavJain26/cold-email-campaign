// @golden L1 (pure fold): the committed 885-lead fixture reproduces spec
// Part 10 exactly when folded through the reducer. If this goes red, the
// math stopped closing - that is the signal, not noise (docs/13 §3).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  completeSnapshot,
  foldEvents,
  shouldComplete,
  type EnrollmentSnapshot,
} from '../../src/domain/reducer';
import type { DomainEvent } from '../../src/domain/events';
import { GOLDEN, tierOf } from '../fixtures/golden/constants';
import { buildGoldenEvents, serializeGoldenEvents } from '../fixtures/golden/generate';
import { GOLDEN_JSONL, loadGoldenEvents } from '../fixtures/golden/load';

function foldAll(events: DomainEvent[]): Map<number, EnrollmentSnapshot> {
  const byEnrollment = new Map<number, DomainEvent[]>();
  for (const e of events) {
    const eid = 'enrollmentId' in e ? e.enrollmentId : undefined;
    if (eid === undefined) continue;
    const list = byEnrollment.get(eid);
    if (list) list.push(e);
    else byEnrollment.set(eid, [e]);
  }
  const end = new Date(GOLDEN.endOfCampaign);
  const out = new Map<number, EnrollmentSnapshot>();
  for (const [eid, evs] of byEnrollment) {
    let s = foldEvents(evs, GOLDEN.shape);
    const lastSentAt = evs.filter((e) => e.type === 'sent').at(-1)?.occurredAt ?? null;
    if (shouldComplete(s, GOLDEN.shape, lastSentAt, end, GOLDEN.deliveryConfirmMs)) {
      s = completeSnapshot(s, new Date(lastSentAt!.getTime() + GOLDEN.deliveryConfirmMs));
    }
    out.set(eid, s);
  }
  return out;
}

describe('@golden L1 - raw events fold to spec Part 10', () => {
  const events = loadGoldenEvents();
  const snapshots = foldAll(events);
  const x = GOLDEN.expected;

  it('fixture determinism: regenerating reproduces the committed file byte-for-byte', () => {
    expect(serializeGoldenEvents(buildGoldenEvents())).toBe(readFileSync(GOLDEN_JSONL, 'utf8'));
  });

  it('terminal outcomes are 40 / 18 / 47 / 780 and sum to 885', () => {
    const counts: Record<string, number> = {};
    for (const s of snapshots.values()) counts[s.state] = (counts[s.state] ?? 0) + 1;
    expect(counts).toEqual(x.terminals);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(885);
    // mutual exclusivity: no ACTIVE/NEW left at campaign end
    expect(counts.ACTIVE).toBeUndefined();
    expect(counts.NEW).toBeUndefined();
  });

  it('72 distinct repliers; effective sentiments 28 / 19 / 25', () => {
    const repliers = new Set(events.filter((e) => e.type === 'human_reply').map((e) => e.leadId));
    expect(repliers.size).toBe(x.distinctRepliers);
    const best: Record<string, number> = { positive: 0, neutral: 0, negative: 0 };
    for (const s of snapshots.values()) if (s.bestReplySentiment) best[s.bestReplySentiment]! += 1;
    expect(best).toEqual(x.sentiments);
  });

  it('REPLIED (47) = positive (28) + neutral (19); negatives all ended UNSUBSCRIBED', () => {
    let repliedPos = 0;
    let repliedNeu = 0;
    for (const s of snapshots.values()) {
      if (s.state === 'REPLIED' && s.bestReplySentiment === 'positive') repliedPos += 1;
      if (s.state === 'REPLIED' && s.bestReplySentiment === 'neutral') repliedNeu += 1;
    }
    expect(repliedPos).toBe(28);
    expect(repliedNeu).toBe(19);
  });

  it('40 unsubscribes: 25 via reply + 15 via link', () => {
    const unsubs = events.filter((e) => e.type === 'unsubscribe');
    expect(unsubs).toHaveLength(x.unsubscribes.total);
    expect(unsubs.filter((e) => e.type === 'unsubscribe' && e.source === 'reply')).toHaveLength(25);
    expect(unsubs.filter((e) => e.type === 'unsubscribe' && e.source === 'link')).toHaveLength(15);
  });

  it('17 meetings, all on positive repliers, none changing state', () => {
    let meetings = 0;
    for (const s of snapshots.values()) {
      if (s.meetingBooked) {
        meetings += 1;
        expect(s.state).toBe('REPLIED');
        expect(s.bestReplySentiment).toBe('positive');
      }
    }
    expect(meetings).toBe(x.meetings);
  });

  it('contacted = 867 (delivered ≥1), bounce counts 18 hard / 9 soft', () => {
    const contacted = new Set(events.filter((e) => e.type === 'delivered').map((e) => e.leadId));
    expect(contacted.size).toBe(x.contacted);
    expect(events.filter((e) => e.type === 'hard_bounce')).toHaveLength(x.hardBounces);
    expect(events.filter((e) => e.type === 'soft_bounce')).toHaveLength(x.softBounces);
  });

  it('delivered per step 867/831/801/789; positives per step 15/9/1/3 (sums to 28)', () => {
    const deliveredPerStep = [1, 2, 3, 4].map(
      (n) =>
        new Set(events.filter((e) => e.type === 'delivered' && e.stepNo === n).map((e) => e.leadId))
          .size,
    );
    expect(deliveredPerStep).toEqual([...x.deliveredPerStep]);

    const posByStep = [0, 0, 0, 0];
    for (const [eid, s] of snapshots) {
      if (s.bestReplySentiment !== 'positive') continue;
      const reply = events.find((e) => e.type === 'human_reply' && e.leadId === eid);
      posByStep[(reply!.type === 'human_reply' ? reply.stepNo! : 0) - 1]! += 1;
    }
    expect(posByStep).toEqual([...x.positivesPerStep]);
    expect(posByStep.reduce((a, b) => a + b, 0)).toBe(28);
  });

  it('per-tier composition matches (contacted / repliers / positives / meetings)', () => {
    const perTier: Record<
      string,
      { contacted: number; repliers: number; positives: number; meetings: number }
    > = { A: zero(), B: zero(), C: zero() };
    const contacted = new Set(events.filter((e) => e.type === 'delivered').map((e) => e.leadId));
    const replierLeads = new Set(
      events.filter((e) => e.type === 'human_reply').map((e) => e.leadId),
    );
    for (const leadId of contacted) perTier[tierOf(leadId)]!.contacted += 1;
    for (const leadId of replierLeads) perTier[tierOf(leadId)]!.repliers += 1;
    for (const [eid, s] of snapshots) {
      if (s.bestReplySentiment === 'positive') perTier[tierOf(eid)]!.positives += 1;
      if (s.meetingBooked) perTier[tierOf(eid)]!.meetings += 1;
    }
    for (const t of ['A', 'B', 'C'] as const) {
      const want = GOLDEN.expected.perTier[t];
      expect(perTier[t], `tier ${t}`).toEqual({
        contacted: want.contacted,
        repliers: want.repliers,
        positives: want.positives,
        meetings: want.meetings,
      });
    }
    function zero() {
      return { contacted: 0, repliers: 0, positives: 0, meetings: 0 };
    }
  });
});
