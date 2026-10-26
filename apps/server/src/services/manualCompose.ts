// Manual compose (docs/08 §3, Mode 1): the operator submits a final bespoke
// subject+body for one due enrollment. Same pipeline as every other send - 
// stored as a one-off step_variants row ({bespoke:true}, active=false, real
// content hash so the recycle guard applies), rendered LITERAL (footer +
// checks still run), delivered through Scheduler.sendOne so the sent event,
// sent_messages row, threading headers and confirm-delivery all match the
// scheduler path exactly. B6.8 wraps this in POST /manual-sends.
import type { Db } from '../db/client';
import type { Clock } from '../clock';
import type { Scheduler, SendOutcomeKind } from '../scheduler/scheduler';
import type { Renderer, SequenceProvider } from '../scheduler/types';
import type { RenderChecks } from '../render/types';
import type { DueEnrollment } from '../db/repos/enrollmentsRepo';
import { findByLeadAndCampaign, getById, insertEnrollments } from '../db/repos/enrollmentsRepo';
import { getLeadById } from '../db/repos/leadsRepo';
import { getComplianceSettings, getSettings } from '../db/repos/settingsRepo';
import { listMailboxesByStatus } from '../db/repos/mailboxesRepo';
import { leadReceivedContentHash } from '../db/repos/eventsRepo';
import { getStepId, insertBespokeVariant, sequenceIdForCampaign } from '../db/repos/sequencesRepo';
import { latestSentMessageId } from '../db/repos/sentMessagesRepo';
import { getCampaign } from '../db/repos/campaignsRepo';
import { contentHashOf } from '../render/hash';
import { buildEvent } from '../domain/events';
import type { EventStore } from './eventStore';

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

  // Follow-ups stay on the assigned mailbox (threading - never rerouted);
  // first sends take the override, else the first healthy one. Manual sends
  // are operator actions - no cap accounting.
  const okBoxes = await listMailboxesByStatus(db, ['ok']);
  let mailbox;
  if (enrollment.assignedMailboxId !== null) {
    if (input.mailboxId !== undefined && input.mailboxId !== enrollment.assignedMailboxId) {
      throw new Error(
        `enrollment ${enrollment.id} is threaded on mailbox ${enrollment.assignedMailboxId} - rerouting would break threading`,
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
    },
  );

  const messageId =
    outcome === 'sent' ? await latestSentMessageId(db, enrollment.id, contentHash) : null;
  return { outcome, variantId, contentHash, checks: preview.checks, messageId };
}

export interface ManualSendDeps extends ManualComposeDeps {
  store: EventStore;
  sequences: SequenceProvider;
}

export interface ManualSendInput {
  leadId: number;
  campaignId: number;
  mailboxId?: number;
  subject: string;
  bodyText: string;
}

/**
 * B6.8 POST /manual-sends: enroll-if-needed, then the manualCompose path.
 * A fresh enrollment is created human_written (Mode 1 by definition) with an
 * `enrolled` event - the docs/10 traceability row (`enrolled`?) + `sent`.
 */
export async function manualSend(
  deps: ManualSendDeps,
  input: ManualSendInput,
): Promise<ManualComposeResult & { enrollmentId: number }> {
  const { db, clock, store } = deps;
  const now = clock.now();

  const campaign = await getCampaign(db, input.campaignId);
  if (!campaign) throw new Error(`campaign ${input.campaignId} not found`);
  const lead = await getLeadById(db, input.leadId);
  if (!lead) throw new Error(`lead ${input.leadId} not found`);

  let enrollment = await findByLeadAndCampaign(db, input.leadId, input.campaignId);
  if (!enrollment) {
    if (lead.isSuppressed) throw new Error(`lead ${lead.email} is suppressed`);
    const [enrollmentId] = await insertEnrollments(db, [
      {
        leadId: lead.id,
        campaignId: input.campaignId,
        enrolledTier: lead.tier,
        personalizationMode: 'human_written',
        enrolledAt: now,
      },
    ]);
    await store.append(
      [
        buildEvent.enrolled({
          leadId: lead.id,
          enrollmentId: enrollmentId!,
          campaignId: input.campaignId,
          occurredAt: now,
        }),
      ],
      { patches: [{ enrollmentId: enrollmentId!, nextSendAt: now }] },
    );
    enrollment = await getById(db, enrollmentId!);
  }

  const result = await manualCompose(deps, {
    enrollmentId: enrollment!.id,
    subject: input.subject,
    bodyText: input.bodyText,
    mailboxId: input.mailboxId,
  });
  return { ...result, enrollmentId: enrollment!.id };
}
