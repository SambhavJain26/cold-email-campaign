// F4.2 — the builder's editable draft. Pure helpers (no React) so the
// replace-set mapping stays unit-testable: step_no is POSITIONAL in the
// builder and only materialises at save time (index + 1), which is what makes
// "remove step 3" behave like the walkthrough's card list.
//
// Retired variants (active:false) are carried through every save. Omitting
// them would DELETE them at zero sends (the save is a literal replace-set
// then) — they are only ever retired, never dropped, by the builder.
import type { SequenceDto, SequenceWriteBody } from '@coldemail/shared';

export interface DraftVariant {
  /** Client identity — stable across renders for React keys and tab state. */
  uid: string;
  /** Server id; absent on rows the operator just added. */
  id?: number;
  label: string;
  subject_template: string;
  body_template: string;
  active: boolean;
}

export interface DraftStep {
  uid: string;
  id?: number;
  wait_days: number;
  in_thread: boolean;
  content_source: 'template' | 'personalized';
  variants: DraftVariant[];
}

export interface SequenceDraft {
  name: string;
  stop_on_reply: true;
  variable_defaults: Record<string, string>;
  steps: DraftStep[];
}

let uidCounter = 0;
export function draftUid(prefix = 'd'): string {
  uidCounter += 1;
  return `${prefix}${uidCounter}`;
}

export function draftFromSequence(sequence: SequenceDto): SequenceDraft {
  return {
    name: sequence.name,
    stop_on_reply: true,
    variable_defaults: sequence.variable_defaults,
    steps: [...sequence.steps]
      .sort((a, b) => a.step_no - b.step_no)
      .map((step) => ({
        uid: draftUid('s'),
        id: step.id,
        wait_days: step.wait_days,
        in_thread: step.in_thread,
        content_source: step.content_source,
        variants: step.variants.map((variant) => ({
          uid: draftUid('v'),
          id: variant.id,
          label: variant.label,
          subject_template: variant.subject_template,
          body_template: variant.body_template,
          active: variant.active,
        })),
      })),
  };
}

export function blankVariant(label: string): DraftVariant {
  return { uid: draftUid('v'), label, subject_template: '', body_template: '', active: true };
}

export function blankStep(inThread: boolean, waitDays: number): DraftStep {
  return {
    uid: draftUid('s'),
    wait_days: waitDays,
    in_thread: inThread,
    content_source: 'template',
    variants: [blankVariant('A')],
  };
}

export function blankDraft(): SequenceDraft {
  return {
    name: '',
    stop_on_reply: true,
    variable_defaults: {},
    steps: [blankStep(false, 0)],
  };
}

/** A → B → C …; skips labels already taken (incl. retired variants). */
export function nextVariantLabel(variants: DraftVariant[]): string {
  const taken = new Set(variants.map((v) => v.label));
  for (let i = 0; i < 26; i += 1) {
    const label = String.fromCharCode(65 + i);
    if (!taken.has(label)) return label;
  }
  return `V${variants.length + 1}`;
}

/** Draft → the contract's write body. step_no comes from position (docs/10 §Sequences). */
export function toWriteBody(draft: SequenceDraft): SequenceWriteBody {
  return {
    name: draft.name.trim(),
    stop_on_reply: true,
    variable_defaults: draft.variable_defaults,
    steps: draft.steps.map((step, index) => ({
      ...(step.id === undefined ? {} : { id: step.id }),
      step_no: index + 1,
      wait_days: step.wait_days,
      in_thread: step.in_thread,
      content_source: step.content_source,
      variants: step.variants.map((variant) => ({
        ...(variant.id === undefined ? {} : { id: variant.id }),
        label: variant.label,
        subject_template: variant.subject_template,
        body_template: variant.body_template,
        active: variant.active,
      })),
    })),
  };
}

/** Compare the effective save payload, not transient React uids or edit history.
 * Variable keys are sorted so changing their insertion order alone is not dirty. */
export function draftsEqual(left: SequenceDraft, right: SequenceDraft): boolean {
  const canonical = (draft: SequenceDraft) => {
    const body = toWriteBody(draft);
    return {
      ...body,
      variable_defaults: Object.fromEntries(
        Object.entries(body.variable_defaults).sort(([a], [b]) => a.localeCompare(b)),
      ),
    };
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

/** Local pre-save guard — the write schema's min(1)s, stated in operator words. */
export function draftBlockers(draft: SequenceDraft): string[] {
  const blockers: string[] = [];
  if (draft.name.trim() === '') blockers.push('Sequence needs a name');
  if (draft.steps.length === 0) blockers.push('Sequence needs at least one step');
  for (const [key] of Object.entries(draft.variable_defaults)) {
    if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      blockers.push(`Variable key "${key}" must use lowercase letters, numbers, and underscores`);
    }
  }
  draft.steps.forEach((step, index) => {
    const stepNo = index + 1;
    if (step.content_source === 'template' && step.variants.length === 0)
      blockers.push(`Step ${stepNo} needs at least one variant`);
    if (step.content_source === 'personalized' && step.variants.length > 0)
      blockers.push(`Step ${stepNo} personalized copy cannot have variants`);
    if (step.content_source === 'personalized') return;
    step.variants.forEach((variant) => {
      if (variant.subject_template.trim() === '')
        blockers.push(`Step ${stepNo} · variant ${variant.label}: subject is empty`);
      if (variant.body_template.trim() === '')
        blockers.push(`Step ${stepNo} · variant ${variant.label}: body is empty`);
    });
  });
  return blockers;
}

/** 422 `sequence_invalid` details.errors — mapped to the offending step/variant tab. */
export interface SaveFieldError {
  step_no: number;
  label: string;
  field: string;
  message: string;
}

export function saveErrorKey(stepNo: number, label: string, field: string): string {
  return `${stepNo}:${label}:${field}`;
}

/** Narrows the error envelope's `details` without trusting its shape. */
export function parseSaveErrors(details: unknown): {
  errors: SaveFieldError[];
  conflicts: string[];
} {
  const record = (details ?? {}) as { errors?: unknown; conflicts?: unknown };
  const errors: SaveFieldError[] = Array.isArray(record.errors)
    ? record.errors.flatMap((raw) => {
        const e = raw as Partial<SaveFieldError>;
        return typeof e.step_no === 'number' &&
          typeof e.label === 'string' &&
          typeof e.field === 'string' &&
          typeof e.message === 'string'
          ? [{ step_no: e.step_no, label: e.label, field: e.field, message: e.message }]
          : [];
      })
    : [];
  const conflicts: string[] = Array.isArray(record.conflicts)
    ? record.conflicts.filter((c): c is string => typeof c === 'string')
    : [];
  return { errors, conflicts };
}
