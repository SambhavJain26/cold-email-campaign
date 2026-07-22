// The golden cohort as a LIVE scenario (docs/13 §2 golden/scenario.ts):
// the same 885-lead composition as events.jsonl, but expressed as scripted
// transport outcomes + inbound traffic and driven through the REAL scheduler
// + poller over the VirtualClock (golden level 3, docs/13 §3).
import type { SequenceDef } from '../../../src/domain/sequence';
import type { Scenario, LeadRef } from '../../helpers/scenario';
import { GOLDEN, linkUnsubStep, replierStep, sentimentOf } from './constants';

/** The walkthrough's 4-step sequence (waits 0/3/4/5), one variant per step,
 *  content hashes matching the fixture's (`sha-stepN`) - the renderer ECHOES
 *  the hash (decision Q: computed at save time), so real templates here don't
 *  disturb events.jsonl parity. Templates are fatal-free for the golden leads
 *  (no first_name/company/state → every tag falls back; no URLs in step 1;
 *  no {{custom_observation}} - the harness seeds no segment rules). */
const goldenBody = (stepNo: number): string =>
  `Hi {{first_name|there}},\n\nStep ${stepNo} of the walkthrough sequence - checking in on ` +
  'your listings pipeline and whether a quick chat makes sense this week.\n\nBest,\nSam';

export const GOLDEN_SEQUENCE: SequenceDef = {
  id: 1,
  steps: [0, 3, 4, 5].map((waitDays, idx) => ({
    stepNo: idx + 1,
    waitDays,
    inThread: idx > 0,
    variants: [
      {
        id: idx + 1,
        label: 'A',
        contentHash: `sha-step${idx + 1}`,
        subjectTemplate: 'Quick question about {{company|your listings}}',
        bodyTemplate: goldenBody(idx + 1),
      },
    ],
  })),
};

export const ref = (i: number): LeadRef => `L${i}`;

const REPLY_TEXTS = {
  positive: 'Yeah, we actually have this exact problem. What does your turnaround look like?',
  neutral: 'Can you send over some more information and pricing?',
  // Auto-STOP path (decision F): matches the fixture's matched_keyword.
  negative: 'Remove me.',
} as const;

/**
 * Script every non-default outcome. Everyone not scripted here simply
 * receives all 4 steps and completes - exactly the fixture's remainder.
 */
export function scriptGoldenCohort(s: Scenario): void {
  for (const i of GOLDEN.hardBounceIds) {
    s.onSend(ref(i), { outcome: 'hard_bounce', dsn: '5.1.1' });
  }
  for (const i of GOLDEN.softRecoverIds) {
    s.onSend(ref(i), {
      outcome: 'soft_bounce_then_deliver',
      retries: 1,
      dsn: '4.2.2',
      atStep: GOLDEN.softBounceStep,
    });
  }
  for (let i = 1; i <= GOLDEN.totalLeads; i++) {
    const sentiment = sentimentOf(i);
    if (sentiment !== null) {
      s.replyAfter(ref(i), {
        days: 1,
        text: REPLY_TEXTS[sentiment],
        afterStep: replierStep(i),
      });
    }
  }
  for (const i of GOLDEN.linkUnsubIds) {
    // sent + 6h delivered + ~a day: before the next step's 3-5 day wait.
    s.linkUnsubAfter(ref(i), { days: 1.25, afterStep: linkUnsubStep(i) });
  }
}

/** The operator's Unibox pass: tag positive/neutral replies, book meetings. */
export async function runGoldenOperatorActions(s: Scenario): Promise<void> {
  for (const sentiment of ['positive', 'neutral'] as const) {
    for (const tier of ['A', 'B', 'C'] as const) {
      for (const i of GOLDEN.repliers[sentiment][tier]) {
        await s.tagSentiment(ref(i), sentiment);
      }
    }
  }
  for (const i of GOLDEN.meetingIds) {
    await s.bookMeeting(ref(i));
  }
}
