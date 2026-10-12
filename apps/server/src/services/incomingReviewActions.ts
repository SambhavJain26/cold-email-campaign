import type { z } from 'zod';
import { createHash } from 'node:crypto';
import type { SequenceDef } from '../domain/sequence';
import {
  reviewActionSchema,
  incomingLinkSchema,
  incomingAckSchema,
  incomingAuthorshipBodySchema,
  resolveReviewLocalTime,
  type IncomingReviewMessage,
} from '@coldemail/shared';
import type { Db, Tx } from '../db/client';
import type { EventStore } from './eventStore';
import { acquireRebuildLockShared, lockLead, lockEnrollment } from '../db/repos/locksRepo';
import { getById, findByLeadAndCampaign } from '../db/repos/enrollmentsRepo';
import { getLeadById } from '../db/repos/leadsRepo';
import { suppressedAmong } from '../db/repos/suppressionsRepo';
import { listByEnrollments } from '../db/repos/eventsRepo';
import { getCampaign } from '../db/repos/campaignsRepo';
import { loadSequenceDef } from '../db/repos/sequencesRepo';
import { stepOf } from '../domain/sequence';
import { followupDueAt } from '../scheduler/followupDue';
import { resolveTimezone } from '../scheduler/tzmap';
import { getMailbox } from '../db/repos/mailboxesRepo';
import { getSettings } from '../db/repos/settingsRepo';
import { findSentByMessageIds } from '../db/repos/sentMessagesRepo';
import { getManualDraft } from '../db/repos/manualDraftsRepo';
import { buildEvent, type DomainEvent } from '../domain/events';
import {
  listRows,
  readMessage,
  activity,
  operationExists,
  updateMessage,
  targetsForLead,
  linkTarget,
  linkCandidates,
  unlinkMessage,
  bumpMessage,
  heldLinks,
  setAcknowledged,
  lockMessage,
} from '../db/repos/incomingReviewRepo';
import { explicitOptOut, extractNewText } from '../poller/reviewText';
import { findReplyCandidates } from '../db/repos/replyCandidatesRepo';
import { incomingMessageIdentity } from '../db/repos/incomingReviewRepo';

export class IncomingReviewError extends Error {
  constructor(
    readonly code: 'conflict' | 'validation' | 'not_found',
    message: string,
  ) {
    super(message);
  }
}
function conflict(message: string): never {
  throw new IncomingReviewError('conflict', message);
}
function validation(message: string): never {
  throw new IncomingReviewError('validation', message);
}
async function leadProtected(tx: Tx, id: number) {
  const lead = await getLeadById(tx, id);
  if (!lead) throw new IncomingReviewError('not_found', 'Lead not found');
  return {
    lead,
    suppressed: lead.isSuppressed || (await suppressedAmong(tx, [lead.email])).has(lead.email),
  };
}
function checkRevision(actual: number, expected: number) {
  if (actual !== expected)
    conflict(
      'New information arrived. Refresh and review the current messages before applying this action.',
    );
}
function sequenceFingerprint(sequence: SequenceDef): string {
  return createHash('sha256').update(JSON.stringify(sequence)).digest('hex');
}
async function lockedMessage(tx: Tx, id: number, expected: number): Promise<IncomingReviewMessage> {
  const before = await readMessage(tx, id);
  if (!before) throw new IncomingReviewError('not_found', 'Incoming message not found');
  checkRevision(before.revision, expected);
  for (const leadId of [...new Set(before.links.map((l) => l.lead_id))].sort((a, b) => a - b))
    await lockLead(tx, leadId);
  await lockMessage(tx, id);
  const message = await readMessage(tx, id);
  if (!message) throw new IncomingReviewError('not_found', 'Incoming message not found');
  checkRevision(message.revision, expected);
  return message;
}

