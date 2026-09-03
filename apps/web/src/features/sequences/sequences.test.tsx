// F4 — builder unit coverage: the draft ⇔ contract mapping (replace-set,
// positional step_no, retired variants) and the footer split the preview panel
// relies on.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SequenceDto } from '@coldemail/shared';
import {
  blankDraft,
  draftBlockers,
  draftFromSequence,
  draftsEqual,
  nextVariantLabel,
  parseSaveErrors,
  toWriteBody,
} from './draft';
import { footerPreviewParts, previewRequirement, splitFooter } from './preview-panel';
import { StepCard } from './step-card';

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
      content_source: 'template',
      variants: [
        { id: 31, label: 'A', subject_template: '(re)', body_template: 'bump', active: true },
      ],
    },
    {
      id: 10,
      step_no: 1,
      wait_days: 0,
      in_thread: false,
      content_source: 'template',
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

  it('compares the effective save payload and clears a reverted edit', () => {
    const saved = draftFromSequence(sequence);
    const changed = {
      ...saved,
      steps: saved.steps.map((step, index) => (index === 1 ? { ...step, in_thread: false } : step)),
    };
    const reverted = {
      ...changed,
      steps: changed.steps.map((step, index) =>
        index === 1 ? { ...step, in_thread: true } : step,
      ),
    };

    expect(draftsEqual(saved, changed)).toBe(false);
    expect(draftsEqual(saved, reverted)).toBe(true);
    expect(
      draftsEqual(saved, {
        ...saved,
        variable_defaults: { zed: 'last', alpha: 'first' },
      }),
    ).toBe(false);
    expect(
      draftsEqual(
        { ...saved, variable_defaults: { alpha: 'first', zed: 'last' } },
        { ...saved, variable_defaults: { zed: 'last', alpha: 'first' } },
      ),
    ).toBe(true);
  });
});

describe('preview guidance', () => {
  it('asks for a lead after a personalized campaign context is selected', () => {
    expect(previewRequirement({ stepNo: 3, variant: null }, 7, null)).toBe(
      'Pick a lead to render against.',
    );
  });

  it('reserves the unsaved message for a genuinely new template variant', () => {
    expect(
      previewRequirement(
        {
          stepNo: 1,
          variant: {
            uid: 'new',
            label: 'B',
            subject_template: 'Subject',
            body_template: 'Body',
            active: true,
          },
        },
        null,
        null,
      ),
    ).toBe('This variant is new — save the sequence before previewing it.');
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

describe('footerPreviewParts', () => {
  it('shows the live capability URL as a conventional link label', () => {
    expect(
      footerPreviewParts(
        'Unsubscribe: https://unsubscribe.example/u/private-token\n4517 Congress Ave',
      ),
    ).toEqual({ optout: 'Unsubscribe', address: '4517 Congress Ave', linked: true });
  });

  it('keeps dormant opt-out wording and multiline addresses visible', () => {
    expect(footerPreviewParts('Reply STOP.\n4517 Congress Ave\nAustin, TX')).toEqual({
      optout: 'Reply STOP.',
      address: '4517 Congress Ave\nAustin, TX',
      linked: false,
    });
  });
});

describe('StepCard conversation choice', () => {
  const renderStep = (stepNo: number, inThread: boolean) => {
    const onChange = vi.fn();
    const draft = draftFromSequence(sequence);
    const base = {
      ...draft.steps[Math.min(stepNo - 1, draft.steps.length - 1)]!,
      content_source: 'personalized' as const,
      variants: [],
    };
    render(
      <StepCard
        step={{ ...base, in_thread: inThread }}
        stepNo={stepNo}
        canRemove
        saveErrors={new Map()}
        onChange={onChange}
        onRemove={() => {}}
        onPreview={() => {}}
      />,
    );
    return { onChange, base };
  };

  it('explains that Step 1 always starts a new conversation', () => {
    renderStep(1, false);

    expect(
      screen.getByText(/The first step has no earlier sequence email to continue/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('makes both later-step behaviors explicit and updates in_thread', async () => {
    const user = userEvent.setup();
    const { onChange, base } = renderStep(2, true);

    expect(screen.getByRole('radio', { name: 'Continue existing conversation' })).toBeChecked();
    expect(screen.getByText(/Gmail may trim repeated footer content/)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Start new conversation' }));

    expect(onChange).toHaveBeenCalledWith({ ...base, in_thread: false });
  });
});
