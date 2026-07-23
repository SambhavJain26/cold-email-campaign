// Sequence route group (B6.5, docs/10 §Sequences): nested CRUD with
// replace-set saves (retire-don't-delete once sends exist), the builder
// preview (the ONE render engine - docs/08 §0), and live template validation.
import type { FastifyInstance } from 'fastify';
import {
  idParamSchema,
  previewBodySchema,
  previewResponseSchema,
  sequenceSchema,
  sequencesListResponseSchema,
  sequenceWriteBodySchema,
  validateTemplateBodySchema,
  validateTemplateResponseSchema,
  type SequenceDto,
  type SequenceWriteBody,
} from '@coldemail/shared';
import type { AppServices } from '../composition';
import {
  createSequence,
  getSequenceNested,
  getVariantById,
  listSequencesNested,
  sequenceHasSends,
  updateSequenceReplaceSet,
  type NestedSequence,
} from '../db/repos/sequencesRepo';
import { getLeadById } from '../db/repos/leadsRepo';
import { getComplianceSettings } from '../db/repos/settingsRepo';
import { contentHashOf } from '../render/hash';
import { parseTemplate, variationCount } from '../render/template';
import { AppError } from './errors';
import type { ZodTypeProvider } from './plugins/zodCompilers';

function toSequenceDto(n: NestedSequence): SequenceDto {
  return {
    id: n.sequence.id,
    name: n.sequence.name,
    stop_on_reply: n.sequence.stopOnReply,
    stop_on_hard_bounce: n.sequence.stopOnHardBounce,
    stop_on_unsubscribe: n.sequence.stopOnUnsubscribe,
    steps: n.steps.map(({ step, variants }) => ({
      id: step.id,
      step_no: step.stepNo,
      wait_days: step.waitDays,
      in_thread: step.inThread,
      variants: variants.map((v) => ({
        id: v.id,
        label: v.label,
        subject_template: v.subjectTemplate,
        body_template: v.bodyTemplate,
        active: v.active,
      })),
    })),
  };
}

/** Fatal template errors block the save: 422 sequence_invalid, mapped per step/variant (docs/12 §5). */
function assertTemplatesParse(body: SequenceWriteBody): void {
  const errors: Array<{ step_no: number; label: string; field: string; message: string }> = [];
  for (const step of body.steps) {
    for (const v of step.variants) {
      for (const [field, src] of [
        ['subject_template', v.subject_template],
        ['body_template', v.body_template],
      ] as const) {
        for (const e of parseTemplate(src).errors) {
          errors.push({ step_no: step.step_no, label: v.label, field, message: e.message });
        }
      }
    }
  }
  if (errors.length > 0) {
    throw new AppError('sequence_invalid', 422, 'template errors block the save', { errors });
  }
}

function toSaveSteps(body: SequenceWriteBody) {
  return body.steps.map((s) => ({
    id: s.id,
    stepNo: s.step_no,
    waitDays: s.wait_days,
    inThread: s.in_thread,
    variants: s.variants.map((v) => ({
      id: v.id,
      label: v.label,
      subjectTemplate: v.subject_template,
      bodyTemplate: v.body_template,
      contentHash: contentHashOf(v.subject_template, v.body_template), // decision Q: hash at save time
      active: v.active,
    })),
  }));
}

export async function sequencesRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, renderer } = services;

  r.get('/sequences', { schema: { response: { 200: sequencesListResponseSchema } } }, async () => ({
    items: (await listSequencesNested(db)).map(toSequenceDto),
  }));

  r.post(
    '/sequences',
    { schema: { body: sequenceWriteBodySchema, response: { 200: sequenceSchema } } },
    async (req) => {
      assertTemplatesParse(req.body);
      const id = await createSequence(db, {
        name: req.body.name,
        stopOnReply: req.body.stop_on_reply,
        stopOnHardBounce: req.body.stop_on_hard_bounce,
        stopOnUnsubscribe: req.body.stop_on_unsubscribe,
        steps: toSaveSteps(req.body).map(({ id: _new, ...s }) => s),
      });
      return toSequenceDto((await getSequenceNested(db, id))!);
    },
  );

  r.patch(
    '/sequences/:id',
    {
      schema: {
        params: idParamSchema,
        body: sequenceWriteBodySchema,
        response: { 200: sequenceSchema },
      },
    },
    async (req) => {
      const existing = await getSequenceNested(db, req.params.id);
      if (!existing) throw AppError.notFound('sequence');
      assertTemplatesParse(req.body);
      const retireOnly = await sequenceHasSends(db, req.params.id);
      await updateSequenceReplaceSet(
        db,
        req.params.id,
        {
          name: req.body.name,
          stopOnReply: req.body.stop_on_reply,
          stopOnHardBounce: req.body.stop_on_hard_bounce,
          stopOnUnsubscribe: req.body.stop_on_unsubscribe,
          steps: toSaveSteps(req.body),
        },
        { retireOnly },
      );
      return toSequenceDto((await getSequenceNested(db, req.params.id))!);
    },
  );

  r.post(
    '/sequences/:id/preview',
    {
      schema: {
        params: idParamSchema,
        body: previewBodySchema,
        response: { 200: previewResponseSchema },
      },
    },
    async (req) => {
      const nested = await getSequenceNested(db, req.params.id);
      if (!nested) throw AppError.notFound('sequence');
      const stepEntry = nested.steps.find((s) => s.step.stepNo === req.body.step_no);
      if (!stepEntry) throw AppError.notFound('step');
      const variant = await getVariantById(db, req.body.variant_id);
      if (!variant || variant.stepId !== stepEntry.step.id) throw AppError.notFound('variant');
      const lead = await getLeadById(db, req.body.lead_id);
      if (!lead) throw AppError.notFound('lead');

      const customFields = (lead.customFields ?? {}) as Record<string, string>;
      // Builder preview has no enrollment/campaign context: mirror what the
      // operator would see - researched mode when the lead has a hand-filled
      // custom_observation, else auto mode with no segment table (the
      // observation_fallback warning then shows, which is honest).
      const mode =
        (customFields.custom_observation ?? '').trim() !== ''
          ? 'template_researched'
          : 'template_auto';

      const rendered = renderer.render({
        variant: {
          id: variant.id,
          label: variant.label,
          contentHash: variant.contentHash,
          subjectTemplate: variant.subjectTemplate,
          bodyTemplate: variant.bodyTemplate,
        },
        step: { stepNo: stepEntry.step.stepNo, inThread: stepEntry.step.inThread },
        lead: {
          id: lead.id,
          email: lead.email,
          firstName: lead.firstName,
          company: lead.company,
          state: lead.state,
        },
        enrollmentId: 0, // no enrollment in preview - deterministic seed anchor
        ctx: {
          mode,
          customFields,
          autoObservations: null,
          compliance: await getComplianceSettings(db),
        },
      });
      return {
        subject: rendered.subject,
        body: rendered.bodyText,
        checks: rendered.checks,
      };
    },
  );

  r.post(
    '/sequences/validate-template',
    {
      schema: {
        body: validateTemplateBodySchema,
        response: { 200: validateTemplateResponseSchema },
      },
    },
    async (req) => {
      const parsed = parseTemplate(req.body.template);
      return {
        tokens: parsed.tokens,
        errors: parsed.errors,
        variations: variationCount(parsed),
      };
    },
  );
}