export async function applyReviewAction(
  db: Db,
  store: EventStore,
  enrollmentId: number,
  body: z.infer<typeof reviewActionSchema>,
  now: Date,
): Promise<void> {
  await store.withEnrollmentLock(enrollmentId, async (tx) => {
    if (await operationExists(tx, body.operation_id)) return;
    const e = await getById(tx, enrollmentId);
    if (!e) throw new IncomingReviewError('not_found', 'Enrollment not found');
    const { lead, suppressed } = await leadProtected(tx, e.leadId);
    const ids = { leadId: e.leadId, campaignId: e.campaignId, enrollmentId, occurredAt: now };
    const history = (await listByEnrollments(tx, [enrollmentId])).get(enrollmentId) ?? [];
    checkRevision(history.at(-1)?.id ?? 0, body.expected_revision);
    if (body.action === 'suppress') {
      if (body.confirm !== lead.email)
        validation('Type the complete email address to confirm permanent suppression.');
      await store.appendUnderEnrollmentLock(tx, enrollmentId, [
        buildEvent.addressSuppressed({
          ...ids,
          attributes: { rule: 'manual', operation_id: body.operation_id },
        }),
      ]);
    } else {
      if (suppressed || e.currentState === 'UNSUBSCRIBED' || e.currentState === 'BOUNCED')
        conflict('This address is permanently protected from outreach.');
      if (body.action === 'correct_stop' || body.action === 'restore_legacy') {
        if (!['STOPPED', 'REPLIED'].includes(e.currentState))
          conflict('Only a stopped or legacy replied sequence can be restored to review.');
        if (body.action === 'correct_stop' && !e.manualStopEventId)
          conflict('This is a legacy record. Use historical restoration.');
        if (body.action === 'restore_legacy' && e.manualStopEventId)
          conflict('Use correction of the manual Stop action.');
        const campaign = await getCampaign(tx, e.campaignId);
        const seq = campaign?.sequenceId ? await loadSequenceDef(tx, campaign.sequenceId) : null;
        const step = seq && stepOf(seq, e.currentStepNo);
        if (!step) conflict('No compatible remaining sequence step exists.');
        const manualStop = history.find(
          (fact) => fact.id === e.manualStopEventId && fact.type === 'sequence_stopped',
        );
        if (
          body.action === 'correct_stop' &&
          (!manualStop ||
            manualStop.type !== 'sequence_stopped' ||
            manualStop.attributes.sequence_fingerprint !== sequenceFingerprint(seq!))
        )
          conflict('The sequence changed after Stop. A compatible checkpoint cannot be verified.');
        if (body.action === 'restore_legacy') {
          const sends = history.filter((fact) => fact.type === 'sent');
          const snapshots = await findSentByMessageIds(
            tx,
            sends.map((fact) => fact.messageId),
          );
          for (const fact of sends) {
            const priorStep = stepOf(seq!, fact.stepNo);
            if (fact.attributes.content_source === 'personalized') {
              const saved = snapshots.get(fact.messageId);
              const copyId = fact.attributes.personalized_copy_id ?? saved?.personalizedCopyId;
              // Older retry facts omit the copy ID, but their exact saved message
              // retains it. Require an earlier accepted fact anchoring that copy.
              const anchored =
                fact.attributes.personalized_copy_id ||
                sends.some(
                  (prior) =>
                    prior.stepNo === fact.stepNo &&
                    prior.occurredAt <= fact.occurredAt &&
                    prior.attributes.content_source === 'personalized' &&
                    prior.attributes.personalized_copy_id === copyId &&
                    prior.attributes.content_hash === fact.attributes.content_hash,
                );
              const copy = copyId ? await getManualDraft(tx, copyId) : undefined;
              if (
                priorStep?.contentSource !== 'personalized' ||
                !saved ||
                !anchored ||
                saved.enrollmentId !== e.id ||
                saved.leadId !== e.leadId ||
                saved.mailboxId !== fact.mailboxId ||
                saved.stepNo !== fact.stepNo ||
                saved.contentSource !== 'personalized' ||
                saved.contentHash !== fact.attributes.content_hash ||
                saved.personalizedCopyId !== copyId ||
                !saved.renderedSubject?.trim() ||
                !saved.renderedBodyText?.trim() ||
                (saved.emailFormat !== 'plain_text' && !saved.renderedBodyHtml?.trim()) ||
                !copy ||
                copy.leadId !== e.leadId ||
                copy.campaignId !== e.campaignId ||
                copy.stepNo !== fact.stepNo ||
                copy.sequenceStepId !== priorStep.id ||
                copy.status !== 'sent' ||
                copy.contentHash !== fact.attributes.content_hash
              )
                conflict(
                  'The saved personalized email cannot be verified against this sequence. Nothing was restored.',
                );
            } else if (
              priorStep?.contentSource === 'personalized' ||
              !priorStep?.variants.some(
                (variant) =>
                  variant.id === fact.attributes.variant_id &&
                  variant.contentHash === fact.attributes.content_hash,
              )
            )
              conflict(
                'The previously sent template no longer matches this sequence. Nothing was restored.',
              );
          }
        }
        const siblings = await targetsForLead(tx, e.leadId);
        if (siblings.some((s) => s.id !== e.id && ['NEW', 'ACTIVE'].includes(s.current_state)))
          conflict(
            'Another unfinished enrollment exists. Review it before restoring this sequence.',
          );
        const lastSent = history.filter((h) => h.type === 'sent').at(-1);
        const lastBounce = history.filter((h) => h.type === 'soft_bounce').at(-1);
        let due = e.resumeDueAt;
        if (!due && lastSent) {
          const mailbox =
            lastSent.type === 'sent' ? await getMailbox(tx, lastSent.mailboxId) : undefined;
          const settings = await getSettings(tx);
          due = followupDueAt(
            lastSent.occurredAt,
            step.waitDays,
            seq!.waitDayMode ?? 'elapsed_days',
            resolveTimezone(lead.state, mailbox?.timezone || settings.defaultTimezone),
          );
        }
        if (lastBounce && lastSent && lastBounce.occurredAt > lastSent.occurredAt) {
          // Retry restoration must have the immutable body originally accepted.
          const { sentMessageForStep } = await import('../db/repos/sentMessagesRepo');
          const saved = await sentMessageForStep(tx, e.id, lastSent.stepNo);
          if (
            !saved?.renderedSubject ||
            !saved.renderedBodyText ||
            (saved.emailFormat !== 'plain_text' && !saved.renderedBodyHtml)
          )
            conflict('The saved retry body is missing. Restoration is blocked.');
          due = new Date(lastBounce.occurredAt.getTime() + 4 * 3600000);
        }
        if (!due) conflict('A safe continuation checkpoint could not be established.');
        const blockers =
          body.action === 'correct_stop'
            ? [e.manualStopEventId!]
            : history
                .filter((h) => h.type === 'outreach_stopped' || h.type === 'human_reply')
                .map((h) => h.id!);
        if (!blockers.length) conflict('The original blocking facts could not be identified.');
        await store.appendUnderEnrollmentLock(
          tx,
          enrollmentId,
          [
            buildEvent.sequenceRestored({
              ...ids,
              attributes: {
                blocker_event_ids: blockers,
                reason:
                  body.reason ??
                  (body.action === 'correct_stop'
                    ? 'Operator confirmed correction of manual Stop.'
                    : 'Operator confirmed restoration of legacy stop or reply.'),
                resume_due_at: due.toISOString(),
                operation_id: body.operation_id,
              },
            }),
          ],
          { patches: [{ enrollmentId, nextSendAt: due }] },
        );
      } else {
        if (!['ACTIVE', 'NEW'].includes(e.currentState))
          conflict('This sequence is terminal. Ordinary Continue, Delay and Stop are unavailable.');
        if (body.hold_ids.some((id) => !e.reviewHoldIds.includes(id)))
          conflict('The selected review holds are no longer current.');
        if (body.action === 'continue' || body.action === 'delay') {
          const selectedHolds = history.filter(
            (h) => body.hold_ids.includes(h.id!) && h.type === 'incoming_review_required',
          );
          if (
            selectedHolds.some(
              (h) =>
                h.type === 'incoming_review_required' &&
                !body.reviewed_message_ids.includes(h.attributes.incoming_message_id),
            )
          )
            conflict('Include the exact messages reviewed for the selected holds.');
        }
        if (body.action === 'stop') {
          const campaign = await getCampaign(tx, e.campaignId);
          const sequence = campaign?.sequenceId
            ? await loadSequenceDef(tx, campaign.sequenceId)
            : null;
          const checkpoint = e.nextSendAt
            ? new Date(Math.max(e.nextSendAt.getTime(), e.delayedUntil?.getTime() ?? 0))
            : null;
          await store.appendUnderEnrollmentLock(tx, enrollmentId, [
            buildEvent.sequenceStopped({
              ...ids,
              attributes: {
                hold_event_ids: e.reviewHoldIds,
                resume_due_at: checkpoint?.toISOString() ?? null,
                ...(sequence ? { sequence_fingerprint: sequenceFingerprint(sequence) } : {}),
                operation_id: body.operation_id,
              },
            }),
          ]);
        } else {
          if (body.action === 'continue' && !body.hold_ids.length)
            conflict('Select the response holds you reviewed before continuing.');
          if (body.action === 'delay') {
            if (!body.until || !body.timezone || !body.local_time || new Date(body.until) <= now)
              validation('Choose a future continuation instant and an IANA timezone.');
            const resolved = resolveReviewLocalTime(body.local_time, body.timezone);
            if (resolved.error || resolved.instant !== body.until)
              validation(
                resolved.error ??
                  'The resolved continuation instant does not match the chosen local time.',
              );
            try {
              new Intl.DateTimeFormat('en-US', { timeZone: body.timezone }).format(now);
            } catch {
              validation('Timezone is invalid.');
            }
          }
          await store.appendUnderEnrollmentLock(tx, enrollmentId, [
            buildEvent.reviewDecided({
              ...ids,
              attributes: {
                action: body.action,
                hold_event_ids: body.hold_ids,
                ...(body.action === 'delay' ? { until: body.until } : {}),
                operation_id: body.operation_id,
              },
            }),
          ]);
        }
      }
    }
    await activity(
      tx,
      null,
      body.operation_id,
      body.action,
      now,
      { lead_id: e.leadId, campaign_id: e.campaignId, hold_ids: body.hold_ids },
      enrollmentId,
    );
  });
}

