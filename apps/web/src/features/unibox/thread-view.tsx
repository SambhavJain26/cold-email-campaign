import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { SentimentTag } from '@/components/shared/sentiment-tag';
import { formatDateTime } from '@/lib/format';
import { useUniboxItem } from '@/api/queries/unibox';

/** F6.3 - thread view: the steps we sent (header-threaded, docs/07) and the reply body. */
export function ThreadView({
  incomingMessageId,
  onOpenChange,
}: {
  incomingMessageId: number | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={incomingMessageId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {incomingMessageId !== null && <ThreadBody incomingMessageId={incomingMessageId} />}
      </DialogContent>
    </Dialog>
  );
}

function ThreadBody({ incomingMessageId }: { incomingMessageId: number }) {
  const { data, isPending, isError, refetch } = useUniboxItem(incomingMessageId);

  if (isPending) return <Skeleton className="h-48 w-full" />;
  if (isError) {
    return (
      <EmptyState title="Failed to load thread" actionLabel="Retry" onAction={() => refetch()} />
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {data.lead.name}
          {data.lead.company && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              - {data.lead.company}
            </span>
          )}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <section className="space-y-1">
          <h3 className="text-xs font-medium text-muted-foreground">
            Sent in this thread ({data.thread.length})
          </h3>
          <ol className="space-y-1" data-testid="thread-steps">
            {data.thread.map((message) => (
              <li
                key={message.message_id}
                className="flex items-baseline justify-between gap-3 rounded-md border border-border px-2 py-1 text-xs"
              >
                <span>Step {message.step_no}</span>
                <span className="text-muted-foreground">{formatDateTime(message.sent_at)}</span>
                <code className="truncate font-mono text-[10px] text-muted-foreground">
                  {message.message_id}
                </code>
              </li>
            ))}
          </ol>
        </section>

        <section className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              Reply {data.received_at && `· ${formatDateTime(data.received_at)}`}
            </h3>
            {data.effective_sentiment && <SentimentTag sentiment={data.effective_sentiment} />}
            {data.meeting_booked && <Badge className="text-[10px]">📅 meeting booked ✓</Badge>}
          </div>
          <pre
            className="max-h-72 overflow-y-auto rounded-md border border-border bg-muted/30 px-3 py-2 text-xs whitespace-pre-wrap"
            data-testid="thread-body"
          >
            {data.body_text ?? data.snippet ?? '(no body captured)'}
          </pre>
        </section>
      </div>
    </>
  );
}
