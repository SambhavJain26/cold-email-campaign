import { useState } from 'react';
import type { ReplyCandidate } from '@coldemail/shared';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { usePossibleDetail } from '@/api/queries/incoming-review';
import { useIncomingMutation } from '@/api/mutations/incoming-review';
import { formatDateTime } from '@/lib/format';
import { SafeMessage } from './safe-message';
import { RecoverContent } from './recover-content';

export function candidateReason(c: ReplyCandidate) {
  return c.subject_match
    ? `Same subject as your email to ${c.name || c.email}${c.company_match ? ' and same company domain' : ''}.`
    : `Same company domain as ${c.name || c.email}; please verify the person.`;
}
export function PossibleReader({
  id,
  onBack,
  onConfirmed,
}: {
  id: number;
  onBack: () => void;
  onConfirmed: (c: ReplyCandidate) => void;
}) {
  const detail = usePossibleDetail(id),
    mutation = useIncomingMutation();
  const [selected, setSelected] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState<{
    candidate: ReplyCandidate;
    revision: number;
  } | null>(null);
  const [deleteRevision, setDeleteRevision] = useState<number | null>(null);
  const m = detail.data?.message,
    candidates = detail.data?.candidates ?? [];
  const chosen =
    candidates.find((c) => c.enrollment_id === selected) ??
    (candidates.length === 1 ? candidates[0] : undefined);
  if (!m)
    return (
      <section className="p-5">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <p role={detail.error ? 'alert' : 'status'}>
          {detail.error?.message ?? 'Loading possible reply…'}
        </p>
      </section>
    );
  if (m.links.length)
    return (
      <section className="space-y-4 p-5">
        <p>
          This message is now linked to a lead. Open its conversation to review the sending state.
        </p>
        <Button variant="outline" onClick={onBack}>
          Back to list
        </Button>
      </section>
    );
  const visibility = (action: 'dismiss' | 'return', revision = m.revision) =>
    mutation.mutate(
      {
        path: `/unibox/messages/${id}/candidate-visibility`,
        body: { operation_id: crypto.randomUUID(), expected_revision: revision, action },
      },
      {
        onSuccess: () => {
          if (action === 'dismiss')
            toast.success('Removed from Needs review. Sending state unchanged.', {
              action: { label: 'Undo', onClick: () => visibility('return', revision + 1) },
            });
          else toast.success('Returned to Needs review');
        },
      },
    );
  return (
    <section aria-label="Possible reply reader" className="min-h-0 space-y-5 overflow-y-auto p-5">
      <Button variant="ghost" onClick={onBack}>
        Back to list
      </Button>
      <header>
        <p className="text-sm font-semibold">Possible reply</p>
        <h2 className="text-lg font-semibold">{m.subject || '(No subject)'}</h2>
        <p className="break-words">From: {m.from_address}</p>
        <p className="text-sm text-muted-foreground">
          {m.received_at ? formatDateTime(m.received_at) : 'Receipt time unavailable'}
        </p>
      </header>
      <p className="rounded-md bg-muted p-4">
        This message is not linked yet. The suggested lead’s sequence has not been held because of
        this message.
      </p>
      <p className="text-sm">
        Automation:{' '}
        {m.automation === 'automatic'
          ? 'Automatic detected'
          : m.automation === 'not_detected'
            ? 'No automation detected'
            : 'Uncertain'}{' '}
        · Relationship: Unmatched
      </p>
      {m.capture_status === 'unavailable' && <p>Message text wasn’t saved.</p>}
      <SafeMessage message={m} />
      <RecoverContent message={m} label="Recover message" />
      <fieldset className="space-y-3">
        <legend className="font-semibold">Who is this reply from?</legend>
        {candidates.map((c) => (
          <label key={c.enrollment_id} className="flex gap-3 rounded-md border p-3">
            <input
              type="radio"
              name={`candidate-${id}`}
              checked={chosen?.enrollment_id === c.enrollment_id}
              onChange={() => setSelected(c.enrollment_id)}
            />
            <span>
              <span className="block font-semibold">{c.name || c.email}</span>
              <span className="block break-words text-sm">
                {c.email} · {c.campaign_name}
              </span>
              <span className="block text-sm">{candidateReason(c)}</span>
              <span className="block text-sm">
                Sending state:{' '}
                {c.sending_state === 'held'
                  ? 'Held for review'
                  : c.sending_state === 'delayed' && c.delayed_until
                    ? `Delayed until ${formatDateTime(c.delayed_until)}`
                    : c.sending_state}{' '}
                {c.campaign_status === 'paused' ? '· Campaign paused' : ''}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {mutation.error && (
        <p role="alert" className="text-destructive">
          {mutation.error.message}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={!chosen || mutation.isPending}
          onClick={() => chosen && setConfirmation({ candidate: chosen, revision: m.revision })}
        >
          {chosen ? `Confirm this is ${chosen.name || chosen.email}` : 'Choose a lead to confirm'}
        </Button>
        <Button
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => visibility(m.acknowledged ? 'return' : 'dismiss')}
        >
          {m.acknowledged ? 'Return to review' : 'Not a campaign reply'}
        </Button>
        <Button
          variant="ghost"
          disabled={mutation.isPending || m.capture_status === 'deleted'}
          onClick={() => setDeleteRevision(m.revision)}
        >
          Delete stored content
        </Button>
      </div>
      <Dialog
        open={deleteRevision !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setDeleteRevision(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete stored content</DialogTitle>
            <DialogDescription>
              Remove the application’s saved text, HTML and preview for this message. The original
              mailbox copy, candidate evidence and sending history remain. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <p className="break-words">
            {m.from_address} · {m.subject}
          </p>
          {mutation.error && <p role="alert">{mutation.error.message}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteRevision(null)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              disabled={mutation.isPending || deleteRevision === null}
              onClick={() =>
                mutation.mutate(
                  {
                    path: `/unibox/messages/${id}/content`,
                    method: 'DELETE',
                    result: 'message',
                    body: { operation_id: crypto.randomUUID(), expected_revision: deleteRevision },
                  },
                  {
                    onSuccess: () => {
                      setDeleteRevision(null);
                      toast.success('Stored content deleted. Sending state unchanged.');
                    },
                  },
                )
              }
            >
              Confirm deletion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setConfirmation(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm the lead</DialogTitle>
            <DialogDescription>
              Link this message to {confirmation?.candidate.name || confirmation?.candidate.email}.
              Their unfinished sequences will be held for your review. This does not send an email.
            </DialogDescription>
          </DialogHeader>
          <p className="break-words text-sm">
            Message from {m.from_address}
            <br />
            Lead: {confirmation?.candidate.email}
            <br />
            Campaign: {confirmation?.candidate.campaign_name}
          </p>
          {mutation.error && (
            <p role="alert" className="text-destructive">
              {mutation.error.message}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={!confirmation || mutation.isPending}
              onClick={() =>
                confirmation &&
                mutation.mutate(
                  {
                    path: `/unibox/messages/${id}/confirm-candidate`,
                    body: {
                      operation_id: crypto.randomUUID(),
                      expected_revision: confirmation.revision,
                      lead_id: confirmation.candidate.lead_id,
                      campaign_id: confirmation.candidate.campaign_id,
                    },
                  },
                  {
                    onSuccess: () => {
                      setConfirmation(null);
                      onConfirmed(confirmation.candidate);
                      toast.success(
                        'Message linked. Review the lead’s sending state before choosing an action.',
                      );
                    },
                  },
                )
              }
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