export async function linkIncoming(
  db: Db,
  store: EventStore,
  id: number,
  body: z.infer<typeof incomingLinkSchema>,
  now: Date,
  candidateOnly = false,
): Promise<void> {
  await db.transaction(async (tx) => {
    await acquireRebuildLockShared(tx);
    if (await operationExists(tx, body.operation_id)) return;
    const old = await readMessage(tx, id);
    if (!old) throw new IncomingReviewError('not_found', 'Incoming message not found');
    for (const leadId of [...new Set([body.lead_id, ...old.links.map((l) => l.lead_id)])].sort(
      (a, b) => a - b,
    ))
      await lockLead(tx, leadId);
    if (await operationExists(tx, body.operation_id)) return;
    const message = await lockedMessage(tx, id, body.expected_revision);
    if (candidateOnly) {
      if (message.links.length)
        conflict('This message is already linked. Refresh the conversation.');
      const identity = await incomingMessageIdentity(tx, id);
      if (!identity?.from || !identity.receivedAt) validation('Message identity is unavailable.');
      const possibilities = await findReplyCandidates(tx, {
        mailboxId: identity.mailboxId,
        from: identity.from,
        subject: identity.subject ?? '',
        receivedAt: identity.receivedAt,
      });
      if (
        !possibilities.some((c) => c.lead_id === body.lead_id && c.campaign_id === body.campaign_id)
      )
        conflict('The suggested lead is no longer eligible. Refresh the message.');
    }
    const { lead } = await leadProtected(tx, body.lead_id);
    const candidates = await linkCandidates(tx, body.campaign_id, lead.email);
    if (!candidates.some((c) => c.lead_id === lead.id))
      validation('Choose a lead enrolled or pooled in the selected campaign.');
    const selected = await findByLeadAndCampaign(tx, lead.id, body.campaign_id);
    const targets = await targetsForLead(tx, lead.id);
    for (const e of targets) await lockEnrollment(tx, e.id);
    await unlinkMessage(tx, id);
    await linkTarget(tx, id, lead.id, body.campaign_id, selected?.id ?? null, 'manual');
    for (const e of targets.filter((t) => ['NEW', 'ACTIVE'].includes(t.current_state)))
      await linkTarget(tx, id, lead.id, e.campaign_id, e.id, 'manual_safety_hold');
    await updateMessage(tx, id, selected?.id ?? null, 'linked');
    const extracted = extractNewText(message.body_text ?? '');
    const unsafeQuotes =
      !!message.body_html &&
      /<blockquote|gmail_quote|moz-cite-prefix|\bid=["']?(?:divRplyFwdMsg|appendonsend)/i.test(
        message.body_html,
      ) &&
      !extracted.quotedText;
    const optout =
      message.from_address === lead.email &&
      message.capture_status === 'captured' &&
      explicitOptOut(extracted.newText, extracted.uncertain || unsafeQuotes);
    const evs: DomainEvent[] = optout
      ? [
          buildEvent.addressSuppressed({
            leadId: lead.id,
            occurredAt: now,
            attributes: {
              incoming_message_id: id,
              rule: 'explicit_optout',
              operation_id: body.operation_id,
            },
          }),
        ]
      : targets
          .filter((e) => ['NEW', 'ACTIVE'].includes(e.current_state))
          .map((e) =>
            buildEvent.reviewRequired({
              leadId: lead.id,
              campaignId: e.campaign_id,
              enrollmentId: e.id,
              occurredAt: now,
              attributes: { incoming_message_id: id },
            }),
          );
    if (!optout && selected && !['NEW', 'ACTIVE'].includes(selected.currentState))
      evs.push(
        buildEvent.reviewRequired({
          leadId: lead.id,
          campaignId: body.campaign_id,
          enrollmentId: selected.id,
          occurredAt: now,
          attributes: { incoming_message_id: id },
        }),
      );
    else if (
      !optout &&
      !selected &&
      !targets.some((e) => ['NEW', 'ACTIVE'].includes(e.current_state))
    )
      evs.push(
        buildEvent.reviewRequired({
          leadId: lead.id,
          campaignId: body.campaign_id,
          occurredAt: now,
          attributes: { incoming_message_id: id },
        }),
      );
    // Preserve confirmed authorship while moving its campaign credit. Never infer a human
    // from the link itself; remove the old projection contribution through a new fact.
    if (
      message.policy_version !== 'legacy' &&
      message.primary_enrollment_id !== selected?.id &&
      message.authorship !== 'unsure'
    ) {
      const previous = old.links.find((l) => l.enrollment_id === message.primary_enrollment_id);
      if (previous?.enrollment_id)
        evs.push(
          buildEvent.authorshipConfirmed({
            leadId: previous.lead_id,
            campaignId: previous.campaign_id,
            enrollmentId: previous.enrollment_id,
            occurredAt: now,
            sentiment: null,
            attributes: {
              incoming_message_id: id,
              authorship: 'unsure',
              operation_id: body.operation_id,
            },
          }),
        );
      if (selected)
        evs.push(
          buildEvent.authorshipConfirmed({
            leadId: lead.id,
            campaignId: body.campaign_id,
            enrollmentId: selected.id,
            occurredAt: now,
            sentiment: message.sentiment,
            attributes: {
              incoming_message_id: id,
              authorship: message.authorship,
              operation_id: body.operation_id,
            },
          }),
        );
    }
    const eventIds = await store.appendInTransaction(tx, evs);
    await activity(tx, id, body.operation_id, 'linked', now, {
      lead_id: lead.id,
      campaign_id: body.campaign_id,
      primary_enrollment_id: selected?.id ?? null,
      previous_links: old.links.map((l) => ({ lead_id: l.lead_id, campaign_id: l.campaign_id })),
      holds: evs.flatMap((event, index) =>
        event.type === 'incoming_review_required'
          ? [{ id: eventIds[index], enrollment_id: event.enrollmentId }]
          : [],
      ),
    });
  });
}

