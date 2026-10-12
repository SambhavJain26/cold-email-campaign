// Pure sequence vocabulary (B3): the in-memory shape the scheduler consumes.
// Until B4 lands the sequences tables (0003), a SequenceProvider serves these
// from scenario/static config; B4 swaps in a DB-backed provider — the
// scheduler never knows the difference.
import type { SequenceShape } from './reducer';

export interface VariantDef {
  id: number;
  label: string; // 'A','B',…
  /** sha256(subject_template + '\0' + body_template) — decision Q. */
  contentHash: string;
  subjectTemplate: string; // docs/08 §2 grammar; rendered by render/engine
  bodyTemplate: string; // footer NOT included (appended at render, docs/08 §4)
}

export interface SequenceStepDef {
  id?: number;
  stepNo: number; // 1-based
  waitDays: number; // days after the previous step's send (step 1: 0)
  inThread: boolean; // carries In-Reply-To/References (docs/07 §4)
  contentSource?: 'template' | 'personalized';
  variants: VariantDef[]; // active variants only
}

export interface SequenceDef {
  id: number;
  waitDayMode?: 'elapsed_days' | 'business_days';
  /** Omitted only by legacy/static providers; those retain the safe default. */
  stopOnReply?: boolean;
  steps: SequenceStepDef[]; // ordered by stepNo
}

export function stepOf(seq: SequenceDef, stepNo: number): SequenceStepDef | undefined {
  return seq.steps.find((s) => s.stepNo === stepNo);
}

/** Nearest preceding step that started the conversation containing `stepNo`. */
export function conversationRootStepNo(seq: SequenceDef, stepNo: number): number | undefined {
  return seq.steps
    .filter((step) => step.stepNo < stepNo && !step.inThread)
    .sort((a, b) => b.stepNo - a.stepNo)[0]?.stepNo;
}

export function lastStepNo(seq: SequenceDef): number {
  return seq.steps.at(-1)?.stepNo ?? 0;
}

export function shapeOf(seq: SequenceDef, softRetryMax: number): SequenceShape {
  return { lastStepNo: lastStepNo(seq), softRetryMax, stopOnReply: seq.stopOnReply ?? true };
}

/** Every active content hash in the sequence — the recycle guard's needle set (decision Q). */
export function allContentHashes(seq: SequenceDef): string[] {
  return seq.steps.flatMap((s) => s.variants.map((v) => v.contentHash));
}
