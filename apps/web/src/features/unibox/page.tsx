import { useState } from 'react';
import { SENTIMENTS, type Sentiment } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/empty-state';
import { useUnibox } from '@/api/queries/unibox';
import { useSettings } from '@/api/queries/settings';
import { ReplyCard } from './reply-card';
import { ThreadView } from './thread-view';

const GLYPH: Record<Sentiment, string> = { positive: '🟢', neutral: '⚪', negative: '🔴' };

/** F6.1 - Unibox feed (docs/12 §7): human / auto-reply tabs + sentiment filters. */
export default function UniboxPage() {
  const [bucket, setBucket] = useState<'human' | 'auto_reply'>('human');
  const [sentiment, setSentiment] = useState<Sentiment | undefined>(undefined);
  const [unhandledOnly, setUnhandledOnly] = useState(false);
  const [threadId, setThreadId] = useState<number | null>(null);

  const settings = useSettings();
  const tagOnlyMode = settings.data?.optout_detection === 'tag_only';

  const { data, isPending, isError, refetch } = useUnibox({
    bucket,
    per_page: 50,
    sentiment: bucket === 'human' ? sentiment : undefined,
    unhandled: bucket === 'human' && unhandledOnly ? true : undefined,
  });

  const switchBucket = (next: string) => {
    setBucket(next === 'auto_reply' ? 'auto_reply' : 'human');
    setSentiment(undefined);
    setUnhandledOnly(false);
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Unibox</h1>
        {tagOnlyMode && (
          <span className="text-xs text-muted-foreground" data-testid="tag-only-mode">
            Opt-out detection is <strong>tag_only</strong> - STOP replies are tagged, never
            auto-suppressed. Unsubscribe negatives by hand.
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Tabs value={bucket} onValueChange={switchBucket}>
          <TabsList>
            <TabsTrigger value="human">Human replies</TabsTrigger>
            <TabsTrigger value="auto_reply">Auto-replies (OOO)</TabsTrigger>
          </TabsList>
        </Tabs>

        {bucket === 'human' && (
          <>
            <div className="flex gap-1" role="group" aria-label="Filter by sentiment">
              {SENTIMENTS.map((value) => (
                <Button
                  key={value}
                  variant={sentiment === value ? 'default' : 'outline'}
                  size="xs"
                  aria-pressed={sentiment === value}
                  onClick={() => setSentiment(sentiment === value ? undefined : value)}
                >
                  {GLYPH[value]} {value}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="unhandled-only"
                checked={unhandledOnly}
                onCheckedChange={setUnhandledOnly}
              />
              <Label htmlFor="unhandled-only" className="text-xs">
                Untagged only
              </Label>
            </div>
          </>
        )}
      </div>

      {isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : isError ? (
        <EmptyState title="Failed to load replies" actionLabel="Retry" onAction={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState
          title={
            bucket === 'human'
              ? "No replies yet - they'll appear here the moment the poller sees them."
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
        </div>
      )}

      <ThreadView
        incomingMessageId={threadId}
        onOpenChange={(open) => setThreadId(open ? threadId : null)}
      />
    </div>
  );
}
