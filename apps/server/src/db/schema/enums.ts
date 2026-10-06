// Mirrors docs/03 §1 and 0001_core.up.sql exactly. Values also exist as
// shared vocabulary in @coldemail/shared for the API contract.
import { pgEnum } from 'drizzle-orm/pg-core';

export const eventTypeEnum = pgEnum('event_type', [
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
]);
export const enrollmentStateEnum = pgEnum('enrollment_state', [
  'NEW',
  'ACTIVE',
  'REPLIED',
  'BOUNCED',
  'UNSUBSCRIBED',
  'COMPLETED',
  'STOPPED',
]);
export const sentimentEnum = pgEnum('sentiment', ['positive', 'neutral', 'negative']);
export const leadTierEnum = pgEnum('lead_tier', ['A', 'B', 'C', 'nurture']);
export const suppressionReasonEnum = pgEnum('suppression_reason', [
  'unsubscribed',
  'hard_bounce',
  'manual',
]);
export const personalizationModeEnum = pgEnum('personalization_mode', [
  'human_written',
  'template_researched',
  'template_auto',
]);
export const unsubscribeSourceEnum = pgEnum('unsubscribe_source', ['reply', 'link', 'manual']);
export const mailboxStatusEnum = pgEnum('mailbox_status', [
  'ok',
  'paused',
  'auto_paused',
  'auth_failed',
  'imap_stale',
  'provider_blocked',
  'setup_required',
]);
export const incomingClassEnum = pgEnum('incoming_class', [
  'bounce',
  'auto_reply',
  'human_reply',
  'unrelated',
]);
export const alertSeverityEnum = pgEnum('alert_severity', ['info', 'warning', 'error']);
export const campaignStatusEnum = pgEnum('campaign_status', [
  'draft',
  'active',
  'paused',
  'completed',
  'archived',
]);
