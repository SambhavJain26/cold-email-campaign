// Shared domain vocabulary (docs/02 §1): the enums both server and web speak.
// Must stay in lockstep with the Postgres enums in 0001_core / docs/03 §1.

export const EVENT_TYPES = [
  'schedule_recalculated',
  'enrolled',
  'sent',
  'delivered',
  'soft_bounce',
  'hard_bounce',
  'human_reply',
  'auto_reply',
  'unsubscribe',
  'meeting_booked',
  'deal_won',
  'deal_lost',
  'sentiment_tagged',
  'reply_dispositioned',
  'outreach_stopped',
  'incoming_review_required',
  'outreach_review_decided',
  'sequence_stopped',
  'sequence_restored',
  'incoming_authorship_confirmed',
  'address_suppressed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ENROLLMENT_STATES = [
  'NEW',
  'ACTIVE',
  'REPLIED',
  'BOUNCED',
  'UNSUBSCRIBED',
  'COMPLETED',
  'STOPPED',
] as const;
export type EnrollmentState = (typeof ENROLLMENT_STATES)[number];

export const TERMINAL_STATES = [
  'REPLIED',
  'BOUNCED',
  'UNSUBSCRIBED',
  'COMPLETED',
  'STOPPED',
] as const;
export type TerminalState = (typeof TERMINAL_STATES)[number];

/** Spec Part 3: UNSUBSCRIBED > BOUNCED > REPLIED > COMPLETED. */
export const TERMINAL_PRIORITY: Record<TerminalState, number> = {
  UNSUBSCRIBED: 4,
  BOUNCED: 3,
  REPLIED: 2,
  COMPLETED: 1,
  STOPPED: 1.5,
};

export function isTerminal(state: EnrollmentState): state is TerminalState {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

export const SENTIMENTS = ['positive', 'neutral', 'negative'] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const REPLY_DISPOSITIONS = [
  'interested',
  'not_interested',
  'not_now',
  'wrong_person',
  'referred',
  'explicit_unsubscribe',
  'other',
] as const;
export type ReplyDisposition = (typeof REPLY_DISPOSITIONS)[number];

/** "Best" sentiment ordering for best_reply_sentiment: positive > neutral > negative. */
export const SENTIMENT_RANK: Record<Sentiment, number> = { positive: 3, neutral: 2, negative: 1 };

/** Writable/current lead tiers. Historical enrollment snapshots may retain C/nurture. */
export const CURRENT_LEAD_TIERS = ['A', 'B'] as const;
export type CurrentLeadTier = (typeof CURRENT_LEAD_TIERS)[number];
export const HISTORICAL_LEAD_TIERS = ['A', 'B', 'C', 'nurture'] as const;
/** @deprecated Use CurrentLeadTier for lead writes; this remains for historical analytics. */
export const LEAD_TIERS = HISTORICAL_LEAD_TIERS;
export type LeadTier = (typeof HISTORICAL_LEAD_TIERS)[number];

export const OUTREACH_STATUSES = ['standard', 'nurture'] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export const UNSUBSCRIBE_SOURCES = ['reply', 'link', 'manual'] as const;
export type UnsubscribeSource = (typeof UNSUBSCRIBE_SOURCES)[number];

export const PERSONALIZATION_MODES = [
  'human_written',
  'template_researched',
  'template_auto',
] as const;
export type PersonalizationMode = (typeof PERSONALIZATION_MODES)[number];

export const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'completed', 'archived'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const MAILBOX_STATUSES = [
  'ok',
  'paused',
  'auto_paused',
  'auth_failed',
  'imap_stale',
  'provider_blocked',
  'setup_required',
] as const;
export type MailboxStatus = (typeof MAILBOX_STATUSES)[number];

export const INCOMING_CLASSES = ['bounce', 'auto_reply', 'human_reply', 'unrelated'] as const;
export type IncomingClass = (typeof INCOMING_CLASSES)[number];

export const ALERT_SEVERITIES = ['info', 'warning', 'error'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];
