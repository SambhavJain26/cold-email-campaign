// Event catalog (docs/04 §1): zod-validated constructors are the ONLY way
// the app creates event objects — malformed events are unrepresentable.
// Per-type attribute requirements mirror docs/03 §2.
// PURE MODULE: no I/O, no clock reads — occurredAt always arrives as an argument.
import { z } from 'zod';
import { LEAD_TIERS, REPLY_DISPOSITIONS, SENTIMENTS, UNSUBSCRIBE_SOURCES } from '@coldemail/shared';

const id = z.number().int().positive();
const base = z.object({
  /** DB id once persisted; fixture seq during folding. Needed to resolve sentiment_tagged refs. */
  id: id.optional(),
  occurredAt: z.date(),
  leadId: id,
  enrollmentId: id.optional(),
  campaignId: id.optional(),
});
const enrolled_ = base.extend({
  type: z.literal('enrolled'),
  enrollmentId: id,
  campaignId: id,
  mailboxId: id.optional(),
  attributes: z
    .object({ tier: z.enum(LEAD_TIERS).nullable().default(null) })
    .default({ tier: null }),
});
const sent_ = base.extend({
  type: z.literal('sent'),
  enrollmentId: id,
  campaignId: id,
  stepNo: z.number().int().min(1),
  mailboxId: id,
  messageId: z.string().min(1),
  attributes: z.object({
    content_hash: z.string().min(1), // recycle guard (decision Q)
    variant_id: id.optional(),
    content_source: z.enum(['template', 'personalized']).optional(),
    personalized_copy_id: id.optional(),
    retry_no: z.number().int().min(1).optional(), // present when re-sending after a soft bounce
  }),
});
const delivered_ = base.extend({
  type: z.literal('delivered'),
  enrollmentId: id,
  campaignId: id,
  stepNo: z.number().int().min(1),
});
const softBounce_ = base.extend({
  type: z.literal('soft_bounce'),
  enrollmentId: id,
  campaignId: id,
  stepNo: z.number().int().min(1),
  mailboxId: id.optional(),
  reason: z.string().optional(), // DSN code + text
  attributes: z.object({ retry_no: z.number().int().min(1) }),
});
const hardBounce_ = base.extend({
  type: z.literal('hard_bounce'),
  enrollmentId: id,
  campaignId: id,
  stepNo: z.number().int().min(1),
  mailboxId: id.optional(),
  reason: z.string().optional(),
});
const humanReply_ = base.extend({
  type: z.literal('human_reply'),
  enrollmentId: id,
  campaignId: id,
  stepNo: z.number().int().min(1).optional(),
  /** Set at insert ONLY when known (auto STOP-detection → negative); else null until sentiment_tagged (decision M). */
  sentiment: z.enum(SENTIMENTS).nullable().default(null),
  attributes: z
    .object({ incoming_message_id: id.optional() }) // set by the poller from B3 on
    .default({}),
});
const autoReply_ = base.extend({
  type: z.literal('auto_reply'),
  enrollmentId: id.optional(),
  campaignId: id.optional(),
  reason: z.string().optional(), // matched OOO pattern
});
const unsubscribe_ = base.extend({
  type: z.literal('unsubscribe'),
  enrollmentId: id,
  campaignId: id,
  source: z.enum(UNSUBSCRIBE_SOURCES),
  attributes: z
    .object({ matched_keyword: z.string().optional(), data_erasure: z.boolean().optional() })
    .default({}),
});
const meetingBooked_ = base.extend({
  type: z.literal('meeting_booked'),
  enrollmentId: id,
  campaignId: id,
});
const dealWon_ = base.extend({ type: z.literal('deal_won'), enrollmentId: id, campaignId: id });
const dealLost_ = base.extend({ type: z.literal('deal_lost'), enrollmentId: id, campaignId: id });
const sentimentTagged_ = base.extend({
  type: z.literal('sentiment_tagged'),
  enrollmentId: id,
  campaignId: id,
  sentiment: z.enum(SENTIMENTS),
  attributes: z.object({
    reply_event_id: id, // the human_reply this (re)tags
    tagged_by: z.literal('human'),
  }),
});
const replyDispositioned_ = base.extend({
  type: z.literal('reply_dispositioned'),
  enrollmentId: id,
  campaignId: id,
  attributes: z.object({
    reply_event_id: id,
    incoming_message_id: id,
    disposition: z.enum(REPLY_DISPOSITIONS),
    // New records use a timezone-independent calendar date. Accept the old
    // timestamp shape so the append-only ledger remains replay-compatible.
    recontact_after: z.union([z.string().date(), z.string().datetime()]).optional(),
    dispositioned_by: z.enum(['human', 'auto']),
  }),
});

