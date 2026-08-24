// Manual compose (docs/08 §3, Mode 1): the operator submits a final bespoke
// subject+body for one due enrollment. Same pipeline as every other send —
// stored as a one-off step_variants row ({bespoke:true}, active=false, real
// content hash so the recycle guard applies), rendered LITERAL (footer +
// checks still run), delivered through Scheduler.sendOne so the sent event,
// sent_messages row, threading headers and confirm-delivery all match the
// scheduler path exactly. B6.8 wraps this in POST /manual-sends.
import type { Db } from '../db/client';
import type { Clock } from '../clock';
import type { Scheduler, SendOutcomeKind } from '../scheduler/scheduler';
import type { Renderer } from '../scheduler/types';
import type { RenderChecks } from '../render/types';
import type { DueEnrollment } from '../db/repos/enrollmentsRepo';
import { findByLeadAndCampaign, getById } from '../db/repos/enrollmentsRepo';
import { getLeadById, recontactStatusByLeadIds } from '../db/repos/leadsRepo';
import { getComplianceSettings, getSettings } from '../db/repos/settingsRepo';
import { listMailboxesByStatus } from '../db/repos/mailboxesRepo';
import { firstSentEvent, leadReceivedContentHash } from '../db/repos/eventsRepo';
import {
  getStepId,
  getVariantById,
  insertBespokeVariant,
  loadSequenceDef,
  sequenceIdForCampaign,
} from '../db/repos/sequencesRepo';
import { latestSentMessageId, listThreadMessageIds } from '../db/repos/sentMessagesRepo';
import {
  autoObservationConfigOf,
  getCampaign,
  resolvedVariablesOf,
} from '../db/repos/campaignsRepo';
import { contentHashOf } from '../render/hash';
import { autoObservationsOf } from '../db/repos/campaignsRepo';
import {
  getManualDraft,
  getUnsentManualDraft,
  markManualDraftSent,
} from '../db/repos/manualDraftsRepo';
import { FOOTER_SEPARATOR } from '../render/footer';

/** No sendable mailbox (all at cap/unhealthy, or the override is) → 409 mailbox_unhealthy. */
export class MailboxUnhealthyError extends Error {
  readonly code = 'mailbox_unhealthy';
  constructor(message: string) {
    super(message);
    this.name = 'MailboxUnhealthyError';
  }
}

/** Fatal pre-send checks → 422 (docs/10 manual-sends row). */
export class FatalChecksError extends Error {
  constructor(readonly checks: RenderChecks) {
    super(`manual compose blocked by pre-send checks: ${checks.fatal.map((f) => f.id).join(', ')}`);
    this.name = 'FatalChecksError';
  }
}

export interface ManualComposeDeps {
  db: Db;
  clock: Clock;
  scheduler: Scheduler;
  renderer: Renderer;
}

export interface ManualComposeInput {
  enrollmentId: number;
  subject: string;
  bodyText: string;
  /** Operator override (docs/10 `mailbox_id?`). Never reroutes a threaded follow-up. */
  mailboxId?: number;
  /** Reviewed import draft to mark sent in the same transaction as the sent event. */
  draftId?: number;
}

export interface ManualComposeResult {
  outcome: SendOutcomeKind;
  variantId: number;
  contentHash: string;
  checks: RenderChecks;
  /** The sent message's Message-ID; null when the outcome wasn't 'sent'. */
  messageId: string | null;
}

