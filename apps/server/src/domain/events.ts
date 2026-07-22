// Event catalog (docs/04 §1): zod-validated constructors are the ONLY way
// the app creates event objects - malformed events are unrepresentable.
// Per-type attribute requirements mirror docs/03 §2.
// PURE MODULE: no I/O, no clock reads - occurredAt always arrives as an argument.
import { z } from 'zod';
import { SENTIMENTS, UNSUBSCRIBE_SOURCES, LEAD_TIERS } from '@coldemail/shared';

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
  attributes: z.object({ tier: z.enum(LEAD_TIERS).nullable().default(null) }).default({ tier: null }),
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
  attributes: z.object({ matched_keyword: z.string().optional() }).default({}),
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

export const domainEventSchema = z.discriminatedUnion('type', [
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
]);

export type DomainEvent = z.infer<typeof domainEventSchema>;
export type EnrolledEvent = z.infer<typeof enrolled_>;
export type SentEvent = z.infer<typeof sent_>;
export type HumanReplyEvent = z.infer<typeof humanReply_>;
export type SentimentTaggedEvent = z.infer<typeof sentimentTagged_>;

type Input<S extends z.ZodType> = z.input<S>;

/** The constructors. Usage: buildEvent.sent({...}) - throws on malformed input. */
export const buildEvent = {
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
};

/** Validate an untrusted raw object (fixture line, DB row) into a DomainEvent. */
export function parseDomainEvent(raw: unknown): DomainEvent {
  return domainEventSchema.parse(raw);
}
