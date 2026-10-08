import { useState, useEffect, type MutableRefObject } from 'react';
import { toast } from 'sonner';
import {
  incomingMessageSchema,
  type IncomingReviewMessage,
  type IncomingReviewRow,
} from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useIncomingContext, useIncomingMessage } from '@/api/queries/incoming-review';
import { useIncomingMutation } from '@/api/mutations/incoming-review';
import { apiFetch } from '@/api/client';
import { formatDateTime } from '@/lib/format';
import { SafeMessage } from './safe-message';
import { ReviewActions } from './review-actions';
import { LinkMessage } from './review-link';
import { RecoverContent } from './recover-content';
import { ReviewReminder } from './review-reminder';

export function sendingLabel(row: IncomingReviewRow): string {
  switch (row.sending_state) {
    case 'held':
      return 'Held for review';
    case 'delayed':
      return `Delayed until ${row.delayed_until ? formatDateTime(row.delayed_until) : 'chosen time'}`;
    case 'stopped':
      return `Stopped${row.stop_origin === 'legacy' ? ' · legacy history' : ''}`;
    case 'suppressed':
      return 'Suppressed';
    case 'completed':
      return 'Sequence completed';
    case 'bounced':
      return 'Bounced';
    case 'not_enrolled':
      return 'Not enrolled';
    default:
      return 'Running';
  }
}
export function MessageLabels({ message }: { message: IncomingReviewMessage }) {
  const automation = {
    automatic: 'Automatic detected',
    not_detected: 'No automation detected',
    uncertain: 'Uncertain',
  }[message.automation];
  const relation = {
    in_thread: 'In-thread reply',
    separate: 'Separate email',
    unmatched: 'Unmatched',
  }[message.relationship];
  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant="secondary">Automation: {automation}</Badge>
      <Badge variant="outline">Relationship: {relation}</Badge>
      <Badge variant="outline">
        Confirmed authorship:{' '}
        {message.authorship === 'unsure'
          ? 'Unsure'
          : message.authorship === 'human'
            ? 'Human'
            : 'Automatic'}
      </Badge>
    </div>
  );
}
export function ReviewReader({
  row: selectedRow,
  onBack,
  acknowledgeRef,
}: {
  row: IncomingReviewRow;
  onBack: () => void;
  acknowledgeRef: MutableRefObject<(() => void) | null>;
}) {
  const context = useIncomingContext(selectedRow);
  const row = context.data?.row ?? selectedRow;
  const mutation = useIncomingMutation();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [seen, setSeen] = useState<Map<number, number>>(new Map());
  const messages = context.data?.messages ?? [];
  const metadata = messages.find((m) => m.id === selectedId) ?? messages[0] ?? null;
  const fullMessage = useIncomingMessage(metadata?.id ?? null);
  const selected =
    fullMessage.data && metadata
      ? { ...fullMessage.data, acknowledged: metadata.acknowledged }
      : null;
  const reviewed = new Map(
    messages.filter((m) => seen.get(m.id) === m.revision).map((m) => [m.id, m.revision]),
  );
  const acknowledge = (action: 'acknowledge' | 'return' = 'acknowledge') => {
    const covered =
      action === 'return' && selected
        ? [selected]
        : messages.filter((m) => reviewed.has(m.id) && !m.acknowledged);
    if (!covered.length) {
      toast.info('Select “Reviewed this message” for the messages you have read.');
      return;
    }
    const operation = crypto.randomUUID();
    const ids = covered.map((m) => ({
      id: m.id,
      expected_revision: m.revision,
      campaign_id: row.campaign_id,
      lead_id: row.lead_id,
    }));
    mutation.mutate(
      {
        path: '/unibox/acknowledgements',
        body: { operation_id: operation, action, messages: ids },
      },
      {
        onSuccess: () => {
          setSeen(new Map());
          toast.success(
            action === 'return'
              ? 'Returned to review'
              : `Acknowledged ${covered.length} reviewed message(s)`,
            action === 'acknowledge'
              ? {
                  action: {
                    label: 'Undo',
                    onClick: () => {
                      void Promise.all(
                        ids.map(async (item) => ({
                          ...item,
                          expected_revision: (
                            await apiFetch(`/unibox/messages/${item.id}`, incomingMessageSchema)
                          ).revision,
                        })),
                      )
                        .then((current) =>
                          mutation.mutate(
                            {
                              path: '/unibox/acknowledgements',
                              body: {
                                operation_id: crypto.randomUUID(),
                                action: 'undo',
                                undo_operation_id: operation,
                                messages: current,
                              },
                            },
                            { onSuccess: () => toast.success('Acknowledgement undone') },
                          ),
                        )
                        .catch((error: unknown) =>
                          toast.error(
                            error instanceof Error ? error.message : 'Undo could not be completed.',
                          ),
                        );
                    },
                  },
                }
              : undefined,
          );
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };
  useEffect(() => {
    acknowledgeRef.current = () => acknowledge();
    return () => {
      acknowledgeRef.current = null;
    };
  });
  return (
    <section aria-label="Message reader" className="min-w-0 space-y-5 overflow-y-auto p-4 sm:p-6">
      <Button size="sm" variant="ghost" className="lg:hidden" onClick={onBack}>
        ← Back to leads
      </Button>
      <header className="space-y-2">
        <h2 className="text-lg font-semibold">{row.name || row.email}</h2>
        <p className="break-all text-sm text-muted-foreground">
          {row.email} · {row.company || 'Company not recorded'}
        </p>
        <p className="text-sm">{row.campaign_name}</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant={row.sending_state === 'held' ? 'default' : 'secondary'}>
            {sendingLabel(row)}
          </Badge>
          {row.campaign_status !== 'active' && (
            <Badge variant="outline">Campaign {row.campaign_status}</Badge>
          )}
        </div>
      </header>
      {context.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading message history…
        </p>
      )}
      {context.error && (
        <p role="alert" className="text-sm text-destructive">
          {context.error.message}
        </p>
      )}
      {metadata && fullMessage.isPending && <p role="status">Loading selected message…</p>}
      {fullMessage.error && (
        <p role="alert" className="text-destructive">
          {fullMessage.error.message}
        </p>
      )}
      {selected && (
        <>
          <div className="space-y-2">
            <label htmlFor="incoming-message-picker" className="text-sm font-medium">
              All incoming messages ({messages.length})
            </label>
            <Select value={String(selected.id)} onValueChange={(id) => setSelectedId(Number(id))}>
              <SelectTrigger id="incoming-message-picker" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {messages.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.received_at ? formatDateTime(m.received_at) : 'Unknown time'} ·{' '}
                    {m.subject || '(No subject)'}
                    {m.acknowledged ? ' · Acknowledged' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <article className="space-y-4 rounded-lg border border-border p-4 sm:p-5">
            <div className="space-y-1">
              <h3 className="break-words text-base font-semibold">
                {selected.subject || '(No subject)'}
              </h3>
              <p className="break-all text-sm">
                From: {selected.from_address || 'Sender not captured'}
              </p>
              <p className="text-xs text-muted-foreground">
                Received:{' '}
                {selected.received_at
                  ? `${formatDateTime(selected.received_at)} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`
                  : 'Timestamp unavailable'}
              </p>
            </div>
            <MessageLabels message={selected} />
            <SafeMessage key={selected.id} message={selected} />
            <RecoverContent message={selected} />
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Checkbox
                id="reviewed-message"
                checked={reviewed.has(selected.id)}
                onCheckedChange={(checked) =>
                  setSeen((old) => {
                    const next = new Map(old);
                    if (checked) next.set(selected.id, selected.revision);
                    else next.delete(selected.id);
                    return next;
                  })
                }
              />
              <label htmlFor="reviewed-message" className="text-sm">
                Reviewed this message
              </label>
              {selected.acknowledged && (
                <Badge variant="outline">Acknowledged · visibility only</Badge>
              )}
            </div>
            <ReviewActions
              row={row}
              message={selected}
              messages={messages}
              reviewed={reviewed}
              history={context.data?.history}
              onDecision={() => {
                void context.refetch();
              }}
            />
            {selected.links.some(
              (l) =>
                l.lead_id === row.lead_id &&
                l.campaign_id === row.campaign_id &&
                l.matching_method === 'corrected_previous',
            ) && (
              <p className="rounded-md bg-muted p-3 text-sm">
                This message’s association was corrected. This previously affected sequence remains
                held until you make a separate outreach decision.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={mutation.isPending || row.sending_state === 'held' || reviewed.size === 0}
                onClick={() => acknowledge()}
              >
                ✓ Acknowledge {reviewed.size} reviewed
              </Button>
              {selected.acknowledged && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => acknowledge('return')}
                  disabled={mutation.isPending}
                >
                  Return to review
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Acknowledgement changes visibility only. It does not continue, stop, suppress, delay
              or delete.
            </p>
            <div className="space-y-2">
              <label htmlFor="authorship-picker" className="text-sm font-medium">
                Confirm authorship for analytics
              </label>
              <Select
                value={selected.authorship}
                disabled={
                  mutation.isPending ||
                  (selected.primary_enrollment_id === null &&
                    !selected.history.some((h) => h.kind === 'linked'))
                }
                onValueChange={(authorship) =>
                  mutation.mutate(
                    {
                      path: `/unibox/messages/${selected.id}/authorship`,
                      result: 'message',
                      body: {
                        operation_id: crypto.randomUUID(),
                        expected_revision: selected.revision,
                        authorship,
                      },
                    },
                    { onError: (error) => toast.error(error.message) },
                  )
                }
              >
                <SelectTrigger id="authorship-picker" className="w-full sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="human">Human</SelectItem>
                  <SelectItem value="automatic">Automatic</SelectItem>
                  <SelectItem value="unsure">Unsure</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                No automation detected does not verify human authorship. Linking and acknowledgement
                do not create human-reply credit.
              </p>
            </div>
            <LinkMessage message={selected} initialCampaignId={row.campaign_id} />
            {row.enrollment_id === selected.primary_enrollment_id && (
              <ReviewReminder messageId={selected.id} />
            )}
            {selected.authorship === 'human' && (
              <div className="space-y-2">
                <label htmlFor="sentiment-picker" className="text-sm font-medium">
                  Confirmed reply sentiment
                </label>
                <Select
                  value={selected.sentiment ?? 'none'}
                  disabled={mutation.isPending}
                  onValueChange={(sentiment) =>
                    mutation.mutate(
                      {
                        path: `/unibox/messages/${selected.id}/authorship`,
                        result: 'message',
                        body: {
                          operation_id: crypto.randomUUID(),
                          expected_revision: selected.revision,
                          authorship: 'human',
                          sentiment: sentiment === 'none' ? null : sentiment,
                        },
                      },
                      { onError: (error) => toast.error(error.message) },
                    )
                  }
                >
                  <SelectTrigger id="sentiment-picker" className="w-full sm:w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not tagged</SelectItem>
                    <SelectItem value="positive">Positive</SelectItem>
                    <SelectItem value="neutral">Neutral</SelectItem>
                    <SelectItem value="negative">Negative</SelectItem>
                  </SelectContent>
                </Select>
                {row.enrollment_id === selected.primary_enrollment_id && row.enrollment_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      mutation.mutate(
                        { path: `/enrollments/${row.enrollment_id}/meeting-booked`, body: {} },
                        {
                          onSuccess: () =>
                            toast.success('Meeting recorded. Outreach state unchanged.'),
                          onError: (error) => toast.error(error.message),
                        },
                      )
                    }
                  >
                    Record meeting booked
                  </Button>
                )}
              </div>
            )}
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">
                Message activity
              </summary>
              <ol className="mt-3 space-y-2">
                {selected.history.map((h) => (
                  <li key={h.id} className="text-xs">
                    {formatDateTime(h.occurred_at)} · {h.kind.replaceAll('_', ' ')}
                  </li>
                ))}
              </ol>
            </details>
          </article>
        </>
      )}
      {!!context.data?.sent.length && (
        <details className="rounded-lg border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Sent conversation context ({context.data.sent.length})
          </summary>
          <div className="mt-4 space-y-4">
            {[...new Set(context.data.sent.map((sent) => sent.conversation_id))].map(
              (conversation) => (
                <div key={conversation}>
                  <p className="text-xs font-medium text-muted-foreground">Conversation</p>
                  {context
                    .data!.sent.filter((sent) => sent.conversation_id === conversation)
                    .map((sent) => (
                      <details key={sent.message_id} className="mt-2 rounded-md bg-muted p-3">
                        <summary className="cursor-pointer text-sm">
                          Step {sent.step_no} · {sent.subject || '(Subject not saved)'} ·{' '}
                          {formatDateTime(sent.sent_at)}
                        </summary>
                        <p className="mt-3 whitespace-pre-wrap break-words text-sm">
                          {sent.body_text ?? 'Sent body not saved.'}
                        </p>
                      </details>
                    ))}
                </div>
              ),
            )}
          </div>
        </details>
      )}
      {!!context.data?.history.length && (
        <details className="rounded-lg border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium">Outreach action history</summary>
          <ol className="mt-3 space-y-3">
            {context.data.history.map((h) => (
              <li key={h.id} className="text-sm">
                <p>
                  {h.kind.replaceAll('_', ' ')} · {formatDateTime(h.occurred_at)}
                </p>
                {typeof h.attributes.reason === 'string' && (
                  <p className="text-muted-foreground">{h.attributes.reason}</p>
                )}
                {h.kind === 'outreach_stopped' && (
                  <p className="text-muted-foreground">
                    Historical company-mail stop ·{' '}
                    {String(h.attributes.sender ?? 'sender recorded in audit')}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