/** Resolves review for an unenrolled pool row without creating an enrollment or sending. */
export async function reviewPoolLead(
  db: Db,
  store: EventStore,
  leadId: number,
  campaignId: number,
  body: z.infer<typeof reviewActionSchema>,
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    await acquireRebuildLockShared(tx);
    await lockLead(tx, leadId);
    if (await operationExists(tx, body.operation_id)) return;
    const row = (
      await listRows(tx, {
        lead_id: leadId,
        campaign_id: campaignId,
        view: 'all',
        page: 1,
        per_page: 1,
        now,
      })
    ).items[0];
    if (!row || row.enrollment_id !== null) conflict('Select an unenrolled linked lead row.');
    checkRevision(row.revision, body.expected_revision);
    if ((await leadProtected(tx, leadId)).suppressed)
      conflict('This address is permanently protected.');
    if (body.action !== 'continue')
      validation(
        'An unenrolled lead can only have its review resolved here. No sequence exists to Stop or Delay.',
      );
    if (!body.hold_ids.length || body.hold_ids.some((id) => !row.hold_ids.includes(id)))
      conflict('Select the current review holds.');
    for (const id of body.reviewed_message_ids) {
      const message = await readMessage(tx, id);
      if (!message?.links.some((l) => l.lead_id === leadId && l.campaign_id === campaignId))
        conflict('Review messages linked to this campaign row.');
    }
    const { sql } = await import('drizzle-orm');
    const held = (
      await tx.execute(
        sql`SELECT id,(attributes->>'incoming_message_id')::bigint AS message_id FROM events WHERE id=ANY(${sql.param(body.hold_ids)}::bigint[])`,
      )
    ).rows;
    if (held.some((h) => !body.reviewed_message_ids.includes(Number(h.message_id))))
      conflict('Include every message covered by the selected holds.');
    await store.appendInTransaction(tx, [
      buildEvent.reviewDecided({
        leadId,
        campaignId,
        occurredAt: now,
        attributes: {
          action: 'continue',
          hold_event_ids: body.hold_ids,
          operation_id: body.operation_id,
        },
      }),
    ]);
    await activity(tx, null, body.operation_id, 'pool_review_resolved', now, {
      lead_id: leadId,
      campaign_id: campaignId,
      hold_ids: body.hold_ids,
    });
  });
}

