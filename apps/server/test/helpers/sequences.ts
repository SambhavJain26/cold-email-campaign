// Test sequence builders (B4): VariantDef carries real templates now, so
// fixtures get fatal-free defaults — every lead tag has a fallback, no URLs
// (step-1 rule), no HTML, no spam phrases, no {{custom_observation}} (its
// resolution needs per-campaign config the harness doesn't seed).
import type { SequenceDef, SequenceStepDef, VariantDef } from '../../src/domain/sequence';

export function testVariant(id: number, over: Partial<VariantDef> = {}): VariantDef {
  return {
    id,
    label: 'A',
    contentHash: `h${id}`,
    subjectTemplate: 'Quick question about {{company|your listings}}',
    bodyTemplate:
      'Hi {{first_name|there}},\n\nJust checking in about your listings this quarter — ' +
      'still happy to compare notes whenever it suits.\n\nBest,\nSam',
    ...over,
  };
}

export function testStep(
  stepNo: number,
  waitDays: number,
  over: Partial<SequenceStepDef> & { contentHash?: string } = {},
): SequenceStepDef {
  const { contentHash, ...rest } = over;
  return {
    stepNo,
    waitDays,
    inThread: stepNo > 1,
    variants: [testVariant(stepNo, contentHash === undefined ? {} : { contentHash })],
    ...rest,
  };
}

/** N steps with the given waits; variant ids/hashes follow step numbers (h1, h2, …). */
export function testSequence(id: number, waits: number[]): SequenceDef {
  return { id, steps: waits.map((waitDays, i) => testStep(i + 1, waitDays)) };
}
