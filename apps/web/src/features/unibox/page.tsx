import { useState } from 'react';
import { SENTIMENTS, type Sentiment } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/empty-state';
import { CollectionPagination } from '@/components/shared/collection-pagination';
import { useReminders, useUnibox } from '@/api/queries/unibox';
import { usePatchReminder } from '@/api/mutations/unibox';
import { useSettings } from '@/api/queries/settings';
import { useMailboxes } from '@/api/queries/mailboxes';
import { ReplyCard } from './reply-card';
import { ThreadView } from './thread-view';

const GLYPH: Record<Sentiment, string> = { positive: '🟢', neutral: '⚪', negative: '🔴' };

/** F6.1 — Unibox feed (docs/12 §7): human / auto-reply tabs + sentiment filters. */
export default function UniboxPage() {
  const [view, setView] = useState<'human' | 'auto_reply' | 'reminders'>('human');
  const [page, setPage] = useState(1);
  const [reminderView, setReminderView] = useState<'due_today' | 'upcoming' | 'overdue'>(
    'due_today',
  );
  const [sentiment, setSentiment] = useState<Sentiment | undefined>(undefined);
  const [unhandledOnly, setUnhandledOnly] = useState(false);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [mailboxId, setMailboxId] = useState<string>('all');

  const settings = useSettings();
  const mailboxes = useMailboxes();
  const tagOnlyMode = settings.data?.optout_detection === 'tag_only';
  const bucket = view === 'auto_reply' ? 'auto_reply' : 'human';

  const { data, isPending, isError, refetch } = useUnibox({
    bucket,
    page,
    per_page: 50,
    sentiment: view === 'human' ? sentiment : undefined,
    unhandled: view === 'human' && unhandledOnly ? true : undefined,
    mailbox_id: mailboxId === 'all' ? undefined : Number(mailboxId),
  });
  const reminders = useReminders({ page, per_page: 50, view: reminderView, status: 'open' });
  const patchReminder = usePatchReminder();

  const switchBucket = (next: string) => {
    setView(next === 'auto_reply' ? 'auto_reply' : next === 'reminders' ? 'reminders' : 'human');
    setPage(1);
    setSentiment(undefined);
    setUnhandledOnly(false);
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Unibox</h1>
          <p className="text-xs text-muted-foreground">All campaigns</p>
        </div>
        {tagOnlyMode && (
          <span className="text-xs text-muted-foreground" data-testid="tag-only-mode">
            Opt-out detection is <strong>tag_only</strong> — STOP replies are tagged, never
            auto-suppressed. Unsubscribe negatives by hand.
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Tabs value={view} onValueChange={switchBucket}>
          <TabsList>
            <TabsTrigger value="human">Human replies</TabsTrigger>
            <TabsTrigger value="auto_reply">Auto-replies (OOO)</TabsTrigger>
            <TabsTrigger value="reminders">
              Reminders
              {(reminders.data?.open_count ?? 0) > 0 ? ` (${reminders.data!.open_count})` : ''}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {view !== 'reminders' && (
          <Select
            value={mailboxId}
            onValueChange={(value) => {
              setMailboxId(value);
              setPage(1);
            }}
          >
            <SelectTrigger size="sm" className="w-60" aria-label="Filter by mailbox">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All mailboxes</SelectItem>
              {(mailboxes.data?.items ?? []).map((mailbox) => (
                <SelectItem key={mailbox.id} value={String(mailbox.id)}>
                  {mailbox.from_address}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {view === 'human' && (
          <>
            <div className="flex gap-1" role="group" aria-label="Filter by sentiment">
              {SENTIMENTS.map((value) => (
                <Button
                  key={value}
                  variant={sentiment === value ? 'default' : 'outline'}
                  size="xs"
                  aria-pressed={sentiment === value}
                  onClick={() => {
                    setSentiment(sentiment === value ? undefined : value);
                    setPage(1);
                  }}
                >
                  {GLYPH[value]} {value}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="unhandled-only"
                checked={unhandledOnly}
                onCheckedChange={(checked) => {
                  setUnhandledOnly(checked);
                  setPage(1);
                }}
              />
              <Label htmlFor="unhandled-only" className="text-xs">
                Needs outcome
              </Label>
            </div>
          </>
        )}
      </div>

      {view === 'reminders' && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Reminder date filter">
          {(['due_today', 'upcoming', 'overdue'] as const).map((value) => (
            <Button
              key={value}
              size="xs"
              variant={reminderView === value ? 'default' : 'outline'}
              onClick={() => {
                setReminderView(value);
                setPage(1);
              }}
            >
              {value === 'due_today' ? 'Due today' : value === 'upcoming' ? 'Upcoming' : 'Overdue'}
            </Button>
          ))}
        </div>
      )}

      {view === 'reminders' ? (
        reminders.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : reminders.isError ? (
          <EmptyState
            title="Failed to load reminders"
            actionLabel="Retry"
            onAction={() => reminders.refetch()}
          />
        ) : reminders.data.items.length === 0 ? (
          <EmptyState title="No reminders match this date filter." />
        ) : (
          <div className="space-y-3">
            {reminders.data.items.map((reminder) => (
              <article
                key={reminder.id}
                className="space-y-2 rounded-lg border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{reminder.lead.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Due {reminder.due_date} · campaign #{reminder.campaign_id} ·{' '}
                      {reminder.source.replace('_', ' ')}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={patchReminder.isPending}
                      onClick={() => patchReminder.mutate({ id: reminder.id, status: 'done' })}
                    >
                      Complete
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={patchReminder.isPending}
                      onClick={() => patchReminder.mutate({ id: reminder.id, status: 'dismissed' })}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
                {(reminder.note || reminder.reply_snippet) && (
                  <p className="text-xs text-muted-foreground">
                    {reminder.note ?? reminder.reply_snippet}
                  </p>
                )}
              </article>
            ))}
            <CollectionPagination
              page={reminders.data.page}
              perPage={reminders.data.per_page}
              total={reminders.data.total}
              onPageChange={setPage}
            />
          </div>
        )
      ) : isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : isError ? (
        <EmptyState title="Failed to load replies" actionLabel="Retry" onAction={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState
          title={
            view === 'human'
              ? "No replies yet — they'll appear here the moment the poller sees them."
              : 'No auto-replies in this window.'
          }
        />
      ) : (
        <div className="space-y-3" data-testid="unibox-feed">
          {data.items.map((item) => (
            <ReplyCard
              key={item.incoming_message_id}
              item={item}
              bucket={bucket}
              tagOnlyMode={tagOnlyMode}
              onOpenThread={() => setThreadId(item.incoming_message_id)}
            />
          ))}
          <CollectionPagination
            page={data.page}
            perPage={data.per_page}
            total={data.total}
            onPageChange={setPage}
          />
        </div>
      )}

      <ThreadView
        incomingMessageId={threadId}
        onOpenChange={(open) => setThreadId(open ? threadId : null)}
      />
    </div>
  );
}
