// The 4-bucket classifier (B3.11, docs/07 §2): STRICT order, first match
// wins — bounce → auto-reply → human reply → unrelated. Threading is
// header-based only (In-Reply-To, then References newest→oldest against
// sent_messages) — NEVER subject-line matching (spec Part 6).
import type { IncomingClass, Sentiment } from '@coldemail/shared';
import type { Db } from '../db/client';
import type { IncomingMessage } from '../transport/types';
import type { SettingsRow } from '../db/repos/settingsRepo';
import type { SchedulingPatch } from '../services/eventStore';
import { buildEvent, type DomainEvent } from '../domain/events';
import { getLeadByEmail } from '../db/repos/leadsRepo';
import {
  getById as getEnrollment,
  latestForLead,
  type EnrollmentRow,
} from '../db/repos/enrollmentsRepo';
import { findSentByMessageIds, latestSentToLead } from '../db/repos/sentMessagesRepo';
import { detectStop, unquotedText } from './stopMatcher';

/** Soft-bounce retry delay for the SAME step (docs/07 §2.1; default 4 h). */
export const SOFT_RETRY_DELAY_MS = 4 * 3_600_000;

const BOUNCE_FROM = /^(mailer-daemon|postmaster)@/i;
const OOO_SUBJECT =
  /(out of (the )?office|automatic reply|auto[- ]?reply|away from|on vacation|on leave|maternity|paternity)/i;

export interface ClassifyContext {
  settings: SettingsRow;
  now: Date;
  /** Pre-allocated incoming_messages id — human_reply's attributes point at it. */
  incomingMessageId: number;
}

export interface ClassificationResult {
  classification: IncomingClass;
  events: DomainEvent[];
  matchedEnrollmentId?: number;
  patches?: SchedulingPatch[];
  suggestedSentiment?: Sentiment;
  snippet: string;
}

export async function classify(
  db: Db,
  m: IncomingMessage,
  ctx: ClassifyContext,
): Promise<ClassificationResult> {
  const snippet = unquotedText(m.bodyText).slice(0, 300);

  // ── 1. BOUNCE ──────────────────────────────────────────────────────────────
  if (m.isDSN || BOUNCE_FROM.test(m.from)) {
    return { ...(await classifyBounce(db, m, ctx)), snippet };
  }

  // ── 2. AUTO-REPLY / OOO ───────────────────────────────────────────────────
  const autoSubmitted = m.headers['auto-submitted'];
  const isAutoReply =
    (autoSubmitted !== undefined && autoSubmitted.toLowerCase() !== 'no') ||
    'x-autoreply' in m.headers ||
    'x-autorespond' in m.headers ||
    OOO_SUBJECT.test(m.subject);
  if (isAutoReply) {
    const match = await matchThread(db, m);
    if (!match) return { classification: 'auto_reply', events: [], snippet };
    const pattern =
      autoSubmitted !== undefined
        ? 'auto-submitted'
        : (OOO_SUBJECT.exec(m.subject)?.[1] ?? 'x-autoreply');
    return {
      classification: 'auto_reply',
      matchedEnrollmentId: match.enrollment.id,
      // Sequence NOT stopped — OOO is not engagement (spec Part 6).
      events: [
        buildEvent.autoReply({
          leadId: match.enrollment.leadId,
          enrollmentId: match.enrollment.id,
          campaignId: match.enrollment.campaignId,
          occurredAt: ctx.now,
          reason: pattern,
        }),
      ],
      snippet,
    };
  }

  // ── 3. HUMAN REPLY ────────────────────────────────────────────────────────
  const match = await matchThread(db, m);
  if (match) {
    const { enrollment, stepNo } = match;
    const events: DomainEvent[] = [];
    let sentiment: Sentiment | null = null;

    const stop =
      ctx.settings.optoutDetection === 'auto' ? detectStop(m.bodyText) : { matched: false };
    if (stop.matched) sentiment = 'negative'; // known at insert time — decision M

    events.push(
      buildEvent.humanReply({
        leadId: enrollment.leadId,
        enrollmentId: enrollment.id,
        campaignId: enrollment.campaignId,
        occurredAt: ctx.now,
        stepNo,
        sentiment,
        attributes: { incoming_message_id: ctx.incomingMessageId },
      }),
    );
    if (stop.matched) {
      events.push(
        buildEvent.unsubscribe({
          leadId: enrollment.leadId,
          enrollmentId: enrollment.id,
          campaignId: enrollment.campaignId,
          occurredAt: ctx.now,
          source: 'reply',
          attributes: { matched_keyword: stop.keyword },
        }),
      );
    }
    return {
      classification: 'human_reply',
      matchedEnrollmentId: enrollment.id,
      events,
      snippet,
    };
  }

  // ── 4. UNRELATED ──────────────────────────────────────────────────────────
  return { classification: 'unrelated', events: [], snippet };
}