export async function confirmAuthorship(
  db: Db,
  store: EventStore,
  id: number,
  body: z.infer<typeof incomingAuthorshipBodySchema>,
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    await acquireRebuildLockShared(tx);
    if (await operationExists(tx, body.operation_id)) return;
    const m = await lockedMessage(tx, id, body.expected_revision);
    if (await operationExists(tx, body.operation_id)) return;
    const lastLink = m.history.filter((h) => h.kind === 'linked').at(-1);
    const primary =
      m.primary_enrollment_id !== null
        ? m.links.find((l) => l.enrollment_id === m.primary_enrollment_id)
        : m.links.find(
            (l) =>
              l.lead_id === lastLink?.attributes.lead_id &&
              l.campaign_id === lastLink.attributes.campaign_id,
          );
    if (m.linking_status !== 'linked' || !primary)
      conflict('Confirm a primary campaign association before confirming authorship.');
    if (m.policy_version !== 'legacy' && primary.enrollment_id !== null) {
      const received = m.history.find((h) => h.kind === 'received');
      const step = received?.attributes.replied_to_step;
      await store.appendInTransaction(tx, [
        buildEvent.authorshipConfirmed({
          leadId: primary.lead_id,
          campaignId: primary.campaign_id,
          enrollmentId: primary.enrollment_id!,
          occurredAt: now,
          ...(m.relationship === 'in_thread' &&
          received?.attributes.replied_to_enrollment === primary.enrollment_id &&
          typeof step === 'number'
            ? { stepNo: step }
            : {}),
          sentiment: body.sentiment ?? null,
          attributes: {
            incoming_message_id: id,
            authorship: body.authorship,
            operation_id: body.operation_id,
          },
        }),
      ]);
    }
    await activity(tx, id, body.operation_id, 'authorship', now, {
      authorship: body.authorship,
      sentiment: body.authorship === 'human' ? (body.sentiment ?? null) : null,
    });
    await bumpMessage(tx, id);
  });
}

