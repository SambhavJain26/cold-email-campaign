import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Typed-confirm dialog (decision U — e.g. suppression removal must type the
 *  exact email). Confirm stays disabled until the input equals `expected`. */
export function ConfirmTypedDialog({
  open,
  onOpenChange,
  title,
  description,
  expected,
  confirmLabel = 'Confirm',
  onConfirm,
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  expected: string;
  confirmLabel?: string;
  onConfirm: (typed: string) => void;
  pending?: boolean;
}) {
  const [typed, setTyped] = useState('');
  const matches = typed === expected;

  const close = (next: boolean) => {
    if (!next) setTyped('');
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="confirm-typed">
            Type <span className="font-mono font-medium">{expected}</span> to confirm
          </Label>
          <Input
            id="confirm-typed"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!matches || pending}
            onClick={() => onConfirm(typed)}
          >
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