export async function manualCompose(
  deps: ManualComposeDeps,
  input: ManualComposeInput,
): Promise<ManualComposeResult> {
  const { db, clock, scheduler, renderer } = deps;
  const now = clock.now();

  const enrollment = await getById(db, input.enrollmentId);
  if (!enrollment) throw new Error(`enrollment ${input.enrollmentId} not found`);
  if (enrollment.currentState !== 'ACTIVE') {
    throw new Error(`enrollment ${input.enrollmentId} is ${enrollment.currentState}, not ACTIVE`);
  }
  if (enrollment.personalizationMode !== 'human_written') {
    throw new Error('manual compose is the Mode-1 (human_written) send path');
  }

  const lead = await getLeadById(db, enrollment.leadId);
  if (!lead) throw new Error(`lead ${enrollment.leadId} not found`);
  // Send-time layer of the four-layer suppression guarantee (decision F).
  if (lead.isSuppressed) throw new Error(`lead ${lead.email} is suppressed`);

  // Recycle guard (decision Q): bespoke content is hashed like any template.
  const contentHash = contentHashOf(input.subject, input.bodyText);
  if (await leadReceivedContentHash(db, lead.id, contentHash)) {
    throw new Error('this lead already received identical content (recycle guard)');
  }

  // Pre-flight the LITERAL render so fatals surface as a clear error before
  // anything is persisted. sendOne re-renders deterministically.
  const compliance = await getComplianceSettings(db);
  const stepNo = enrollment.currentStepNo;
  const preview = renderer.render({
    variant: {
      id: 0,
      label: 'bespoke',
      contentHash,
      subjectTemplate: input.subject,
      bodyTemplate: input.bodyText,
    },
    step: { stepNo, inThread: false },
    lead: {
      id: lead.id,
      email: lead.email,
      firstName: lead.firstName,
      company: lead.company,
      website: lead.website,
      city: lead.city,
      state: lead.state,
    },
    enrollmentId: enrollment.id,
    ctx: {
      mode: 'human_written',
      customFields: (lead.customFields ?? {}) as Record<string, string>,
      autoObservations: null,
      compliance,
      literal: true,
    },
  });
  if (preview.checks.fatal.length > 0) {
    throw new FatalChecksError(preview.checks);
  }

  // Persist the one-off variant on the real sequence step row.
  const sequenceId = await sequenceIdForCampaign(db, enrollment.campaignId);
  const stepId = sequenceId === null ? null : await getStepId(db, sequenceId, stepNo);
  if (stepId === null) {
    throw new Error(`campaign ${enrollment.campaignId} has no DB sequence step ${stepNo}`);
  }
  const variantId = await insertBespokeVariant(db, {
    stepId,
    label: `bespoke-e${enrollment.id}s${stepNo}-${now.getTime()}`,
    subjectTemplate: input.subject,
    bodyTemplate: input.bodyText,
    contentHash,
  });

  // Follow-ups stay on the assigned mailbox (threading — never rerouted);
  // first sends take the override, else the first healthy one. Manual sends
  // are operator actions — no cap accounting.
  const okBoxes = await listMailboxesByStatus(db, ['ok']);
  let mailbox;
  if (enrollment.assignedMailboxId !== null) {
    if (input.mailboxId !== undefined && input.mailboxId !== enrollment.assignedMailboxId) {
      throw new Error(
        `enrollment ${enrollment.id} is threaded on mailbox ${enrollment.assignedMailboxId} — rerouting would break threading`,
      );
    }
    mailbox = okBoxes.find((m) => m.id === enrollment.assignedMailboxId);
    if (!mailbox) {
      throw new MailboxUnhealthyError(
        `assigned mailbox ${enrollment.assignedMailboxId} is not healthy`,
      );
    }
  } else if (input.mailboxId !== undefined) {
    mailbox = okBoxes.find((m) => m.id === input.mailboxId);
    if (!mailbox) {
      throw new MailboxUnhealthyError(`mailbox ${input.mailboxId} is not healthy`);
    }
  } else {
    mailbox = okBoxes[0];
    if (!mailbox) throw new MailboxUnhealthyError('no healthy mailbox available');
  }

  const due: DueEnrollment = {
    id: enrollment.id,
    leadId: lead.id,
    campaignId: enrollment.campaignId,
    currentStepNo: stepNo,
    assignedMailboxId: enrollment.assignedMailboxId,
    nextSendAt: enrollment.nextSendAt ?? now,
    personalizationMode: enrollment.personalizationMode,
    leadEmail: lead.email,
    leadFirstName: lead.firstName,
    leadCompany: lead.company,
    leadWebsite: lead.website,
    leadCity: lead.city,
    leadState: lead.state,
    leadCustomFields: (lead.customFields ?? {}) as Record<string, string>,
  };

  const settings = await getSettings(db);
  const outcome = await scheduler.sendOne(
    due,
    { id: mailbox.id, fromAddress: mailbox.fromAddress },
    now,
    settings,
    {
      variantOverride: {
        id: variantId,
        label: 'bespoke',
        contentHash,
        subjectTemplate: input.subject,
        bodyTemplate: input.bodyText,
      },
      literal: true,
      ...(input.draftId !== undefined && {
        acceptedTxWork: async (tx, eventId, messageId) => {
          await markManualDraftSent(tx, input.draftId!, messageId, eventId, now);
        },
      }),
    },
  );

  const messageId =
    outcome === 'sent' ? await latestSentMessageId(db, enrollment.id, contentHash) : null;
  return { outcome, variantId, contentHash, checks: preview.checks, messageId };
}

