// The golden cohort's locked composition (spec Part 10 + walkthrough §13),
// with the integer reconciliations documented below. These numbers are the
// assertion targets for the @golden suites at all three levels (docs/13 §3).
//
// Reconciliations (spec Part 10 wins over illustrative walkthrough screens):
// - Tiers at enrollment: A 260 / B 455 / C 170 = 885. (The walkthrough's
//   Stage-2 panel shows C=120 + 50 nurture, but Part 10 enrolls all 885 and
//   §13c's contacted-by-tier sums 255+447+165 = 867 — so enrolled C must be
//   170 and nurture is not part of this cohort.)
// - Repliers by tier: A 33 / B 31 / C 8 = 72 (closest integers to §13c's
//   illustrative 13.0/7.0/3.5% that keep the Part-10 total of 72).
// - Delivered per step: 867/831/801/789 — derived honestly from the exit
//   model (72 repliers + 15 link-unsubs spread across steps). §13b's
//   867/612/540/498 cannot reconcile with 780 COMPLETED-all-steps and is
//   treated as illustrative. §13b's positives-per-step 15/9/1/3 (sum 28) IS
//   load-bearing and is kept exactly.

export const GOLDEN = {
  campaignId: 1,
  totalLeads: 885,
  mailboxes: 4,
  base: '2026-01-05T13:00:00.000Z', // Monday
  endOfCampaign: '2026-03-01T00:00:00.000Z',
  /** cumulative day offsets of steps 1..4 (waits 0/3/4/5) */
  stepDayOffsets: [0, 3, 7, 12],
  enrollPerDay: 30,
  shape: { lastStepNo: 4, softRetryMax: 2 },
  deliveryConfirmMs: 6 * 3_600_000,

  // ── deterministic id layout ────────────────────────────────────────────────
  tiers: {
    A: { from: 1, to: 260 },
    B: { from: 261, to: 715 },
    C: { from: 716, to: 885 },
  },
  hardBounceIds: [
    ...range(256, 260), // A ×5
    ...range(708, 715), // B ×8
    ...range(881, 885), // C ×5
  ],
  repliers: {
    positive: {
      A: range(1, 17),
      B: range(261, 268),
      C: range(716, 718),
    },
    neutral: {
      A: range(18, 26),
      B: range(269, 276),
      C: range(719, 720),
    },
    negative: {
      A: range(27, 33),
      B: range(277, 291),
      C: range(721, 723),
    },
  },
  meetingIds: [...range(1, 13), ...range(261, 263), 716], // 17 ⊆ positives
  linkUnsubIds: [...range(34, 36), ...range(292, 300), ...range(724, 726)], // 15 non-repliers
  softRecoverIds: range(301, 309), // 9 completers with one soft bounce at step 2
  softBounceStep: 2,

  // ── expected outcomes (the assertions) ─────────────────────────────────────
  expected: {
    terminals: { UNSUBSCRIBED: 40, BOUNCED: 18, REPLIED: 47, COMPLETED: 780 },
    contacted: 867,
    distinctRepliers: 72,
    sentiments: { positive: 28, neutral: 19, negative: 25 },
    unsubscribes: { total: 40, viaReply: 25, viaLink: 15 },
    meetings: 17,
    hardBounces: 18,
    softBounces: 9,
    suppressedLeads: 58, // 40 unsub + 18 hard bounce
    deliveredPerStep: [867, 831, 801, 789],
    positivesPerStep: [15, 9, 1, 3],
    perTier: {
      A: { enrolled: 260, contacted: 255, repliers: 33, positives: 17, meetings: 13 },
      B: { enrolled: 455, contacted: 447, repliers: 31, positives: 8, meetings: 3 },
      C: { enrolled: 170, contacted: 165, repliers: 8, positives: 3, meetings: 1 },
    },
  },
} as const;

export type GoldenTier = 'A' | 'B' | 'C';

export function tierOf(leadId: number): GoldenTier {
  if (leadId <= GOLDEN.tiers.A.to) return 'A';
  if (leadId <= GOLDEN.tiers.B.to) return 'B';
  return 'C';
}

export function personalizationModeOf(leadId: number) {
  const t = tierOf(leadId);
  return t === 'A' ? 'human_written' : t === 'B' ? 'template_researched' : 'template_auto';
}

/** Step assignment for every replier (docs above; satisfies both margins). */
export function replierStep(leadId: number): number {
  const inR = (from: number, to: number) => leadId >= from && leadId <= to;
  // positives: 15 -> s1, 9 -> s2, 1 -> s3, 3 -> s4
  if (inR(1, 15)) return 1;
  if (inR(16, 17) || inR(261, 267)) return 2;
  if (leadId === 268) return 3;
  if (inR(716, 718)) return 4;
  // neutrals + negatives: 15 -> s1, 16 -> s2, 9 -> s3, 4 -> s4
  if (inR(18, 26) || inR(269, 274)) return 1;
  if (inR(275, 276) || inR(719, 720) || inR(27, 33) || inR(277, 281)) return 2;
  if (inR(282, 290)) return 3;
  if (leadId === 291 || inR(721, 723)) return 4;
  throw new Error(`replierStep: ${leadId} is not a replier`);
}

/** Which step a link-unsubscriber received last before opting out. */
export function linkUnsubStep(leadId: number): number {
  if ([34, 35, 36, 292, 293, 294].includes(leadId)) return 1;
  if ([295, 296, 297, 298, 299].includes(leadId)) return 2;
  if ([300, 724].includes(leadId)) return 3;
  if ([725, 726].includes(leadId)) return 4;
  throw new Error(`linkUnsubStep: ${leadId} is not a link unsubscriber`);
}

export function sentimentOf(leadId: number): 'positive' | 'neutral' | 'negative' | null {
  const r = GOLDEN.repliers;
  for (const s of ['positive', 'neutral', 'negative'] as const) {
    for (const t of ['A', 'B', 'C'] as const) {
      if ((r[s][t] as readonly number[]).includes(leadId)) return s;
    }
  }
  return null;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