export async function acknowledgeIncoming(
  db: Db,
  body: z.infer<typeof incomingAckSchema>,
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    await acquireRebuildLockShared(tx);
    if (await operationExists(tx, body.operation_id)) return;
    const messages = await Promise.all(body.messages.map((r) => readMessage(tx, r.id)));
    const leads = [...new Set(messages.flatMap((m) => m?.links.map((l) => l.lead_id) ?? []))].sort(
      (a, b) => a - b,
    );
    for (const id of leads) await lockLead(tx, id);
    if (await operationExists(tx, body.operation_id)) return;
    for (const selected of body.messages.slice().sort((a, b) => a.id - b.id)) {
      const m = await lockedMessage(tx, selected.id, selected.expected_revision);
      if (m.links.length && !selected.campaign_id)
        validation('Acknowledge the selected campaign row explicitly.');
      if (
        selected.campaign_id &&
        m.links.filter((l) => l.campaign_id === selected.campaign_id).length > 1 &&
        !selected.lead_id
      )
        validation('Identify the selected lead row explicitly.');
      if (
        body.action === 'acknowledge' &&
        (m.linking_status === 'needs_linking' ||
          (await heldLinks(tx, m.id, selected.campaign_id, selected.lead_id)))
      )
        conflict('Resolve linking and make an outreach decision before acknowledging held items.');
      if (body.action === 'undo') {
        const prior = m.history
          .filter(
            (h) =>
              ['acknowledged', 'returned', 'undo_acknowledgement'].includes(h.kind) &&
              h.attributes.campaign_id === (selected.campaign_id ?? null) &&
              (!selected.lead_id ||
                h.attributes.lead_id === selected.lead_id ||
                h.attributes.lead_id === null),
          )
          .at(-1);
        if (
          !body.undo_operation_id ||
          prior?.attributes.operation_id !== body.undo_operation_id ||
          prior.kind !== 'acknowledged'
        )
          conflict('This acknowledgement has changed. Use Return to review.');
      }
      await setAcknowledged(
        tx,
        m.id,
        selected.campaign_id,
        body.action === 'acknowledge' ? now : null,
        selected.lead_id,
      );
      await activity(
        tx,
        m.id,
        body.operation_id,
        body.action === 'acknowledge'
          ? 'acknowledged'
          : body.action === 'undo'
            ? 'undo_acknowledgement'
            : 'returned',
        now,
        {
          campaign_id: selected.campaign_id ?? null,
          lead_id: selected.lead_id ?? null,
          operation_id: body.operation_id,
        },
      );
      await bumpMessage(tx, m.id);
    }
  });
}

