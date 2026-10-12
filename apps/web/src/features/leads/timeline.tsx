import type { EventViewDto } from '@coldemail/shared';
import { formatDateTime } from '@/lib/format';

/** Event-type glyphs for the detail timeline (docs/12 §2 — newest first). */
const ICON: Record<EventViewDto['type'], string> = {
  schedule_recalculated: '📅',
  incoming_review_required: '⏸️',
  outreach_review_decided: '📋',
  sequence_stopped: '⏹️',
  sequence_restored: '↩️',
  incoming_authorship_confirmed: '💬',
  address_suppressed: '🚫',
  outreach_stopped: '⏹️',
  enrolled: '➕',
  sent: '📤',
  delivered: '✅',
  soft_bounce: '↩️',
  hard_bounce: '❌',
  human_reply: '💬',
  auto_reply: '🤖',
  unsubscribe: '🚫',
  meeting_booked: '📅',
  deal_won: '🏆',
  deal_lost: '📉',
  sentiment_tagged: '🏷️',
  reply_dispositioned: '📋',
};

export function Timeline({ events }: { events: EventViewDto[] }) {
  const newestFirst = [...events].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  if (newestFirst.length === 0) {
    return <p className="text-sm text-muted-foreground">No events yet.</p>;
  }
  return (
    <ol className="space-y-0" data-testid="timeline">
      {newestFirst.map((event) => (
        <li
          key={event.id}
          className="flex items-baseline gap-3 border-l-2 border-border py-1.5 pl-4"
        >
          <span aria-hidden>{ICON[event.type]}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              <span className="font-medium">{event.type.replaceAll('_', ' ')}</span>
              {event.type === 'outreach_stopped' && (
                <span>
                  {' '}
                  · Incoming email from {String(event.attributes.sender ?? 'company domain')} (
                  {String(event.attributes.matching_method ?? 'domain match')})
                </span>
              )}
              {event.step_no !== null && (
                <span className="text-muted-foreground"> · step {event.step_no}</span>
              )}
              {event.mailbox_id !== null && (
                <span className="text-muted-foreground"> · mailbox {event.mailbox_id}</span>
              )}
            </p>
          </div>
          <time className="shrink-0 text-xs text-muted-foreground">
            {formatDateTime(event.occurred_at)}
          </time>
        </li>
      ))}
    </ol>
  );
}
