// F4 — builder unit coverage: the draft ⇔ contract mapping (replace-set,
// positional step_no, retired variants) and the footer split the preview panel
// relies on.
import { describe, expect, it } from 'vitest';
import type { SequenceDto } from '@coldemail/shared';
import {
  blankDraft,
  draftBlockers,
  draftFromSequence,
  nextVariantLabel,
  parseSaveErrors,
  toWriteBody,
} from './draft';
import { splitFooter } from './preview-panel';

const sequence: SequenceDto = {
  id: 7,
  name: 'Real Estate Outreach v2',
  stop_on_reply: true,
  stop_on_hard_bounce: true,
  stop_on_unsubscribe: false,
  variable_defaults: {},
  steps: [
    {
      id: 20,
      step_no: 2,
      wait_days: 3,
      in_thread: true,
      variants: [
        { id: 31, label: 'A', subject_template: '(re)', body_template: 'bump', active: true },
      ],
    },
    {
      id: 10,
      step_no: 1,
      wait_days: 0,
      in_thread: false,
      variants: [
        {
          id: 11,
          label: 'A',
          subject_template: 'Hi {{company}}',
          body_template: 'A',
          active: true,
        },
        { id: 12, label: 'B', subject_template: 'Hey', body_template: 'B', active: false },
      ],
    },
  ],
};

describe('draftFromSequence / toWriteBody', () => {
  it('orders steps by step_no and round-trips ids', () => {
    const draft = draftFromSequence(sequence);
    expect(draft.steps.map((s) => s.id)).toEqual([10, 20]);

    const body = toWriteBody(draft);
    expect(body.steps.map((s) => [s.id, s.step_no])).toEqual([
      [10, 1],
      [20, 2],
    ]);
    expect(body.stop_on_reply).toBe(true);
  });

  it('carries retired variants through the save — dropping them would DELETE at zero sends', () => {
    const body = toWriteBody(draftFromSequence(sequence));
    const step1 = body.steps[0]!;
    expect(step1.variants.map((v) => [v.label, v.active])).toEqual([
      ['A', true],
      ['B', false],
    ]);
  });

  it('renumbers step_no positionally when a middle step is removed', () => {
    const draft = draftFromSequence(sequence);
    const withoutFirst = { ...draft, steps: draft.steps.filter((s) => s.id !== 10) };
    const body = toWriteBody(withoutFirst);
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0]!.step_no).toBe(1); // was step 2 — the builder is positional
    expect(body.steps[0]!.id).toBe(20);
  });

  it('omits `id` for rows the operator just added', () => {
    const body = toWriteBody(blankDraft());
    expect(body.steps[0]).not.toHaveProperty('id');
    expect(body.steps[0]!.variants[0]).not.toHaveProperty('id');
  });
});

describe('nextVariantLabel', () => {
  it('skips labels already taken, including retired ones', () => {
    const draft = draftFromSequence(sequence);
    expect(nextVariantLabel(draft.steps[0]!.variants)).toBe('C');
    expect(nextVariantLabel(draft.steps[1]!.variants)).toBe('B');
  });
});

describe('draftBlockers', () => {
  it('states the write-schema minimums in operator words', () => {
    expect(draftBlockers(blankDraft())).toEqual([
      'Sequence needs a name',
      'Step 1 · variant A: subject is empty',
      'Step 1 · variant A: body is empty',
    ]);
  });

  it('is empty for a complete draft', () => {
    expect(draftBlockers(draftFromSequence(sequence))).toEqual([]);
  });
});

describe('parseSaveErrors', () => {
  it('narrows the 422 details without trusting the shape', () => {
    expect(
      parseSaveErrors({
        errors: [
          { step_no: 1, label: 'A', field: 'body_template', message: 'unclosed merge tag' },
          { step_no: 'nope' },
        ],
        conflicts: ['step 3 has sends', 42],
      }),
    ).toEqual({
      errors: [{ step_no: 1, label: 'A', field: 'body_template', message: 'unclosed merge tag' }],
      conflicts: ['step 3 has sends'],
    });
    expect(parseSaveErrors(undefined)).toEqual({ errors: [], conflicts: [] });
  });
});

describe('splitFooter', () => {
  it('splits the engine-appended CAN-SPAM footer off the body', () => {
    const body = 'Hi Mike,\n\nWorth a chat?\n\n4517 Congress Ave\nReply "stop".';
    expect(splitFooter(body)).toEqual({
      body: 'Hi Mike,\n\nWorth a chat?',
      footer: '4517 Congress Ave\nReply "stop".',
    });
  });

  it('returns a null footer when the separator is absent', () => {
    expect(splitFooter('no footer here')).toEqual({ body: 'no footer here', footer: null });
  });
});