const outreachStopped_ = base.extend({
  type: z.literal('outreach_stopped'),
  enrollmentId: id,
  campaignId: id,
  reason: z.string().min(1),
  attributes: z.object({
    incoming_message_id: id,
    sender: z.string().min(1),
    matching_method: z.enum(['company_domain', 'exact_address', 'thread']),
    company_domain: z.string().nullable(),
  }),
});

const reviewRequired_ = base.extend({
  type: z.literal('incoming_review_required'),
  enrollmentId: id.optional(),
  campaignId: id.optional(),
  attributes: z.object({ incoming_message_id: id }),
});
const reviewDecided_ = base.extend({
  type: z.literal('outreach_review_decided'),
  enrollmentId: id.optional(),
  campaignId: id,
  attributes: z.object({
    action: z.enum(['continue', 'delay']),
    hold_event_ids: z.array(id),
    until: z.string().datetime().optional(),
    operation_id: z.string().min(1),
  }),
});
const sequenceStopped_ = base.extend({
  type: z.literal('sequence_stopped'),
  enrollmentId: id,
  campaignId: id,
  attributes: z.object({
    hold_event_ids: z.array(id),
    resume_due_at: z.string().datetime().nullable(),
    sequence_fingerprint: z.string().optional(),
    operation_id: z.string().min(1),
  }),
});
const sequenceRestored_ = base.extend({
  type: z.literal('sequence_restored'),
  enrollmentId: id,
  campaignId: id,
  attributes: z.object({
    blocker_event_ids: z.array(id).min(1),
    reason: z.string().min(1).max(1000),
    resume_due_at: z.string().datetime(),
    operation_id: z.string().min(1),
  }),
});
const authorshipConfirmed_ = base.extend({
  type: z.literal('incoming_authorship_confirmed'),
  enrollmentId: id,
  campaignId: id,
  stepNo: z.number().int().positive().optional(),
  sentiment: z.enum(SENTIMENTS).nullable().default(null),
  attributes: z.object({
    incoming_message_id: id,
    authorship: z.enum(['human', 'automatic', 'unsure']),
    operation_id: z.string().min(1),
  }),
});
const addressSuppressed_ = base.extend({
  type: z.literal('address_suppressed'),
  attributes: z.object({
    incoming_message_id: id.optional(),
    rule: z.enum(['manual', 'explicit_optout']),
    operation_id: z.string().min(1),
  }),
});

export const domainEventSchema = z.discriminatedUnion('type', [
  reviewRequired_,
  reviewDecided_,
  sequenceStopped_,
  sequenceRestored_,
  authorshipConfirmed_,
  addressSuppressed_,
  outreachStopped_,
  enrolled_,
  sent_,
  delivered_,
  softBounce_,
  hardBounce_,
  humanReply_,
  autoReply_,
  unsubscribe_,
  meetingBooked_,
  dealWon_,
  dealLost_,
  sentimentTagged_,
  replyDispositioned_,
]);

export type DomainEvent = z.infer<typeof domainEventSchema>;
export type EnrolledEvent = z.infer<typeof enrolled_>;
export type SentEvent = z.infer<typeof sent_>;
export type HumanReplyEvent = z.infer<typeof humanReply_>;
export type SentimentTaggedEvent = z.infer<typeof sentimentTagged_>;
export type ReplyDispositionedEvent = z.infer<typeof replyDispositioned_>;

