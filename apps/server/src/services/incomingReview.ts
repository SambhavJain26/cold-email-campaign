import type { Db } from '../db/client';
import type { IncomingMessage } from '../transport/types';
import type { EventStore } from './eventStore';
import { acquireRebuildLockShared, lockLead, lockEnrollment } from '../db/repos/locksRepo';
import { getLeadByEmail } from '../db/repos/leadsRepo';
import { latestForLead } from '../db/repos/enrollmentsRepo';
import {
  nextIncomingMessageId,
  insertIncomingMessage,
  allByMessageId,
} from '../db/repos/incomingMessagesRepo';
import {
  matchIncoming,
  lockIncoming,
  seenLocation,
  recordLocation,
  saveContent,
  linkTarget,
  activity,
  setResultingEvents,
} from '../db/repos/incomingReviewRepo';
import { setCursor } from '../db/repos/pollCursorsRepo';
import { getSettings } from '../db/repos/settingsRepo';
import { buildEvent, type DomainEvent } from '../domain/events';
import {
  automationLabel,
  explicitOptOut,
  extractNewText,
  MAX_INCOMING_CONTENT_BYTES,
} from '../poller/reviewText';
import { classify } from '../poller/classifier';
import { findReplyCandidates, saveReplyCandidates } from '../db/repos/replyCandidatesRepo';

