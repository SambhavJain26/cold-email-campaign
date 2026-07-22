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
  stepNo: number; // 1-based
  waitDays: number; // days after the previous step's send (step 1: 0)
  inThread: boolean; // carries In-Reply-To/References (docs/07 §4)
  variants: VariantDef[]; // active variants only
}

export interface SequenceDef {
  id: number;
  steps: SequenceStepDef[]; // ordered by stepNo
}

export function stepOf(seq: SequenceDef, stepNo: number): SequenceStepDef | undefined {
  return seq.steps.find((s) => s.stepNo === stepNo);
}

export function lastStepNo(seq: SequenceDef): number {
  return seq.steps.at(-1)?.stepNo ?? 0;
}

export function shapeOf(seq: SequenceDef, softRetryMax: number): SequenceShape {
  return { lastStepNo: lastStepNo(seq), softRetryMax };
}

/** Every active content hash in the sequence — the recycle guard's needle set (decision Q). */
export function allContentHashes(seq: SequenceDef): string[] {
  return seq.steps.flatMap((s) => s.variants.map((v) => v.contentHash));
}