export type ManualSendDeps = ManualComposeDeps;

export interface ManualSendInput {
  leadId: number;
  campaignId: number;
  enrollmentId?: number;
  draftId?: number;
  mailboxId?: number;
  subject: string;
  bodyText: string;
  allowRecontact?: boolean;
}

/**
 * Manual sends only operate on an existing active human-written enrollment.
 * The lead/campaign fields remain in the request for backwards compatibility,
 * while enrollmentId removes ambiguity when the composer has resolved one.
 */
export async function manualSend(
  deps: ManualSendDeps,
  input: ManualSendInput,
): Promise<ManualComposeResult & { enrollmentId: number }> {
  const { db, clock } = deps;
  const now = clock.now();

  const campaign = await getCampaign(db, input.campaignId);
  if (!campaign) throw new Error(`campaign ${input.campaignId} not found`);
  if (campaign.status !== 'active') throw new Error(`campaign ${input.campaignId} is not active`);
  const lead = await getLeadById(db, input.leadId);
  if (!lead) throw new Error(`lead ${input.leadId} not found`);
  if (lead.isSuppressed) throw new Error(`lead ${lead.email} is suppressed`);

  const replyStatus = (await recontactStatusByLeadIds(db, [lead.id])).get(lead.id);
  if (replyStatus?.hasReply && !input.allowRecontact) {
    throw new Error('lead has replied before; explicit recontact acknowledgement is required');
  }
  if (replyStatus?.hasUndispositionedReply) {
    throw new Error('lead has a reply that still needs an operator disposition');
  }
  if ((replyStatus?.blockedUntil?.getTime() ?? 0) > now.getTime()) {
    throw new Error(`lead is marked not now until ${replyStatus!.blockedUntil!.toISOString()}`);
  }

  const enrollment = input.enrollmentId
    ? await getById(db, input.enrollmentId)
    : await findByLeadAndCampaign(db, input.leadId, input.campaignId);
  if (!enrollment) throw new Error('an active manual enrollment is required before composing');
  if (enrollment.leadId !== input.leadId || enrollment.campaignId !== input.campaignId) {
    throw new Error('enrollment does not belong to the requested lead and campaign');
  }

  const draft = input.draftId === undefined ? undefined : await getManualDraft(db, input.draftId);
  if (input.draftId !== undefined) {
    if (!draft || draft.leadId !== input.leadId || draft.campaignId !== input.campaignId) {
      throw new Error('manual draft does not belong to the requested lead and campaign');
    }
    if (draft.status !== 'ready') {
      throw new Error('imported draft must be reviewed and marked ready before sending');
    }
    if (draft.subject !== input.subject || draft.body !== input.bodyText) {
      throw new Error('save and mark the edited draft ready before sending');
    }
  }

  const result = await manualCompose(deps, {
    enrollmentId: enrollment!.id,
    subject: input.subject,
    bodyText: input.bodyText,
    mailboxId: input.mailboxId,
    draftId: draft?.id,
  });
  return { ...result, enrollmentId: enrollment.id };
}

export interface ManualComposePrefill {
  enrollmentId: number;
  leadId: number;
  campaign: { id: number; name: string };
  stepNo: number;
  stepCount: number;
  dueAt: Date | null;
  personalizationMode: 'human_written' | 'template_researched' | 'template_auto';
  subject: string;
  body: string;
  variantId: number | null;
  draftId: number | null;
  draftStatus: 'needs_review' | 'ready' | null;
  draftSourceImportId: number | null;
  thread: { assignedMailboxId: number | null; previousMessageIds: string[]; inThread: boolean };
  checks: RenderChecks;
}

