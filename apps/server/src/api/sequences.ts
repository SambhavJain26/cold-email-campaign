// Sequence route group (B6.5, docs/10 §Sequences): nested CRUD with
// replace-set saves (retire-don't-delete once sends exist), the builder
// preview (the ONE render engine — docs/08 §0), and live template validation.
import type { FastifyInstance } from 'fastify';
import {
  idParamSchema,
  okResponseSchema,
  deleteSequenceBodySchema,
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
  deleteSequenceIfUnreferenced,
  getSequenceNested,
  getVariantById,
  listSequencesNested,
  sequenceHasSends,
  updateSequenceReplaceSet,
  type NestedSequence,
} from '../db/repos/sequencesRepo';
import { getLeadById } from '../db/repos/leadsRepo';
import { getComplianceSettings } from '../db/repos/settingsRepo';
import {
  autoObservationConfigOf,
  getCampaign,
  resolvedVariablesOf,
  variableOverridesOf,
} from '../db/repos/campaignsRepo';
import { contentHashOf } from '../render/hash';
import { parseTemplate, variationCount } from '../render/template';
import { resolveObservation } from '../render/slots';
import { seededPick } from '../render/spintax';
import { spintaxRng } from '../render/seed';
import { AppError } from './errors';
import type { ZodTypeProvider } from './plugins/zodCompilers';

