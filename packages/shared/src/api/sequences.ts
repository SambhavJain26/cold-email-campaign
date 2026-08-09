// Sequence endpoints (docs/10 §Sequences). Nested Sequence→Step→Variant;
// writes are replace-set per save (retire-don't-delete once sends exist —
// see the docs/10 footnote, decision 2026-07-23).
import { z } from 'zod';

export const variantSchema = z
  .object({
    id: z.number().int(),
    label: z.string(),
    subject_template: z.string(),
    body_template: z.string(),
    active: z.boolean(),
  })
  .strict();
export type VariantDto = z.infer<typeof variantSchema>;

export const stepSchema = z
  .object({
    id: z.number().int(),
    step_no: z.number().int(),
    wait_days: z.number().int(),
    in_thread: z.boolean(),
    variants: z.array(variantSchema),
  })
  .strict();
export type StepDto = z.infer<typeof stepSchema>;

export const sequenceSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    stop_on_reply: z.boolean(),
    stop_on_hard_bounce: z.boolean(),
    stop_on_unsubscribe: z.boolean(),
    steps: z.array(stepSchema),
  })
  .strict();
export type SequenceDto = z.infer<typeof sequenceSchema>;

export const sequencesListResponseSchema = z.object({ items: z.array(sequenceSchema) }).strict();

// ── write shapes: existing rows carry id, new rows omit it ──────────────────

export const variantWriteSchema = z
  .object({
    id: z.number().int().optional(),
    label: z.string().min(1),
    subject_template: z.string().min(1),
    body_template: z.string().min(1),
    active: z.boolean().default(true),
  })
  .strict();

export const stepWriteSchema = z
  .object({
    id: z.number().int().optional(),
    step_no: z.number().int().min(1),
    wait_days: z.number().int().min(0),
    in_thread: z.boolean(),
    variants: z.array(variantWriteSchema).min(1),
  })
  .strict();

export const sequenceWriteBodySchema = z
  .object({
    name: z.string().min(1),
    stop_on_reply: z.boolean().default(true),
    stop_on_hard_bounce: z.boolean().default(true),
    stop_on_unsubscribe: z.boolean().default(true),
    steps: z.array(stepWriteSchema).min(1),
  })
  .strict();
export type SequenceWriteBody = z.infer<typeof sequenceWriteBodySchema>;

/** Typed confirmation for deleting a sequence that has no historical use. */
export const deleteSequenceBodySchema = z.object({ confirm: z.string().min(1) }).strict();

// ── preview + validate-template ─────────────────────────────────────────────

export const previewBodySchema = z
  .object({
    lead_id: z.number().int().positive(),
    step_no: z.number().int().min(1),
    variant_id: z.number().int().positive(),
  })
  .strict();

export const checkItemSchema = z.object({ id: z.string(), message: z.string() }).strict();

export const renderChecksSchema = z
  .object({
    fatal: z.array(checkItemSchema),
    warnings: z.array(checkItemSchema),
    score: z.number(),
    variations: z.number().int(),
  })
  .strict();

export type RenderChecks = z.infer<typeof renderChecksSchema>;

export const previewResponseSchema = z
  .object({
    subject: z.string(),
    body: z.string(),
    checks: renderChecksSchema,
  })
  .strict();

export const validateTemplateBodySchema = z.object({ template: z.string() }).strict();

export const templateTokenSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), value: z.string() }).strict(),
  z
    .object({
      kind: z.literal('tag'),
      field: z.string(),
      fallback: z.string().nullable(),
      offset: z.number().int(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('random'),
      options: z.array(z.string()),
      offset: z.number().int(),
    })
    .strict(),
]);

export const validateTemplateResponseSchema = z
  .object({
    tokens: z.array(templateTokenSchema),
    errors: z.array(z.object({ message: z.string(), offset: z.number().int() }).strict()),
    variations: z.number().int(),
  })
  .strict();