export async function markUnrelated(
  db: Db,
  id: number,
  body: { operation_id: string; expected_revision: number },
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    await acquireRebuildLockShared(tx);
    if (await operationExists(tx, body.operation_id)) return;
    const m = await lockedMessage(tx, id, body.expected_revision);
    if (m.links.length)
      conflict(
        'A linked message must be corrected through the linking workflow. Holds will not be released by unlinking.',
      );
    await updateMessage(tx, id, null, 'unrelated');
    await activity(tx, id, body.operation_id, 'unrelated', now);
  });
}

export async function suppressLinkedAddress(
  db: Db,
  store: EventStore,
  id: number,
  body: { operation_id: string; expected_revision: number; lead_id: number; confirm: string },
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    await acquireRebuildLockShared(tx);
    const before = await readMessage(tx, id);
    if (!before) throw new IncomingReviewError('not_found', 'Incoming message not found');
    for (const leadId of [...new Set([body.lead_id, ...before.links.map((l) => l.lead_id)])].sort(
      (a, b) => a - b,
    ))
      await lockLead(tx, leadId);
    if (await operationExists(tx, body.operation_id)) return;
    const m = await lockedMessage(tx, id, body.expected_revision);
    const { lead } = await leadProtected(tx, body.lead_id);
    if (!m.links.some((l) => l.lead_id === lead.id))
      conflict('Link this message to the address before applying permanent suppression.');
    if (body.confirm !== lead.email)
      validation('Type the complete email address to confirm permanent suppression.');
    await store.appendInTransaction(tx, [
      buildEvent.addressSuppressed({
        leadId: lead.id,
        occurredAt: now,
        attributes: { incoming_message_id: id, rule: 'manual', operation_id: body.operation_id },
      }),
    ]);
    await activity(tx, id, body.operation_id, 'address_suppressed', now, { lead_id: lead.id });
  });
}