function toSequenceDto(n: NestedSequence): SequenceDto {
  return {
    id: n.sequence.id,
    name: n.sequence.name,
    stop_on_reply: n.sequence.stopOnReply,
    stop_on_hard_bounce: true,
    stop_on_unsubscribe: true,
    variable_defaults: n.sequence.variableDefaults,
    steps: n.steps.map(({ step, variants }) => ({
      id: step.id,
      step_no: step.stepNo,
      wait_days: step.waitDays,
      in_thread: step.inThread,
      content_source: step.contentSource,
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
    if (step.content_source === 'personalized') continue;
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
    contentSource: s.content_source,
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
        variableDefaults: req.body.variable_defaults,
        stopOnReply: req.body.stop_on_reply,
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
          variableDefaults: req.body.variable_defaults,
          stopOnReply: req.body.stop_on_reply,
          steps: toSaveSteps(req.body),
        },
        { retireOnly },
      );
      return toSequenceDto((await getSequenceNested(db, req.params.id))!);
    },
  );

  r.delete(
    '/sequences/:id',
    {
      schema: {
        params: idParamSchema,
        body: deleteSequenceBodySchema,
        response: { 200: okResponseSchema },
      },
    },
    async (req) => {
      const sequence = await getSequenceNested(db, req.params.id);
      if (!sequence) throw AppError.notFound('sequence');
      if (req.body.confirm.trim() !== sequence.sequence.name) {
        throw new AppError('validation', 400, 'confirm must equal the sequence name');
      }
      const result = await deleteSequenceIfUnreferenced(db, req.params.id);
      if (!result.deleted)
        throw new AppError('conflict', 409, result.reason ?? 'sequence cannot be deleted');
      return { ok: true } as const;
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
      if (stepEntry.step.contentSource === 'personalized') {
        throw new AppError(
          'conflict',
          409,
          'Preview personalized copy from the lead Personalized Copy editor',
        );
      }
      if (!req.body.variant_id) throw AppError.notFound('variant');
      const variant = await getVariantById(db, req.body.variant_id);
      if (!variant || variant.stepId !== stepEntry.step.id) throw AppError.notFound('variant');
      const lead = await getLeadById(db, req.body.lead_id);
      if (!lead) throw AppError.notFound('lead');

      const customFields = (lead.customFields ?? {}) as Record<string, string>;
      // Builder preview has no enrollment/campaign context: mirror what the
      // operator would see — researched mode when the lead has a hand-filled
      // custom_observation, else auto mode with no segment table (the
      // observation_fallback warning then shows, which is honest).
      const mode =
        (customFields.custom_observation ?? '').trim() !== ''
          ? 'template_researched'
          : 'template_auto';

      const campaign = req.body.campaign_id
        ? await getCampaign(db, req.body.campaign_id)
        : undefined;
      if (req.body.campaign_id && (!campaign || campaign.sequenceId !== nested.sequence.id)) {
        throw AppError.notFound('campaign');
      }
      const autoConfig = campaign ? autoObservationConfigOf(campaign) : { field: null, rules: {} };
      const sequenceVariables = campaign
        ? campaign.firstActivatedAt
          ? resolvedVariablesOf(campaign)
          : { ...nested.sequence.variableDefaults, ...variableOverridesOf(campaign) }
        : nested.sequence.variableDefaults;
      const renderContext = {
        mode,
        customFields,
        autoObservations: Object.keys(autoConfig.rules).length > 0 ? autoConfig.rules : null,
        autoObservationField: autoConfig.field,
        sequenceVariables,
        compliance: await getComplianceSettings(db),
      } as const;

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
          website: lead.website,
          city: lead.city,
          state: lead.state,
        },
        enrollmentId: 0, // no enrollment in preview — deterministic seed anchor
        ctx: renderContext,
      });
      const leadLite = {
        id: lead.id,
        email: lead.email,
        firstName: lead.firstName,
        company: lead.company,
        website: lead.website,
        city: lead.city,
        state: lead.state,
      };
      const observation = resolveObservation(leadLite, renderContext);
      const selectedFieldValue = autoConfig.field
        ? ({
            state: lead.state,
            city: lead.city,
            company: lead.company,
            website: lead.website,
          }[autoConfig.field] ?? customFields[autoConfig.field])
        : undefined;
      const matchedRule =
        mode === 'template_researched' && customFields.custom_observation?.trim()
          ? 'custom_observation'
          : (Object.entries(autoConfig.rules).find(
              ([key]) =>
                key !== 'default' &&
                key.trim().toLocaleLowerCase() === selectedFieldValue?.trim().toLocaleLowerCase(),
            )?.[0] ?? (Object.hasOwn(autoConfig.rules, 'default') ? 'default' : null));
      const parsedTemplates = [
        parseTemplate(variant.subjectTemplate),
        parseTemplate(variant.bodyTemplate),
      ];
      const fallbackVariables = Object.fromEntries(
        parsedTemplates
          .flatMap((parsed) => parsed.tokens)
          .filter(
            (token) =>
              token.kind === 'tag' &&
              token.field.startsWith('sequence.') &&
              !Object.hasOwn(sequenceVariables, token.field.slice('sequence.'.length)) &&
              token.fallback !== null,
          )
          .map((token) => {
            if (token.kind !== 'tag') throw new Error('unreachable');
            return [
              token.field.slice('sequence.'.length),
              { value: token.fallback!, source: 'fallback' as const },
            ];
          }),
      );
      const pick = seededPick(spintaxRng(0, stepEntry.step.stepNo, variant.id));
      const spintaxChoices = parsedTemplates.flatMap((parsed) =>
        parsed.tokens.flatMap((token) =>
          token.kind === 'random'
            ? [{ options: token.options, selected: pick(token.options) }]
            : [],
        ),
      );
      return {
        subject: rendered.subject,
        body: rendered.bodyText,
        checks: rendered.checks,
        resolution_trace: {
          lead_values: {
            first_name: lead.firstName,
            company: lead.company,
            website: lead.website,
            city: lead.city,
            state: lead.state,
            ...Object.fromEntries(
              Object.entries(customFields).map(([key, value]) => [key, value ?? null]),
            ),
          },
          observation: {
            field: autoConfig.field,
            matched_rule: matchedRule,
            value: observation.value ?? '',
          },
          sequence_variables: Object.fromEntries([
            ...Object.entries(sequenceVariables).map(
              ([key, value]) =>
                [
                  key,
                  {
                    value,
                    source:
                      campaign && Object.hasOwn(variableOverridesOf(campaign), key)
                        ? ('campaign' as const)
                        : ('sequence' as const),
                  },
                ] as const,
            ),
            ...Object.entries(fallbackVariables),
          ]),
          spintax_choices: spintaxChoices,
          warnings: rendered.checks.warnings.map((warning) => warning.message),
        },
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