/** Threading walk (docs/07 §4): In-Reply-To first, then References newest→oldest. */
async function matchThread(
  db: Db,
  m: IncomingMessage,
): Promise<{ enrollment: EnrollmentRow; stepNo: number } | null> {
  const candidates: string[] = [];
  if (m.inReplyTo) candidates.push(m.inReplyTo);
  if (m.references) candidates.push(...[...m.references].reverse());
  if (candidates.length === 0) return null;

  const hits = await findSentByMessageIds(db, candidates);
  for (const candidate of candidates) {
    const sm = hits.get(candidate);
    if (!sm) continue;
    const enrollment = await getEnrollment(db, sm.enrollmentId);
    if (!enrollment) continue;
    return { enrollment, stepNo: sm.stepNo };
  }
  return null;
}

async function classifyBounce(
  db: Db,
  m: IncomingMessage,
  ctx: ClassifyContext,
): Promise<Omit<ClassificationResult, 'snippet'>> {
  const status = m.dsnStatus;
  const recipient = m.dsnRecipient;
  if (!status || !recipient) {
    return { classification: 'bounce', events: [] }; // unparseable DSN — logged, visible in debug
  }

  const lead = await getLeadByEmail(db, recipient);
  if (!lead) return { classification: 'bounce', events: [] }; // unmatched recipient

  const enrollment = await latestForLead(db, lead.id);
  if (!enrollment) return { classification: 'bounce', events: [] };

  // Refine step_no via the latest send to that lead from this mailbox.
  const sm =
    (await latestSentToLead(db, lead.id, m.mailboxId)) ?? (await latestSentToLead(db, lead.id));
  const stepNo = sm?.stepNo ?? Math.max(1, enrollment.currentStepNo - 1);
  const reason = `${status} ${firstDiagnosticLine(m.bodyText)}`.trim();

  if (status.startsWith('5')) {
    return {
      classification: 'bounce',
      matchedEnrollmentId: enrollment.id,
      events: [
        buildEvent.hardBounce({
          leadId: lead.id,
          enrollmentId: enrollment.id,
          campaignId: enrollment.campaignId,
          occurredAt: ctx.now,
          stepNo,
          mailboxId: m.mailboxId,
          reason,
        }),
      ],
    };
  }

  // 4.x.x — soft bounce; re-queue the SAME step after the retry delay unless
  // retries are exhausted (the reducer terminals it; eventStore then drops
  // the nextSendAt patch).
  const retryNo = enrollment.softBounceRetries + 1;
  const retryable = retryNo <= ctx.settings.softRetryMax;
  return {
    classification: 'bounce',
    matchedEnrollmentId: enrollment.id,
    events: [
      buildEvent.softBounce({
        leadId: lead.id,
        enrollmentId: enrollment.id,
        campaignId: enrollment.campaignId,
        occurredAt: ctx.now,
        stepNo,
        mailboxId: m.mailboxId,
        reason,
        attributes: { retry_no: retryNo },
      }),
    ],
    patches: retryable
      ? [
          {
            enrollmentId: enrollment.id,
            nextSendAt: new Date(ctx.now.getTime() + SOFT_RETRY_DELAY_MS),
          },
        ]
      : undefined,
  };
}

function firstDiagnosticLine(body: string): string {
  const m = /^Diagnostic-Code:\s*(.+)$/im.exec(body);
  return m?.[1]?.slice(0, 200) ?? '';
}