/** Production intake. Meaning beyond explicit opt-out belongs to the operator. */
export async function ingestIncoming(
  db: Db,
  store: EventStore,
  input: IncomingMessage,
  now: Date,
): Promise<{ duplicate: boolean; classification: string; bounceMailbox?: number }> {
  const m = { ...input };
  if (
    Buffer.byteLength(m.bodyText) + Buffer.byteLength(m.bodyHtml ?? '') >
    MAX_INCOMING_CONTENT_BYTES
  ) {
    m.bodyText = '';
    m.bodyHtml = undefined;
    m.contentStatus = 'oversized';
  }
  return db.transaction(async (tx) => {
    await acquireRebuildLockShared(tx);
    await lockIncoming(
      tx,
      m.messageId ?? `${m.mailboxId}:${m.folder}:${m.uidValidity ?? 'mock'}:${m.uid}`,
    );
    if (await seenLocation(tx, m)) return { duplicate: true, classification: 'duplicate' };
    const copies = m.messageId ? await allByMessageId(tx, m.messageId) : [];
    const original = copies.find(
      (copy) => copy.fromAddress === m.from && copy.subject === m.subject,
    );
    if (original) {
      await recordLocation(tx, m, original.canonicalId ?? original.id);
      await setCursor(tx, m.mailboxId, m.folder, m.uid, m.uidValidity);
      return { duplicate: true, classification: original.classification };
    }
    const bounce = m.isDSN || /^(mailer-daemon|postmaster)@/i.test(m.from);
    if (bounce && m.dsnRecipient) {
      const recipient = await getLeadByEmail(tx, m.dsnRecipient);
      if (recipient) {
        await lockLead(tx, recipient.id);
        const enrollment = await latestForLead(tx, recipient.id);
        if (enrollment) await lockEnrollment(tx, enrollment.id);
      }
    }
    let match =
      bounce || copies.length
        ? {
            leadId: null,
            primary: null,
            step: null,
            method: bounce ? 'technical' : 'conflicting_identity',
            targets: [],
            confidentSender: false,
          }
        : await matchIncoming(tx, m);
    if (match.leadId) {
      await lockLead(tx, match.leadId);
      match = await matchIncoming(tx, m);
    }
    const id = await nextIncomingMessageId(tx);
    const candidates = !bounce && !match.leadId ? await findReplyCandidates(tx, m) : [];
    const extracted = extractNewText(m.bodyText);
    // HTML quote structures that the plain-text converter cannot preserve are uncertain.
    const unsafeQuotes =
      !!m.bodyHtml &&
      /<blockquote|gmail_quote|moz-cite-prefix|\bid=["']?(?:divRplyFwdMsg|appendonsend)/i.test(
        m.bodyHtml,
      ) &&
      !extracted.quotedText;
    const optout =
      match.confidentSender &&
      explicitOptOut(extracted.newText, extracted.uncertain || unsafeQuotes);
    const automated = automationLabel(m);
    const legacyBounce = bounce
      ? await classify(tx, m, { settings: await getSettings(tx), now, incomingMessageId: id })
      : null;
    const classification = bounce
      ? 'bounce'
      : automated === 'automatic'
        ? 'auto_reply'
        : match.leadId
          ? 'human_reply'
          : 'unrelated';
    const primary = bounce ? (legacyBounce?.matchedEnrollmentId ?? null) : match.primary;
    await insertIncomingMessage(tx, {
      id,
      mailboxId: m.mailboxId,
      imapUid: m.uid,
      messageId: m.messageId ?? null,
      inReplyTo: m.inReplyTo ?? null,
      fromAddress: m.from,
      subject: m.subject,
      receivedAt: m.receivedAt,
      processedAt: now,
      classification,
      matchedEnrollmentId: primary,
      primaryEnrollmentId: primary,
      resultingEventIds: [],
      dsnStatus: m.dsnStatus ?? null,
      policyVersion: 'review_v1',
      automation: automated,
      relationship:
        match.method === 'references' ? 'in_thread' : match.leadId ? 'separate' : 'unmatched',
      linkingStatus: bounce ? 'technical' : match.leadId ? 'linked' : 'needs_linking',
      snippet: null,
      bodyText: null,
    });
    // Save bodies only for confirmed conversations and qualifying suggestions;
    // other mailbox traffic retains identity metadata.
    await saveContent(
      tx,
      id,
      !bounce && !match.leadId && !candidates.length
        ? { ...m, bodyText: '', bodyHtml: undefined, contentStatus: 'unavailable' }
        : m,
      !bounce && !match.leadId && !candidates.length ? '' : extracted.newText,
      !bounce && !match.leadId && !candidates.length ? '' : extracted.quotedText,
    );
    await saveReplyCandidates(tx, id, candidates);
    await recordLocation(tx, m, id);
    const events: DomainEvent[] = legacyBounce?.events ?? [];
    if (!bounce && match.leadId) {
      for (const e of match.targets) {
        await linkTarget(tx, id, e.lead_id, e.campaign_id, e.id, match.method);
        // Terminal reducers retain their state; the response fact still guards future recontact.
        if (!optout)
          events.push(
            buildEvent.reviewRequired({
              leadId: e.lead_id,
              campaignId: e.campaign_id,
              enrollmentId: e.id,
              occurredAt: now,
              attributes: { incoming_message_id: id },
            }),
          );
      }
      if (optout)
        events.push(
          buildEvent.addressSuppressed({
            leadId: match.leadId,
            occurredAt: now,
            ...(primary
              ? {
                  enrollmentId: primary,
                  campaignId: match.targets.find((e) => e.id === primary)!.campaign_id,
                }
              : {}),
            attributes: {
              incoming_message_id: id,
              rule: 'explicit_optout',
              operation_id: `incoming:${id}`,
            },
          }),
        );
    }
    const eventIds = await store.appendInTransaction(tx, events, {
      patches: legacyBounce?.patches,
    });
    await setResultingEvents(tx, id, eventIds);
    await activity(tx, id, `incoming:${id}`, 'received', now, {
      matching_method: match.method,
      replied_to_step: match.step,
      replied_to_enrollment: match.primary,
      optout_rule: optout || null,
      holds: events.flatMap((event, index) =>
        event.type === 'incoming_review_required'
          ? [{ id: eventIds[index], enrollment_id: event.enrollmentId }]
          : [],
      ),
    });
    await setCursor(tx, m.mailboxId, m.folder, m.uid, m.uidValidity);
    const hard = events.find((e) => e.type === 'hard_bounce');
    return {
      duplicate: false,
      classification,
      ...(hard?.type === 'hard_bounce' && hard.mailboxId ? { bounceMailbox: hard.mailboxId } : {}),
    };
  });
}