/** Server-owned starting point for the enrollment's actual due step. */
export async function manualComposePrefill(
  deps: Pick<ManualComposeDeps, 'db' | 'renderer'>,
  enrollmentId: number,
): Promise<ManualComposePrefill> {
  const { db, renderer } = deps;
  const enrollment = await getById(db, enrollmentId);
  if (!enrollment) throw new Error(`enrollment ${enrollmentId} not found`);
  if (enrollment.currentState !== 'ACTIVE' || enrollment.personalizationMode !== 'human_written') {
    throw new Error('manual compose requires an active human-written enrollment');
  }
  const [lead, campaign] = await Promise.all([
    getLeadById(db, enrollment.leadId),
    getCampaign(db, enrollment.campaignId),
  ]);
  if (!lead || !campaign || campaign.status !== 'active' || campaign.sequenceId === null) {
    throw new Error('manual compose requires an active campaign with a sequence');
  }
  const sequence = await loadSequenceDef(db, campaign.sequenceId);
  const step = sequence?.steps.find((candidate) => candidate.stepNo === enrollment.currentStepNo);
  const draft =
    enrollment.currentStepNo === 1
      ? await getUnsentManualDraft(db, lead.id, campaign.id, 1)
      : undefined;
  const templateVariant = step?.variants.toSorted((a, b) => a.id - b.id)[0];
  if (!sequence || !step || (!draft && !templateVariant))
    throw new Error('the due step has no saved draft or active template variant');
  const variant = draft
    ? {
        id: 0,
        label: 'imported-draft',
        contentHash: contentHashOf(draft.subject, draft.body),
        subjectTemplate: draft.subject,
        bodyTemplate: draft.body,
      }
    : templateVariant!;

  const compliance = await getComplianceSettings(db);
  const customFields = (lead.customFields ?? {}) as Record<string, string>;
  let threadSubject: string | undefined;
  if (step.inThread && step.stepNo > 1) {
    const first = await firstSentEvent(db, enrollment.id);
    if (first?.variantId !== null && first?.variantId !== undefined) {
      const firstVariant = await getVariantById(db, first.variantId);
      if (firstVariant) {
        threadSubject = renderer.render({
          variant: firstVariant,
          step: { stepNo: first.stepNo, inThread: false },
          lead: {
            id: lead.id,
            email: lead.email,
            firstName: lead.firstName,
            company: lead.company,
            website: lead.website,
            city: lead.city,
            state: lead.state,
          },
          enrollmentId: enrollment.id,
          ctx: {
            mode: enrollment.personalizationMode,
            customFields,
            autoObservations: autoObservationsOf(campaign),
            autoObservationField: autoObservationConfigOf(campaign).field,
            sequenceVariables: resolvedVariablesOf(campaign),
            compliance,
            literal: firstVariant.attributes.bespoke === true,
          },
        }).subject;
      }
    }
  }

  const rendered = renderer.render({
    variant,
    step: { stepNo: step.stepNo, inThread: step.inThread },
    lead: {
      id: lead.id,
      email: lead.email,
      firstName: lead.firstName,
      company: lead.company,
      website: lead.website,
      city: lead.city,
      state: lead.state,
    },
    enrollmentId: enrollment.id,
    ctx: {
      mode: enrollment.personalizationMode,
      customFields,
      autoObservations: autoObservationsOf(campaign),
      autoObservationField: autoObservationConfigOf(campaign).field,
      sequenceVariables: resolvedVariablesOf(campaign),
      compliance,
      threadSubject,
      literal: Boolean(draft),
    },
  });
  const footerStart = rendered.bodyText.lastIndexOf(FOOTER_SEPARATOR);
  return {
    enrollmentId: enrollment.id,
    leadId: lead.id,
    campaign: { id: campaign.id, name: campaign.name },
    stepNo: step.stepNo,
    stepCount: sequence.steps.length,
    dueAt: enrollment.nextSendAt,
    personalizationMode: enrollment.personalizationMode,
    subject: rendered.subject,
    body: footerStart < 0 ? rendered.bodyText : rendered.bodyText.slice(0, footerStart),
    variantId: draft ? null : variant.id,
    draftId: draft?.id ?? null,
    draftStatus: draft?.status === 'sent' ? null : (draft?.status ?? null),
    draftSourceImportId: draft?.sourceImportId ?? null,
    thread: {
      assignedMailboxId: enrollment.assignedMailboxId,
      previousMessageIds: (await listThreadMessageIds(db, enrollment.id)).map(
        (row) => row.messageId,
      ),
      inThread: step.inThread && step.stepNo > 1,
    },
    checks: rendered.checks,
  };
}
