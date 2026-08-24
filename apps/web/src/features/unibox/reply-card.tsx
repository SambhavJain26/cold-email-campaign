import { useState } from 'react';
import { BellPlus, CalendarCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  REPLY_DISPOSITIONS,
  SENTIMENTS,
  type ReplyDisposition,
  type Sentiment,
  type UniboxItemDto,
} from '@coldemail/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SentimentTag } from '@/components/shared/sentiment-tag';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useMeetingBooked,
  useCreateReminder,
  useDispositionReply,
  useTagSentiment,
  useUnsubscribe,
} from '@/api/mutations/unibox';

const GLYPH: Record<Sentiment, string> = { positive: '🟢', neutral: '⚪', negative: '🔴' };
const DISPOSITION_LABEL: Record<ReplyDisposition, string> = {
  interested: 'Interested',
  not_interested: 'Not interested — suppress',
  not_now: 'Not now — hold until date',
  wrong_person: 'Wrong person — suppress',
  referred: 'Referred me',
  explicit_unsubscribe: 'Explicit opt-out — suppress',
  other: 'Other',
};

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
  const dispositionReply = useDispositionReply();
  const createReminder = useCreateReminder();
  const unsubscribe = useUnsubscribe();
  const [reminderDate, setReminderDate] = useState('');
  const [reminderNote, setReminderNote] = useState('');
  const [reminderOpen, setReminderOpen] = useState(false);
  const [disposition, setDisposition] = useState<ReplyDisposition | ''>(item.disposition ?? '');
  const [recontactDate, setRecontactDate] = useState(item.recontact_after?.slice(0, 10) ?? '');
  const [minimumRecontactDate] = useState(() =>
    new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  );

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
        <p className="text-xs text-muted-foreground">↳ sequence stopped after this reply</p>
      )}

      {item.auto_unsubscribed && (
        <p className="text-xs text-warning" data-testid="auto-unsub-caption">
          → auto-unsubscribed ✓ · counts toward reply AND unsubscribe rate
        </p>
      )}

      {!isAutoReply && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
            <div className="min-w-52 flex-1 space-y-1">
              <label
                className="text-xs font-medium"
                htmlFor={`disposition-${item.incoming_message_id}`}
              >
                Reply outcome
              </label>
              <Select
                value={disposition}
                onValueChange={(value) => setDisposition(value as ReplyDisposition)}
              >
                <SelectTrigger id={`disposition-${item.incoming_message_id}`} size="sm">
                  <SelectValue placeholder="Review and choose…" />
                </SelectTrigger>
                <SelectContent>
                  {REPLY_DISPOSITIONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {DISPOSITION_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {disposition === 'not_now' && (
              <div className="space-y-1">
                <label
                  className="text-xs font-medium"
                  htmlFor={`recontact-${item.incoming_message_id}`}
                >
                  Do not contact before
                </label>
                <Input
                  id={`recontact-${item.incoming_message_id}`}
                  type="date"
                  className="h-8"
                  min={minimumRecontactDate}
                  value={recontactDate}
                  onChange={(event) => setRecontactDate(event.target.value)}
                />
              </div>
            )}
            <Button
              size="sm"
              disabled={
                disposition === '' ||
                (disposition === 'not_now' && recontactDate === '') ||
                dispositionReply.isPending
              }
              onClick={() => {
                if (disposition === '') return;
                dispositionReply.mutate(
                  {
                    incomingMessageId: item.incoming_message_id,
                    disposition,
                    ...(disposition === 'not_now' ? { recontactAfter: recontactDate } : {}),
                  },
                  {
                    onSuccess: () => toast.success('Reply outcome recorded'),
                  },
                );
              }}
            >
              Save outcome
            </Button>
          </div>

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

            <Popover open={reminderOpen} onOpenChange={setReminderOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="xs">
                  <BellPlus className="size-3.5" /> Add reminder…
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Creates an operator task only. It never sends or authorizes contact.
                </p>
                <Input
                  type="date"
                  aria-label="Reminder due date"
                  className="h-8"
                  min={new Date().toISOString().slice(0, 10)}
                  value={reminderDate}
                  onChange={(event) => setReminderDate(event.target.value)}
                />
                <Input
                  aria-label="Reminder note"
                  placeholder="Optional note"
                  className="h-8"
                  value={reminderNote}
                  onChange={(event) => setReminderNote(event.target.value)}
                />
                <Button
                  size="xs"
                  className="w-full"
                  disabled={reminderDate === '' || createReminder.isPending}
                  onClick={() =>
                    createReminder.mutate(
                      {
                        incomingMessageId: item.incoming_message_id,
                        dueDate: reminderDate,
                        note: reminderNote.trim() || null,
                      },
                      {
                        onSuccess: () => {
                          toast.success(`Reminder set for ${reminderDate}`);
                          setReminderOpen(false);
                        },
                      },
                    )
                  }
                >
                  Save reminder
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
        </div>
      )}
    </article>
  );
}
