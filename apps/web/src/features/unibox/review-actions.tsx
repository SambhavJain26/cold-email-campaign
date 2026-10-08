import { useState } from 'react';
import { toast } from 'sonner';
import {
  resolveReviewLocalTime,
  type IncomingReviewRow,
  type IncomingReviewMessage,
} from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useIncomingMutation } from '@/api/mutations/incoming-review';

type Action =
  'continue' | 'stop' | 'suppress' | 'delay' | 'correct_stop' | 'restore_legacy' | 'delete';
const LABEL: Record<Action, string> = {
  continue: 'Continue',
  stop: 'Stop sequence',
  suppress: 'Suppress address',
  delay: 'Delay',
  correct_stop: 'Correct Stop',
  restore_legacy: 'Restore to review',
  delete: 'Delete stored content',
};
const EXPLANATION: Record<Action, string> = {
  continue:
    'Release only the selected review holds. The next unsent step becomes eligible under normal scheduling, preserving any existing delay. This action does not send an email. Other campaigns keep their holds.',
  stop: 'End this campaign’s remaining automated sequence. This does not globally suppress the address. A correction returns it to review and requires a separate Continue or Delay decision.',
  suppress:
    'Permanently block outreach to this address across all campaigns. This cannot be undone, including if it was a mistake.',
  delay:
    'Preserve sequence progress and saved retry bodies. Resume eligibility is no earlier than this continuation time and the existing due time. Campaign status, caps, windows and suppression still apply.',
  correct_stop:
    'Return this stopped sequence to Held for review, keeping its progress. Then choose Continue or Delay. This confirmation does not send an email.',
  restore_legacy:
    'Return this previously stopped sequence to Held for review, keeping the next unsent email. Then choose Continue or Delay. This confirmation does not send an email.',
  delete:
    'Permanently remove this message’s stored text, HTML, quotations and preview from the application. The mailbox copy, sent history, sending state and suppression remain.',
};
export function ReviewActions({
  row,
  message,
  messages,
  reviewed,
  history = [],
  onDecision,
}: {
  row: IncomingReviewRow;
  message: IncomingReviewMessage | null;
  messages: IncomingReviewMessage[];
  reviewed: Map<number, number>;
  history?: IncomingReviewMessage['history'];
  onDecision?: () => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [confirm, setConfirm] = useState('');
  const [localTime, setLocalTime] = useState('');
  const [zone, setZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const mutation = useIncomingMutation();
  const [snapshot, setSnapshot] = useState<{
    row: IncomingReviewRow;
    message: IncomingReviewMessage | null;
    holds: number[];
    reviewed: number[];
    history: IncomingReviewMessage['history'];
  } | null>(null);
  const known = messages.flatMap((m) =>
    m.history.flatMap((h) =>
      Array.isArray(h.attributes.holds)
        ? (h.attributes.holds as { id: number; enrollment_id: number }[])
            .filter((hold) => (hold.enrollment_id ?? null) === row.enrollment_id)
            .map((hold) => ({ ...hold, message_id: m.id }))
        : [],
    ),
  );
  const held = row.hold_ids.filter((id) => {
    const hold = known.find((h) => h.id === id);
    return !hold || reviewed.has(hold.message_id);
  });
  const terminal = ['suppressed', 'bounced', 'completed', 'stopped', 'not_enrolled'].includes(
    row.sending_state,
  );
  const resolution = resolveReviewLocalTime(localTime, zone);
  const invalid =
    action === 'suppress'
      ? confirm !== (snapshot?.row.email ?? row.email)
      : action === 'delay'
        ? !resolution.instant || new Date(resolution.instant) <= new Date()
        : false;
  const open = (next: Action) => {
    setSnapshot({
      row,
      message,
      holds: [...held],
      reviewed: [...reviewed.keys()],
      history: [...history],
    });
    setConfirm('');
    mutation.reset();
    setAction(next);
  };
  const submit = () => {
    if (!action || !snapshot) return;
    const { row, message, holds: held, reviewed: reviewedIds } = snapshot;
    const op = crypto.randomUUID();
    const request =
      action === 'delete' && message
        ? {
            path: `/unibox/messages/${message.id}/content`,
            method: 'DELETE' as const,
            result: 'message' as const,
            body: { operation_id: op, expected_revision: message.revision },
          }
        : row.enrollment_id
          ? {
              path: `/unibox/rows/${row.enrollment_id}/action`,
              body: {
                operation_id: op,
                expected_revision: row.revision,
                action,
                hold_ids: held,
                reviewed_message_ids: reviewedIds,
                ...(action === 'suppress' ? { confirm } : {}),
                ...(action === 'delay'
                  ? { until: resolution.instant, timezone: zone, local_time: localTime }
                  : {}),
              },
            }
          : action === 'continue'
            ? {
                path: '/unibox/lead-action',
                body: {
                  operation_id: op,
                  expected_revision: row.revision,
                  action,
                  hold_ids: held,
                  reviewed_message_ids: reviewedIds,
                  lead_id: row.lead_id,
                  campaign_id: row.campaign_id,
                },
              }
            : message
              ? {
                  path: `/unibox/messages/${message.id}/suppress-address`,
                  body: {
                    operation_id: op,
                    expected_revision: message.revision,
                    lead_id: row.lead_id,
                    confirm,
                  },
                }
              : null;
    if (!request) return;
    mutation.mutate(request, {
      onSuccess: () => {
        setAction(null);
        toast.success(
          action === 'delete' ? 'Stored content deleted' : `${LABEL[action]} confirmed`,
        );
        onDecision?.();
      },
    });
  };
  return (
    <>
      <div className="flex flex-wrap gap-2" aria-label="Outreach actions">
        <Button
          size="sm"
          disabled={terminal || held.length === 0 || mutation.isPending}
          onClick={() => open('continue')}
        >
          Continue
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={terminal || !row.enrollment_id || mutation.isPending}
          onClick={() => open('stop')}
        >
          Stop sequence
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={row.sending_state === 'suppressed' || !message || mutation.isPending}
          onClick={() => open('suppress')}
        >
          Suppress address
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={
            terminal ||
            !row.enrollment_id ||
            (row.sending_state === 'held' && held.length === 0) ||
            mutation.isPending
          }
          onClick={() => open('delay')}
        >
          Delay
        </Button>
        {row.sending_state === 'stopped' && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => open(row.stop_origin === 'manual' ? 'correct_stop' : 'restore_legacy')}
          >
            Restore to review
          </Button>
        )}
        {message && message.capture_status !== 'deleted' && (
          <Button size="sm" variant="ghost" onClick={() => open('delete')}>
            Delete stored content
          </Button>
        )}
      </div>
      {row.sending_state === 'stopped' && (
        <p className="text-sm text-muted-foreground">
          This sequence is stopped. Restore to review first, then choose Continue or Delay.
          Restoration keeps your progress and does not send an email.
        </p>
      )}
      {row.sending_state === 'held' && (
        <p className="text-xs text-muted-foreground">
          Review the relevant messages before Continue or Delay. Acknowledge is available after an
          outreach decision.
          {row.delayed_until &&
            ` Existing delay: ${new Date(row.delayed_until).toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`}
        </p>
      )}
      <Dialog
        open={action !== null}
        onOpenChange={(value) => {
          if (!value && !mutation.isPending) setAction(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{action ? LABEL[action] : ''}</DialogTitle>
            <DialogDescription>{action ? EXPLANATION[action] : ''}</DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted p-3 text-sm">
            <p className="font-medium">{snapshot?.row.name || snapshot?.row.email}</p>
            <p>{snapshot?.row.email}</p>
            <p>
              {snapshot?.row.campaign_name} · {snapshot?.row.sending_state.replaceAll('_', ' ')} ·{' '}
              {snapshot?.row.next_step
                ? `Next unsent step ${snapshot.row.next_step}`
                : 'No active sequence'}
            </p>
            {action === 'delete' && (
              <p className="mt-2">{snapshot?.message?.subject || '(No subject)'} · one message</p>
            )}
          </div>
          {action === 'continue' && !snapshot?.row.enrollment_id && (
            <p className="text-sm">
              This lead is not enrolled. Resolving review does not enroll it or send. Future
              enrollment still requires explicit recontact approval.
            </p>
          )}
          {action === 'continue' && (
            <p className="text-sm">
              Releasing {snapshot?.holds.length} selected hold(s), covering{' '}
              {snapshot?.reviewed.length} reviewed message(s).
            </p>
          )}
          {(action === 'correct_stop' || action === 'restore_legacy') && (
            <div className="space-y-2 text-sm">
              {snapshot?.history
                .filter((fact) =>
                  ['outreach_stopped', 'human_reply', 'sequence_stopped'].includes(fact.kind),
                )
                .slice(0, 5)
                .map((fact) => (
                  <p key={fact.id}>
                    {fact.kind.replaceAll('_', ' ')} · {new Date(fact.occurred_at).toLocaleString()}
                    {typeof fact.attributes.reason === 'string'
                      ? ` · ${fact.attributes.reason}`
                      : ''}
                  </p>
                ))}
            </div>
          )}
          {action === 'suppress' && (
            <div className="space-y-2">
              <Label htmlFor="suppress-confirm">
                Type {snapshot?.row.email} to confirm permanently
              </Label>
              <Input
                id="suppress-confirm"
                autoComplete="off"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </div>
          )}
          {action === 'delay' && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="delay-time">Continuation date and time</Label>
                <Input
                  id="delay-time"
                  type="datetime-local"
                  value={localTime}
                  onChange={(event) => setLocalTime(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="delay-zone">IANA timezone</Label>
                <Input
                  id="delay-zone"
                  value={zone}
                  onChange={(event) => setZone(event.target.value)}
                />
              </div>
              {resolution.instant ? (
                <p className="text-sm">
                  {localTime.replace('T', ' ')} in {zone}
                  <br />
                  Exact instant: {resolution.instant}
                </p>
              ) : (
                localTime && (
                  <p role="alert" className="text-sm text-destructive">
                    {resolution.error}
                  </p>
                )
              )}
            </div>
          )}
          {(action === 'correct_stop' || action === 'restore_legacy') && (
            <div className="space-y-2">
              <p className="text-sm">
                Assigned mailbox:{' '}
                {snapshot?.row.assigned_mailbox_id
                  ? `Mailbox ${snapshot.row.assigned_mailbox_id}`
                  : 'Not assigned'}
                . Next follow-up eligible from:{' '}
                {snapshot?.row.resume_due_at || snapshot?.row.next_send_at
                  ? new Date(
                      snapshot.row.resume_due_at || snapshot.row.next_send_at!,
                    ).toLocaleString()
                  : 'Calculated from the last email sent'}
                .
              </p>
              <p className="text-xs text-muted-foreground">
                Historical events remain intact. Suppressed and bounced addresses cannot be
                restored.
              </p>
            </div>
          )}
          {mutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={mutation.isPending} onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button
              variant={action === 'suppress' || action === 'delete' ? 'destructive' : 'default'}
              disabled={invalid || mutation.isPending}
              onClick={submit}
            >
              {mutation.isPending
                ? 'Confirming…'
                : action === 'correct_stop' || action === 'restore_legacy'
                  ? 'Confirm'
                  : `Confirm ${action ? LABEL[action] : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