type Input<S extends z.ZodType> = z.input<S>;

/** The constructors. Usage: buildEvent.sent({...}) — throws on malformed input. */
export const buildEvent = {
  reviewRequired: (a: Omit<Input<typeof reviewRequired_>, 'type'>) =>
    reviewRequired_.parse({ ...a, type: 'incoming_review_required' }),
  reviewDecided: (a: Omit<Input<typeof reviewDecided_>, 'type'>) =>
    reviewDecided_.parse({ ...a, type: 'outreach_review_decided' }),
  sequenceStopped: (a: Omit<Input<typeof sequenceStopped_>, 'type'>) =>
    sequenceStopped_.parse({ ...a, type: 'sequence_stopped' }),
  sequenceRestored: (a: Omit<Input<typeof sequenceRestored_>, 'type'>) =>
    sequenceRestored_.parse({ ...a, type: 'sequence_restored' }),
  authorshipConfirmed: (a: Omit<Input<typeof authorshipConfirmed_>, 'type'>) =>
    authorshipConfirmed_.parse({ ...a, type: 'incoming_authorship_confirmed' }),
  addressSuppressed: (a: Omit<Input<typeof addressSuppressed_>, 'type'>) =>
    addressSuppressed_.parse({ ...a, type: 'address_suppressed' }),
  outreachStopped: (a: Omit<Input<typeof outreachStopped_>, 'type'>) =>
    outreachStopped_.parse({ ...a, type: 'outreach_stopped' }),
  enrolled: (a: Omit<Input<typeof enrolled_>, 'type'>) =>
    enrolled_.parse({ ...a, type: 'enrolled' }),
  sent: (a: Omit<Input<typeof sent_>, 'type'>) => sent_.parse({ ...a, type: 'sent' }),
  delivered: (a: Omit<Input<typeof delivered_>, 'type'>) =>
    delivered_.parse({ ...a, type: 'delivered' }),
  softBounce: (a: Omit<Input<typeof softBounce_>, 'type'>) =>
    softBounce_.parse({ ...a, type: 'soft_bounce' }),
  hardBounce: (a: Omit<Input<typeof hardBounce_>, 'type'>) =>
    hardBounce_.parse({ ...a, type: 'hard_bounce' }),
  humanReply: (a: Omit<Input<typeof humanReply_>, 'type'>) =>
    humanReply_.parse({ ...a, type: 'human_reply' }),
  autoReply: (a: Omit<Input<typeof autoReply_>, 'type'>) =>
    autoReply_.parse({ ...a, type: 'auto_reply' }),
  unsubscribe: (a: Omit<Input<typeof unsubscribe_>, 'type'>) =>
    unsubscribe_.parse({ ...a, type: 'unsubscribe' }),
  meetingBooked: (a: Omit<Input<typeof meetingBooked_>, 'type'>) =>
    meetingBooked_.parse({ ...a, type: 'meeting_booked' }),
  dealWon: (a: Omit<Input<typeof dealWon_>, 'type'>) => dealWon_.parse({ ...a, type: 'deal_won' }),
  dealLost: (a: Omit<Input<typeof dealLost_>, 'type'>) =>
    dealLost_.parse({ ...a, type: 'deal_lost' }),
  sentimentTagged: (a: Omit<Input<typeof sentimentTagged_>, 'type'>) =>
    sentimentTagged_.parse({ ...a, type: 'sentiment_tagged' }),
  replyDispositioned: (a: Omit<Input<typeof replyDispositioned_>, 'type'>) =>
    replyDispositioned_.parse({ ...a, type: 'reply_dispositioned' }),
};

/** Validate an untrusted raw object (fixture line, DB row) into a DomainEvent. */
export function parseDomainEvent(raw: unknown): DomainEvent {
  return domainEventSchema.parse(raw);
}
