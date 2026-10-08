import { useState } from 'react';
import { toast } from 'sonner';
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
import { useCreateReminder } from '@/api/mutations/unibox';

export function ReviewReminder({ messageId }: { messageId: number }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const mutation = useCreateReminder();
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Add reminder
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add operator reminder</DialogTitle>
            <DialogDescription>
              This creates a task for the primary conversation only. It does not release a hold,
              change a delay or authorize outreach.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="reminder-date">Reminder due date</Label>
          <Input
            id="reminder-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <Label htmlFor="reminder-note">Reminder note</Label>
          <Input
            id="reminder-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          {mutation.error && <p role="alert">{mutation.error.message}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!date || mutation.isPending}
              onClick={() =>
                mutation.mutate(
                  { incomingMessageId: messageId, dueDate: date, note: note.trim() || null },
                  {
                    onSuccess: () => {
                      setOpen(false);
                      toast.success('Reminder saved. Outreach state unchanged.');
                    },
                  },
                )
              }
            >
              Save reminder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
