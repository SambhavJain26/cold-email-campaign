// Spam-trigger lexicon (docs/08 §5 check #9, decision W: rubric is DATA —
// edit this file, not checks.ts, to tune). Phrases match case-insensitively
// against subject + body; each matched phrase = one hit. Two structural
// rules live alongside: more than ALL_CAPS_MAX all-caps words, and more than
// EXCLAMATION_MAX exclamation marks, are one hit each.

export const SPAM_PHRASES: string[] = [
  'free!!!',
  'guarantee',
  'act now',
  'risk-free',
  '100% free',
  'click here',
];

/** Words of ≥3 uppercase letters count as ALL-CAPS (2-letter acronyms like "US" don't). */
export const ALL_CAPS_PATTERN = /\b[A-Z]{3,}\b/g;
export const ALL_CAPS_MAX = 2;

export const EXCLAMATION_MAX = 1;
