import { useState } from 'react';
import { CalendarCheck, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { SENTIMENTS, type Sentiment, type UniboxItemDto } from '@coldemail/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SentimentTag } from '@/components/shared/sentiment-tag';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useMeetingBooked,
  useSnooze,
  useTagSentiment,
  useUnsubscribe,
} from '@/api/mutations/unibox';

const GLYPH: Record<Sentiment, string> = { positive: '🟢', neutral: '⚪', negative: '🔴' };

/** F6.2/F6.5 — one reply card, the walkthrough's Stage-6 layout. */
export function ReplyCard({
  item,
  bucket,
  tagOnlyMode,
  onOpenThread,
}: {
  item: UniboxItemDto;
  bucket: 'human' | 'auto_reply';
  /** settings.optout_detection === 'tag_only' (decision F escape hatch). */
  tagOnlyMode: boolean;
  onOpenThread: () => void;
}) {
  const tag = useTagSentiment();
  const meeting = useMeetingBooked();
  const snooze = useSnooze();
  const unsubscribe = useUnsubscribe();
  const [snoozeUntil, setSnoozeUntil] = useState('');
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  const isAutoReply = bucket === 'auto_reply';

  return (
    <article
      className="space-y-2 rounded-lg border border-border bg-card p-4"
      data-testid={`reply-card-${item.incoming_message_id}`}
    >
      <button
        type="button"
        className="w-full space-y-1 text-left"
        onClick={onOpenThread}
        aria-label={`Open thread with ${item.lead.name}`}
      >
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-medium">{item.lead.name}</span>
          {item.lead.company && (
            <span className="text-xs text-muted-foreground">— {item.lead.company}</span>
          )}
          <span className="text-xs text-muted-foreground">
            {item.received_at ? formatRelativeTime(item.received_at) : 'unknown time'}
          </span>
          {item.step_no !== null && (
            <Badge variant="outline" className="text-[10px]">
              step {item.step_no}
            </Badge>
          )}
          {item.meeting_booked && (
            <Badge className="text-[10px]" data-testid="meeting-badge">
              📅 meeting booked ✓
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{item.snippet ?? '(no preview)'}</p>
      </button>

      {isAutoReply ? (
        <p className="text-xs text-muted-foreground" data-testid="auto-reply-caption">
          Auto-reply — NOT counted as a reply. Sequence continues normally.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {item.sequence_continues
            ? '↳ this sequence continues: stop on reply is disabled'
            : '↳ sequence stopped after this reply'}
        </p>
      )}

      {item.auto_unsubscribed && (
        <p className="text-xs text-warning" data-testid="auto-unsub-caption">
          → auto-unsubscribed ✓ · counts toward reply AND unsubscribe rate
        </p>
      )}

      {!isAutoReply && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label="Tag sentiment">
            {SENTIMENTS.map((sentiment) => (
              <Button
                key={sentiment}
                variant="outline"
                size="xs"
                aria-label={`Tag ${sentiment}`}
                aria-pressed={item.effective_sentiment === sentiment}
                disabled={tag.isPending || item.effective_sentiment === sentiment}
                className={cn(
                  'px-2',
                  item.effective_sentiment === sentiment && 'border-primary bg-accent',
                )}
                onClick={() =>
                  tag.mutate({ incomingMessageId: item.incoming_message_id, sentiment })
                }
              >
                {GLYPH[sentiment]}
              </Button>
            ))}
          </div>

          {item.effective_sentiment !== null && (
            <SentimentTag sentiment={item.effective_sentiment} />
          )}
          {item.effective_sentiment === null && item.suggested_sentiment !== null && (
            <SentimentTag sentiment={item.suggested_sentiment} suggested />
          )}

          {!item.meeting_booked && (
            <Button
              variant="outline"
              size="xs"
              disabled={meeting.isPending}
              onClick={() =>
                meeting.mutate(item.enrollment_id, {
                  onSuccess: () => toast.success('Meeting booked'),
                })
              }
            >
              <CalendarCheck className="size-3.5" /> Mark meeting booked
            </Button>
          )}

          <Popover open={snoozeOpen} onOpenChange={setSnoozeOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="xs">
                <Clock className="size-3.5" /> Snooze…
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 space-y-2">
              <p className="text-xs text-muted-foreground">
                Hold the next step until this date — scheduling only, no event.
              </p>
              <Input
                type="date"
                aria-label="Snooze until"
                className="h-8"
                value={snoozeUntil}
                onChange={(event) => setSnoozeUntil(event.target.value)}
              />
              <Button
                size="xs"
                className="w-full"
                disabled={snoozeUntil === '' || snooze.isPending}
                onClick={() =>
                  snooze.mutate(
                    {
                      enrollmentId: item.enrollment_id,
                      until: new Date(`${snoozeUntil}T00:00:00Z`).toISOString(),
                    },
                    {
                      onSuccess: () => {
                        toast.success(`Snoozed until ${snoozeUntil}`);
                        setSnoozeOpen(false);
                      },
                    },
                  )
                }
              >
                Snooze
              </Button>
            </PopoverContent>
          </Popover>

          {/* decision F escape hatch: with auto-STOP off, negative replies are
              unsubscribed by hand — the button only exists in tag_only mode. */}
          {tagOnlyMode && item.effective_sentiment === 'negative' && !item.auto_unsubscribed && (
            <Button
              variant="outline"
              size="xs"
              className="text-destructive"
              disabled={unsubscribe.isPending}
              data-testid="manual-unsubscribe"
              onClick={() =>
                unsubscribe.mutate(item.enrollment_id, {
                  onSuccess: () => toast.success('Lead unsubscribed and suppressed'),
                })
              }
            >
              Unsubscribe lead
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
