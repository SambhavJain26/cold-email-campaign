import { useState } from 'react';
import type { IncomingReviewMessage } from '@coldemail/shared';
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
import { useIncomingMutation } from '@/api/mutations/incoming-review';

export function RecoverContent({ message }: { message: IncomingReviewMessage }) {
  const [snapshot, setSnapshot] = useState<IncomingReviewMessage | null>(null);
  const mutation = useIncomingMutation();
  if (message.capture_status === 'captured' || message.capture_status === 'deleted') return null;
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          mutation.reset();
          setSnapshot(message);
        }}
      >
        Recover full content
      </Button>
      <Dialog
        open={snapshot !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setSnapshot(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recover full incoming content</DialogTitle>
            <DialogDescription>
              Read this selected message from configured IMAP folders, if it remains available and
              its identity matches. This does not change mailbox flags, replay replies, advance
              polling or alter sending state. Deleted content cannot be restored.
            </DialogDescription>
          </DialogHeader>
          <p className="break-words text-sm">
            {snapshot?.from_address} · {snapshot?.subject || '(No subject)'}
          </p>
          {mutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => setSnapshot(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={mutation.isPending || !snapshot}
              onClick={() =>
                snapshot &&
                mutation.mutate(
                  {
                    path: `/unibox/messages/${snapshot.id}/recover-content`,
                    result: 'message',
                    body: {
                      operation_id: crypto.randomUUID(),
                      expected_revision: snapshot.revision,
                    },
                  },
                  {
                    onSuccess: () => {
                      setSnapshot(null);
                      toast.success('Full content recovered. Sending state unchanged.');
                    },
                  },
                )
              }
            >
              {mutation.isPending ? 'Recovering…' : 'Confirm recovery'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
